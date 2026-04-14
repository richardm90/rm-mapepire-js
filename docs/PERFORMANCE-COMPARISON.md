# Performance Comparison: idb-pconnector vs Mapepire

## Introduction

One of the primary motivations behind rm-connector-js is enabling a dual-environment development workflow: develop locally using Mapepire (which can connect to IBM i from various platforms) and deploy to production on IBM i using idb-pconnector for superior performance. This document examines the architectural and performance differences between the two database connectors to validate that assumption with technical evidence.

## Architecture Overview

### idb-pconnector

`idb-pconnector` is a Promise-based wrapper around `idb-connector`, the native C++ Node.js addon (N-API) that actually calls the DB2 SQL CLI API directly on IBM i. `idb-connector` is the piece doing the real work — the N-API bridge, the C buffers, the CLI calls into the QSQSRVR job. `idb-pconnector` re-exports its classes and methods, adding `Promise` semantics on top of the original callback-based API so modern `async`/`await` code can use it directly. rm-connector-js imports `idb-pconnector`, so everywhere this document says "idb-pconnector" the behaviour, performance characteristics, and data path are really those of the underlying `idb-connector` addon.

The data path is:

```
Node.js -> idb-pconnector (Promise wrapper) -> idb-connector N-API C++ addon -> DB2 SQL CLI -> QSQSRVR job (shared memory/IPC)
```

- Runs only on IBM i
- No network layer involved; communication with the database is via OS-level IPC
- No server component to install or manage
- Jobs run under the `QSQSRVR` subsystem

**Notes:**
- N-API (Node-API) is Node.js's stable C/C++ interface for building native addons — modules written in C or C++ that can be called directly from JavaScript. In the case of `idb-connector`, the addon is the bridge between your JavaScript code and the IBM i operating system's DB2 SQL CLI (Call Level Interface). `idb-pconnector` sits one level above, translating that addon's callback API into Promises; it does not touch the data path.
- When `idb-connector` calls the DB2 SQL CLI, it doesn't talk to the database engine directly in the same process. Instead, the SQL CLI communicates with a QSQSRVR job — a separate prestart job running on IBM i that handles the actual database work. IPC (Inter-Process Communication) refers to how these two processes talk to each other. On IBM i, this happens through OS-level mechanisms like shared memory segments rather than network sockets. The key point is that this communication stays entirely within the machine's memory — no TCP/IP stack, no serialization to a wire format, no encryption overhead.

### Mapepire

Mapepire is a client-server architecture. A Java-based server runs on IBM i and listens for Secure WebSocket connections. Clients (available for Node.js, Python, etc) communicate with the server over this WebSocket channel. Its data path is:

```
Node.js client -> WebSocket (TLS) over TCP -> Java server -> JDBC/JTOpen -> QZDASOINIT job -> Db2
```

- Can connect from various platforms (local dev machines, cloud, containers)
- Requires the Mapepire server component to be installed and running on IBM i
- Uses JSON-over-WebSocket as its wire protocol
- Jobs run under the `QZDASOINIT` subsystem

## Performance Differences

### Connection Establishment (~4-10x faster with idb)

Empirical measurements from rm-connector-js show:

| Connector | Connection Time |
|-----------|----------------|
| idb-pconnector | ~5-25ms |
| Mapepire | ~100-250ms |

The difference is due to Mapepire requiring a TCP connection, TLS handshake, WebSocket upgrade, and JDBC connection setup, whereas idb-pconnector performs a single local CLI connect call.

This matters for connection pool creation, recovery after idle connection expiry, and burst scenarios where new connections must be established quickly.

### Per-Query Overhead

Every Mapepire query involves the following steps that idb-pconnector avoids entirely:

1. JSON serialization of the request on the client
2. WebSocket framing and TLS encryption
3. TCP transmission (even on loopback, this involves kernel context switches)
4. Java-side JSON parsing
5. JDBC execution and result set processing
6. JSON serialization of results on the server
7. The reverse path back to the Node.js client

With idb-pconnector, the C++ addon reads DB2 CLI result buffers directly and copies them across the N-API boundary once. For high-frequency, low-latency queries this eliminates a substantial amount of overhead.

**Note:**
- JSON serialization means converting a JavaScript object into a JSON string so it can be sent over the wire. Then on the server side, the Java process has to parse that string back into an object. The same thing happens in reverse for the results — the Java server serializes the result set into a JSON string, and the Node.js client parses it back with `JSON.parse`. idb-pconnector doesn't need any of this because it's not sending data over a network protocol. The C++ addon calls the SQL CLI functions directly with the SQL string as a C-style parameter — it's a function call within the same process, not a message sent to a remote server. There's no need to package the request into a transmittable format and unpackage it on the other end.

### Memory and Data Copying

The number of times result data is copied differs significantly:

- **Mapepire**: JDBC ResultSet -> Java objects -> JSON string -> WebSocket frame -> JS `JSON.parse` -> JS objects (4-5 copies)
- **idb-pconnector**: CLI result buffer -> N-API copy -> JS objects (1 copy)

Fewer copies means less CPU and memory pressure, particularly for large result sets.

### Server Process Overhead

Mapepire requires a Java server process that consumes its own CPU and memory. idb-pconnector has no server component. This means one fewer process competing for system resources, one fewer garbage collector running, and one fewer layer of memory allocation for result sets.

### Concurrent Request Handling

Mapepire's WebSocket protocol supports **multiplexing** — an async, id-correlated model where multiple queries can be in-flight on a single connection without serializing. Each request is assigned a unique ID, sent immediately over the WebSocket, and responses are routed back to the correct caller by ID. Liam's benchmarks ([blog #69](https://github.com/worksofliam/blog/issues/69)) demonstrated that this gives Mapepire a significant advantage over ODBC-based connectors when connecting remotely.

idb-pconnector, by contrast, can only process one query at a time per connection. Concurrency requires multiple connections via a pool.

rm-connector-js's RmPool treats both backends as one-query-at-a-time by default (the lowest common denominator). For mapepire-backed pools, rm-connector-js exposes an opt-in `multiplex: true` flag that lets each pool connection serve unlimited concurrent in-flight queries via Mapepire's native ID-correlated WebSocket protocol, round-robin dispatched across pool members. See [Opt-in multiplex mode](#opt-in-multiplex-mode-mapepire-only) below.

Benchmark results (see below) show where each mode wins:

- **On IBM i (local loopback)**: idb-pconnector is still the fastest option for typical concurrent workloads because it has no protocol overhead at all. However, within the mapepire backend, `multiplex: true` is **2.2x-7.8x faster than the serialized default** and **2.6x-5.4x faster than the native mapepire pool** across 50/100/200/400/1000/2000-query scales.
- **Off IBM i (remote)**: Multiplexing provides a 21x-29x speedup over the serialized default for concurrent workloads, and matches or slightly beats the native mapepire pool. Sequential workloads still pay rm-connector-js's attach/detach overhead (~2x slower than native) regardless of the `multiplex` setting, because there is no concurrency for multiplexing to overlap.

## Summary

| Factor | idb-pconnector (on IBM i) | Mapepire (on IBM i, loopback) |
|--------|--------------------------|-------------------------------|
| Connection creation | ~5-25ms | ~100-250ms |
| Per-query overhead | N-API boundary crossing only | JSON + WebSocket + TLS + Java + JDBC |
| Memory copies per result | 1 (CLI -> JS) | 4-5 (JDBC -> Java -> JSON -> WS -> JS) |
| Server process required | No | Yes (Java) |
| Concurrent query handling | Good with connection pool | Natively async per connection |
| Platform requirement | IBM i only | Various platforms |

## Benchmark Results

The following benchmarks were run on IBM i with both backends operating on the same machine. This fills a gap in the public record — prior benchmarks (such as Liam's [blog #69](https://github.com/worksofliam/blog/issues/69)) tested remote ODBC vs Mapepire from a Mac, not both connectors running locally on IBM i.

### Test Environment

- **Platform**: IBM i (Power 8, model 1308)
- **Node.js**: Running directly on IBM i
- **Mapepire**: Connecting via loopback (localhost)
- **idb-pconnector**: Native local connection (`*LOCAL`)
- **Queries per scenario**: 50, 200, and 1000 (with 3 warm-up queries excluded from measurement)
- **Runs per scenario**: 3 (values below are averaged medians across 3 runs)
- **Pool size**: 5 connections
- **Standard query**: `SELECT * FROM SAMPLE.DEPARTMENT`
- **Large result set query**: `SELECT * FROM SAMPLE.EMPLOYEE CROSS JOIN (VALUES 1,2,3,4,5,6,7,8,9,10) AS T(N)`

### Results

All values are median query times in milliseconds, averaged across 3 independent runs per query count.

| Scenario | 50q idb | 50q mapepire | 200q idb | 200q mapepire | 1000q idb | 1000q mapepire | Stable Ratio |
|---|---|---|---|---|---|---|---|
| Connection creation | 9.17ms | 30.80ms | 9.93ms | 30.90ms | 10.37ms | 36.93ms | **idb ~3.5x faster** |
| Single sequential | 0.68ms | 1.75ms | 0.94ms | 1.69ms | 0.91ms | 1.81ms | **idb ~2x faster** |
| Single sequential (large) | 23.47ms | 15.65ms | 17.70ms | 12.02ms | 17.73ms | 11.44ms | **mapepire ~1.5x faster** |
| Single Promise.all | 20.85ms | 22.06ms | 58.65ms | 75.02ms | 246.63ms | 422.98ms | **idb ~1.5x faster** |
| Pool sequential | 0.75ms | 2.08ms | 0.71ms | 1.85ms | 0.65ms | 1.69ms | **idb ~2.5x faster** |
| Pool Promise.all | 15.91ms | 51.61ms | 48.99ms | 135.44ms | 222.63ms | 600.29ms | **idb ~2.7x faster** |
| Parameterized sequential | 0.37ms | 1.21ms | 0.40ms | 1.20ms | 0.36ms | 1.10ms | **idb ~3x faster** |

**Notes:**
- Sequential means the queries run in serial (one query at a time, `await` in a `for` loop).
- The `Promise.all` tests fire all queries concurrently. The per-query medians above include time spent **waiting in the connection queue**, not just executing SQL. With 5 pool connections and 1000 queries, each query spends most of its measured time waiting its turn. For this reason the **wall clock time** (total time to complete the entire batch) is more meaningful for the Promise.all scenarios.
- The pool Promise.all tests rely on rm-connector-js's health check (enabled by default) slowing down each `attach()` call enough for earlier queries to complete and release their connections. Without the health check, the pool throws a "Maximum number of connections" error when concurrent demand exceeds pool size, because RmPool does not queue waiting requests — unlike Liam's ODBC pool (which has a built-in FIFO queue) or Mapepire's native pool (which multiplexes). This timing dependency is proven by the `pool-contention-proof` test suite.

### Wall Clock Times (Promise.all scenarios)

The wall clock measures how long it takes to process the entire batch of queries end-to-end. All values are in milliseconds, averaged across 3 runs.

| Scenario | 50q idb | 50q mapepire | 200q idb | 200q mapepire | 1000q idb | 1000q mapepire | Stable Ratio |
|---|---|---|---|---|---|---|---|
| Single Promise.all | 33.43ms | 28.70ms | 112.47ms | 110.58ms | 517.71ms | 600.67ms | **idb ~1.1x faster** |
| Pool Promise.all | 26.39ms | 108.20ms | 99.20ms | 263.19ms | 436.46ms | 1198.31ms | **idb ~2.7x faster** |

The pool Promise.all wall clock is the best throughput metric: it shows how quickly each backend can push N queries through 5 connections under maximum contention. At 1000 queries, idb completes the batch in under half a second while mapepire takes over a second.

### Analysis

- **idb-pconnector is consistently 2-3x faster for typical sequential workloads.** The pool sequential scenario (grab a connection, run a query, release) is closest to a typical production workload and shows a stable 2.5x advantage from idb-pconnector's zero-network-overhead architecture.
- **Results are highly reproducible.** Across 3 independent runs at each query count, idb medians barely moved (e.g., pool sequential: 0.66-0.70ms across all runs). Mapepire was equally stable for sequential workloads.
- **Parameterized queries show a similar ~3x advantage**, confirming the overhead is in the protocol layer, not the query type.
- **Large result sets consistently favour Mapepire by ~1.5x.** When DB2 execution and data transfer time dominates, the protocol overhead becomes negligible and Mapepire's server-side processing pulls ahead. This confirms the idb-pconnector advantage is most visible for lightweight, frequent queries — once each query returns a substantial payload, Mapepire's JDBC/JTOpen path handles it more efficiently than idb's CLI result buffering.
- **Single connection Promise.all** is the scenario where Mapepire's async WebSocket model should theoretically excel (as seen in Liam's remote benchmarks), yet idb still wins by ~1.5x. Running locally eliminates the network latency that gave Mapepire its advantage in remote scenarios.
- **Connection creation** shows a stable ~4x advantage on median, though the first idb connection consistently hits ~145-165ms (vs a ~6ms minimum), likely due to cold-start activation of the first QSQSRVR prestart job.
- **Mapepire shows larger outliers under sustained load.** At 1000 queries, mapepire's single-sequential max hit ~173ms in one run versus idb's ~36ms, suggesting occasional GC (Garbage Collection) pauses or WebSocket congestion in the Java server.

### Native Mapepire Pool vs idb (Multiplexing Test)

Mapepire's WebSocket protocol supports **multiplexing** — sending multiple queries concurrently on a single connection, with responses routed back by ID. This is fundamentally different from idb-pconnector, where each DB2 CLI connection can only process one query at a time. rm-connector-js's RmPool treats both backends as one-query-at-a-time by default (the lowest common denominator), so the standard benchmarks above do not take advantage of Mapepire's multiplexing.

To determine whether Mapepire's multiplexing could compensate for its higher per-query latency, a separate test was run comparing the **native @ibm/mapepire-js Pool** (with full multiplexing) against **idb-pconnector through RmPool** (one-at-a-time per connection). Both used 5 connections. All values below are wall-clock milliseconds averaged across 3 independent runs.

**Sequential (pool of 5, one query at a time):**

| Queries | idb Wall Clock | Mapepire (native) Wall Clock | Ratio |
|---|---|---|---|
| 50 | 77.34ms | 143.96ms | **idb 1.9x faster** |
| 200 | 315.47ms | 925.25ms | **idb 2.9x faster** |
| 1000 | 1582.37ms | 3739.61ms | **idb 2.4x faster** |

**Promise.all (all queries fired concurrently):**

| Queries | idb Wall Clock | Mapepire (native) Wall Clock | Ratio |
|---|---|---|---|
| 50 | 46.42ms | 294.30ms | **idb 6.3x faster** |
| 200 | 146.02ms | 320.69ms | **idb 2.2x faster** |
| 1000 | 787.63ms | 1505.35ms | **idb 1.9x faster** |

**High concurrency burst (QUERY_COUNT × 2 queries fired concurrently):**

| Queries | idb Wall Clock | Mapepire (native) Wall Clock | Ratio |
|---|---|---|---|
| 100 | 81.73ms | 282.57ms | **idb 3.5x faster** |
| 400 | 275.06ms | 690.23ms | **idb 2.5x faster** |
| 2000 | 1361.03ms | 4515.99ms | **idb 3.3x faster** |

**Native Mapepire multiplexing is slower than idb on loopback at every scale.** Even with 50 queries in-flight simultaneously across 5 WebSocket connections, native Mapepire took ~294ms vs idb's ~46ms — idb wins because it has no protocol overhead to begin with, and its 5 QSQSRVR jobs each process queries directly through shared memory. Notice the idb advantage is largest in the Promise.all 50-query scenario (6.3x) and narrows as concurrency grows — by the time both are processing 2000 queries through 5 pool connections, idb is "only" 3.3x faster because the mapepire-side protocol overhead is amortised across more work per round-trip.

The more interesting question is **why** native Mapepire performs so poorly here, and whether multiplexing itself is the problem or whether it's specific to native's implementation. The three-way benchmark below answers that.

### Three-way loopback: rm-connector-js serialized vs multiplex vs Native Mapepire Pool

To separate the effect of **multiplexing** from the effect of **dispatch strategy**, a three-way test runs serialized rm-connector-js, rm-connector-js with `multiplex: true`, and the native mapepire pool against the same server. All values below are wall-clock milliseconds averaged across 3 independent runs, pool size 5.

**Promise.all (concurrent burst):**

| Queries | rm serialized | rm `multiplex: true` | native mapepire | mux vs serialized | mux vs native |
|---|---|---|---|---|---|
| 50 | 179.19ms | **82.04ms** | 262.47ms | **2.2x faster** | **3.2x faster** |
| 200 | 749.81ms | **129.80ms** | 338.12ms | **5.8x faster** | **2.6x faster** |
| 1000 | 2271.77ms | **562.95ms** | 1997.63ms | **4.0x faster** | **3.5x faster** |

**High concurrency burst (QUERY_COUNT × 2 queries):**

| Queries | rm serialized | rm `multiplex: true` | native mapepire | mux vs serialized | mux vs native |
|---|---|---|---|---|---|
| 100 | 374.39ms | **48.14ms** | 259.44ms | **7.8x faster** | **5.4x faster** |
| 400 | 951.02ms | **173.71ms** | 770.59ms | **5.5x faster** | **4.4x faster** |
| 2000 | 4487.75ms | **968.83ms** | 4213.65ms | **4.6x faster** | **4.3x faster** |

Two things fall out of this:

- **Multiplexing itself isn't the problem on loopback — dispatch strategy is.** Native mapepire's `Pool.getJob()` returns the first job whose status is `ready`, so when queries complete quickly (as they do on loopback), the dispatcher keeps handing work to the earliest job in the array while later jobs stay idle. rm-connector-js's multiplex path does blind round-robin (`i++ % N`), which guarantees an even fan-out across all five WebSocket connections. Round-robin multiplexing is **2.2x-7.8x faster than serialized access** and **2.6x-5.4x faster than native mapepire's multiplexing** across every scale tested.
- **idb still wins for typical (moderate) concurrency on loopback.** At 50 concurrent queries, idb-RmPool completes in ~46ms vs rm multiplex's 82ms — idb's zero-protocol-overhead path is faster when there are few enough queries that connection contention is not the bottleneck. At 100 queries the picture shifts (rm multiplex 48ms vs idb-RmPool ~82ms) because rm multiplex fan-outs all 100 queries concurrently while idb-RmPool still queues 20 per connection sequentially. At 2000 queries, rm multiplex (969ms) also comes close to idb-RmPool (~1361ms avg across the 3 runs). For the workloads rm-connector-js is typically used for on IBM i, idb is still the right choice — but the margin narrows sharply as concurrency climbs.

This means the recommendation "use idb-pconnector on IBM i in production" is still correct for typical workloads, but the underlying reason is not "multiplexing is bad on loopback." It's "idb has no protocol overhead, so for moderate concurrency it wins regardless of what the mapepire side is doing." If you are running the mapepire backend on IBM i for some reason (e.g. platform-independent dev, or a deployment topology where idb is not available), **enable `multiplex: true`** — it is faster than the serialized default at every scale tested.

### Remote: rm-connector-js serialized vs multiplex vs Native Mapepire Pool

The local IBM i results above show that multiplexing hurts performance when there is no network latency. The opposite scenario was tested **remotely from a development PC** connecting to IBM i over a real network. Three modes were compared: rm-connector-js with its default serialized pool, rm-connector-js with the opt-in `multiplex: true` flag, and the native mapepire Pool (which multiplexes unconditionally).

**Promise.all (50 queries, pool of 5), wall clock:**

| Mode | Wall Clock | vs serialized | vs native |
|---|---|---|---|
| rm-connector-js serialized (default) | 5105.70ms | — | 13.9x slower |
| rm-connector-js `multiplex: true` | **240.29ms** | **21.2x faster** | **1.5x faster** |
| Native mapepire pool | 366.66ms | 13.9x faster | — |

**High concurrency burst (100 queries, pool of 5), wall clock:**

| Mode | Wall Clock | vs serialized | vs native |
|---|---|---|---|
| rm-connector-js serialized (default) | 10190.97ms | — | 26.0x slower |
| rm-connector-js `multiplex: true` | **351.47ms** | **29.0x faster** | **1.1x faster** |
| Native mapepire pool | 392.49ms | 26.0x faster | — |

**Sequential (50 queries, pool of 5), wall clock:**

| Mode | Wall Clock | Ratio |
|---|---|---|
| rm-connector-js (default / no multiplex) | 9796.23ms | — |
| Native mapepire pool | 4794.07ms | **native 2.0x faster** |

Sequential is not a multiplexing workload — queries run one after another with no concurrency to hide latency behind — so `multiplex: true` makes no difference here and the benchmark omits it. Native mapepire remains ~2x faster because rm-connector-js's attach/health-check/detach sequence is paid on every query, and each round-trip over the network amplifies that overhead.

**Why multiplex rm-connector-js slightly beats native for concurrent bursts:** native mapepire's `Pool.getJob()` returns the first job whose status is `ready`, so the dispatcher is biased toward the earliest job in the array. rm-connector-js's multiplex path does blind round-robin (`i++ % N`), which guarantees an even fan-out across all five WebSocket connections immediately. Over a real network the gap narrows at higher concurrency (1.5x at 50q → 1.1x at 100q) because latency dominates the wall clock and the dispatcher cost is a smaller fraction — but the evenness never hurts.

This reveals a clear trade-off in rm-connector-js's design:

- **On IBM i (production)**: The serialized pool model is optimal — idb-pconnector wins regardless, and serialized access is actually faster than multiplexing on local loopback.
- **Off IBM i (development / remote)**: Enable `multiplex: true` for concurrent workloads. Sequential workloads still pay the ~2x attach/detach overhead against native, but concurrent bursts match or slightly beat native without users having to drop down to the native API. See the [Opt-in multiplex mode](#opt-in-multiplex-mode-mapepire-only) section below.

### Opt-in multiplex mode (mapepire only)

By default RmPool serializes one query at a time per connection, which is the right call on local IBM i (see above). For remote workstation-to-IBM-i workloads where multiplexing pays off, you can opt in by setting `multiplex: true` on the pool config (mapepire backend only — idb is rejected at construction).

```ts
const pool = new RmPool({
  id: 'remote',
  config: {
    id: 'remote',
    PoolOptions: {
      backend: 'mapepire',
      creds: { host, user, password },
      maxSize: 5,
      initialConnections: { size: 5 },
      multiplex: true,
    },
  },
});
```

When `multiplex: true`:

- Each `RmPoolConnection` is **shared**: multiple callers can hold it at the same time, and concurrent `pool.query()` calls map directly to mapepire-js's parallel `job.execute()` calls on the same `SQLJob`.
- `attach()` round-robins across pool members rather than claiming exclusive ownership; `detach()` is a no-op. The promise-chain mutex stays in place (its cost is negligible in this path) but it no longer gates concurrency.
- Per-attach health checks are skipped (they would defeat the point). Use `healthCheck.keepalive` for periodic background checks instead.
- `connection.expiry` still applies, interpreted as max age from creation. If the timer fires while `inFlight > 0`, retirement is deferred until in-flight queries finish; the pool then auto-creates a replacement so subsequent attaches still find a connection.
- `getInfo()` exposes a new `inFlight` counter (and `multiplex: true`) for visibility, since `available`/`busy` no longer carry their usual meaning.

**When to use it:** any mapepire workload with concurrent queries (Promise.all, burst patterns).

- **Remote (workstation-to-IBM-i over a network):** 21x faster than serialized at 50 concurrent queries and 29x faster at 100, matching or slightly beating the native mapepire Pool on the same host.
- **Local (on IBM i loopback):** 2.2x-7.8x faster than serialized mapepire, and 2.6x-5.4x faster than the native mapepire Pool across 50/100/200/400/1000/2000-query scales. Round-robin dispatch wins over native's first-ready-job bias even without network latency. Note this is still within the *mapepire backend* — if you are on IBM i, idb-pconnector remains the fastest option for moderate concurrency regardless.

**When not to use it:** purely sequential workloads (there is no concurrency to hide latency behind — multiplex provides no benefit for sequential traffic, and the serialized default is slightly simpler to reason about operationally).

A three-way benchmark (`tests/performance/remote-mapepire-multiplex.test.ts`) compares serialized RmPool, multiplex RmPool, and the native mapepire pool on the same host so you can verify the gain on your network before adopting it in production.

### Reproducing These Benchmarks

The benchmark suite is included in the rm-connector-js test suite. All tests require environment variables: `IBMI_HOST`, `IBMI_USER`, `IBMI_PASSWORD`.

1. Ensure the SAMPLE schema exists on your IBM i:
   ```sql
   CALL QSYS.CREATE_SQL_SAMPLE('SAMPLE');
   ```

2. Run all performance tests (idb vs mapepire through rm-connector-js):
   ```bash
   IBMI_HOST=myibmi.com IBMI_USER=MYUSER IBMI_PASSWORD=MYPASS npm run test:performance

   # or ...
   export IBMI_HOST=myibmi.com
   export IBMI_USER=MYUSER
   export IBMI_PASSWORD=MYPASS
   npm run test:performance
   ```

3. Optionally configure the number of queries per scenario (default: 50) and the SAMPLE schema name (default: SAMPLE):
   ```bash
   QUERY_COUNT=200 SAMPLE_SCHEMA=MYLIB IBMI_HOST=myibmi.com IBMI_USER=MYUSER IBMI_PASSWORD=MYPASS npm run test:performance
   ```

4. Run individual test suites separately:
   ```bash
   # idb vs mapepire through rm-connector-js (on IBM i)
   npx jest --config jest.perf.config.js backend-performance

   # Native mapepire pool vs idb through RmPool (on IBM i)
   npx jest --config jest.perf.config.js native-mapepire-pool

   # Native mapepire pool vs rm-connector-js mapepire pool (from remote dev PC)
   npx jest --config jest.perf.config.js remote-mapepire-pool

   # Three-way: rm-connector-js serialized vs multiplex vs native (from remote dev PC)
   npx jest --config jest.perf.config.js remote-mapepire-multiplex

   # Pool contention proof (on IBM i)
   npx jest --config jest.perf.config.js pool-contention-proof
   ```

## Conclusion

The performance benefits of idb-pconnector over Mapepire when running on IBM i are real and stem from fundamental architectural differences: no network layer, no serialization overhead, no intermediary server process, and fewer data copies. These are not micro-optimizations that could disappear with a library update; they are inherent to the design of each connector.

Key findings:

- **On IBM i, idb-pconnector is 2-3x faster** for typical sequential workloads and up to ~6x faster under concurrent load, even when compared against Mapepire's native multiplexing capabilities.
- **Native Mapepire's multiplexing underperforms on loopback** — not because multiplexing is a bad idea there, but because native's `Pool.getJob()` biases dispatch toward the first ready job and leaves the rest underused when queries complete quickly. rm-connector-js's `multiplex: true` uses round-robin dispatch instead, which is 2.6x-5.4x faster than native mapepire and 2.2x-7.8x faster than rm-connector-js's own serialized default on loopback across 50/100/200/400/1000/2000-query scales.
- **Over a real network, multiplexing is transformative** — rm-connector-js's default serialized pool is up to 29x slower than multiplexing for concurrent bursts, because each query pays the full round-trip latency sequentially.
- **rm-connector-js offers opt-in multiplexing as a universal win for concurrent mapepire workloads.** Set `multiplex: true` and the mapepire backend matches or slightly beats the native mapepire Pool in every concurrent scenario we measured, both local and remote. Sequential workloads are unchanged — native remains ~2x faster there due to rm-connector-js's per-query attach/detach overhead.
- **The right defaults depend on which backend, not where you run.** On IBM i, idb-pconnector is still the best choice for typical concurrent workloads — it has no protocol overhead at all, and wins regardless of what happens on the mapepire side. Off IBM i, use the mapepire backend with `multiplex: true` for concurrent workloads, or leave `multiplex` off for purely sequential ones.

The rm-connector-js approach of using Mapepire for off-IBM i development and idb-pconnector for on-IBM i production combines the convenience of cross-platform development with the performance benefits of native database access where it matters most — and the opt-in multiplex mode closes the remaining gap against native mapepire for concurrent workloads over a network.

## References

- [IBM/nodejs-idb-connector (GitHub)](https://github.com/IBM/nodejs-idb-connector)
- [IBM/nodejs-idb-pconnector (GitHub)](https://github.com/IBM/nodejs-idb-pconnector)
- [Mapepire-IBMi/mapepire-server (GitHub)](https://github.com/Mapepire-IBMi/mapepire-server)
- [Mapepire documentation](https://mapepire-ibmi.github.io/)
- [Mapepire: A new IBM i database client (Liam)](https://github.com/worksofliam/blog/issues/68)
- [Mapepire: Node.js performance testing against ODBC (Liam)](https://github.com/worksofliam/blog/issues/69)
- [IBM Introduces Mapepire (IT Jungle)](https://www.itjungle.com/2024/09/09/ibm-introduces-mapepire-the-new-db2-for-i-client/)

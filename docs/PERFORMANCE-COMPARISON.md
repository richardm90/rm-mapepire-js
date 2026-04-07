# Performance Comparison: idb-connector vs Mapepire

## Introduction

One of the primary motivations behind rm-connector-js is enabling a dual-environment development workflow: develop locally using Mapepire (which can connect to IBM i from various platforms) and deploy to production on IBM i using idb-connector for superior performance. This document examines the architectural and performance differences between the two database connectors to validate that assumption with technical evidence.

## Architecture Overview

### idb-connector

idb-connector is a native C++ Node.js addon (N-API) that calls the DB2 SQL CLI API directly on IBM i. Its data path is:

```
Node.js -> N-API C++ addon -> DB2 SQL CLI -> QSQSRVR job (shared memory/IPC)
```

- Runs only on IBM i
- No network layer involved; communication with the database is via OS-level IPC
- No server component to install or manage
- Jobs run under the `QSQSRVR` subsystem

**Notes:**
- N-API (Node-API) is Node.js's stable C/C++ interface for building native addons — modules written in C or C++ that can be called directly from JavaScript. In the case of idb-connector, the addon is the bridge between your JavaScript code and the IBM i operating system's DB2 SQL CLI (Call Level Interface).
- When idb-connector calls the DB2 SQL CLI, it doesn't talk to the database engine directly in the same process. Instead, the SQL CLI communicates with a QSQSRVR job — a separate prestart job running on IBM i that handles the actual database work. IPC (Inter-Process Communication) refers to how these two processes talk to each other. On IBM i, this happens through OS-level mechanisms like shared memory segments rather than network sockets. The key point is that this communication stays entirely within the machine's memory — no TCP/IP stack, no serialization to a wire format, no encryption overhead.

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
| idb-connector | ~5-25ms |
| Mapepire | ~100-250ms |

The difference is due to Mapepire requiring a TCP connection, TLS handshake, WebSocket upgrade, and JDBC connection setup, whereas idb-connector performs a single local CLI connect call.

This matters for connection pool creation, recovery after idle connection expiry, and burst scenarios where new connections must be established quickly.

### Per-Query Overhead

Every Mapepire query involves the following steps that idb-connector avoids entirely:

1. JSON serialization of the request on the client
2. WebSocket framing and TLS encryption
3. TCP transmission (even on loopback, this involves kernel context switches)
4. Java-side JSON parsing
5. JDBC execution and result set processing
6. JSON serialization of results on the server
7. The reverse path back to the Node.js client

With idb-connector, the C++ addon reads DB2 CLI result buffers directly and copies them across the N-API boundary once. For high-frequency, low-latency queries this eliminates a substantial amount of overhead.

**Note:**
- JSON serialization means converting a JavaScript object into a JSON string so it can be sent over the wire. Then on the server side, the Java process has to parse that string back into an object. The same thing happens in reverse for the results — the Java server serializes the result set into a JSON string, and the Node.js client parses it back with `JSON.parse`. idb-connector doesn't need any of this because it's not sending data over a network protocol. The C++ addon calls the SQL CLI functions directly with the SQL string as a C-style parameter — it's a function call within the same process, not a message sent to a remote server. There's no need to package the request into a transmittable format and unpackage it on the other end.

### Memory and Data Copying

The number of times result data is copied differs significantly:

- **Mapepire**: JDBC ResultSet -> Java objects -> JSON string -> WebSocket frame -> JS `JSON.parse` -> JS objects (4-5 copies)
- **idb-connector**: CLI result buffer -> N-API copy -> JS objects (1 copy)

Fewer copies means less CPU and memory pressure, particularly for large result sets.

### Server Process Overhead

Mapepire requires a Java server process that consumes its own CPU and memory. idb-connector has no server component. This means one fewer process competing for system resources, one fewer garbage collector running, and one fewer layer of memory allocation for result sets.

### Concurrent Request Handling

This is one area where Mapepire has an architectural advantage. Its WebSocket protocol uses an async, id-correlated model where multiple queries can be in-flight on a single connection without serializing. Liam's benchmarks ([blog #69](https://github.com/worksofliam/blog/issues/69)) demonstrated that Mapepire handles concurrent requests more gracefully than ODBC-based connectors.

However, this advantage is largely mitigated when using connection pooling (as rm-connector-js does), since each consumer gets its own dedicated connection.

## Summary

| Factor | idb-connector (on IBM i) | Mapepire (on IBM i, loopback) |
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
- **idb-connector**: Native local connection (`*LOCAL`)
- **Queries per scenario**: 50, 200, and 1000 (with 3 warm-up queries excluded from measurement)
- **Runs per scenario**: 3 (values below are averaged medians across 3 runs)
- **Pool size**: 5 connections
- **Standard query**: `SELECT * FROM SAMPLE.DEPARTMENT`
- **Large result set query**: `SELECT * FROM QIWS.QCUSTCDT CROSS JOIN (VALUES 1,2,3,4,5,6,7,8,9,10) AS T(N)`

### Results

All values are median query times in milliseconds, averaged across 3 independent runs per query count.

| Scenario | 50q idb | 50q mapepire | 200q idb | 200q mapepire | 1000q idb | 1000q mapepire | Stable Ratio |
|---|---|---|---|---|---|---|---|
| Connection creation | 7.13ms | 28.07ms | 7.16ms | 27.28ms | 6.91ms | 29.00ms | **idb ~4x faster** |
| Single sequential | 0.55ms | 1.44ms | 0.54ms | 1.28ms | 0.49ms | 0.99ms | **idb ~2x faster** |
| Single sequential (large) | 5.03ms | 4.80ms | 4.96ms | 4.36ms | 4.91ms | 4.37ms | **mapepire ~1.1x faster** |
| Single Promise.all | 20.76ms | 24.02ms | 54.35ms | 74.74ms | 265.30ms | 421.14ms | **idb ~1.5x faster** |
| Pool sequential | 0.70ms | 2.46ms | 0.68ms | 2.00ms | 0.66ms | 1.63ms | **idb ~2.5x faster** |
| Pool Promise.all | 15.76ms | 47.42ms | 49.76ms | 131.40ms | 227.65ms | 594.86ms | **idb ~2.6x faster** |
| Parameterized sequential | 0.38ms | 1.39ms | 0.38ms | 1.08ms | 0.40ms | 1.22ms | **idb ~3x faster** |

**Notes:**
- Sequential means the queries run in serial (one query at a time, `await` in a `for` loop).
- The `Promise.all` tests fire all queries concurrently. The per-query medians above include time spent **waiting in the connection queue**, not just executing SQL. With 5 pool connections and 1000 queries, each query spends most of its measured time waiting its turn. For this reason the **wall clock time** (total time to complete the entire batch) is more meaningful for the Promise.all scenarios.

### Wall Clock Times (Promise.all scenarios)

The wall clock measures how long it takes to process the entire batch of queries end-to-end. All values are in milliseconds, averaged across 3 runs.

| Scenario | 50q idb | 50q mapepire | 200q idb | 200q mapepire | 1000q idb | 1000q mapepire | Stable Ratio |
|---|---|---|---|---|---|---|---|
| Single Promise.all | 32.97ms | 32.71ms | 104.20ms | 118.17ms | 549.31ms | 617.56ms | **idb ~1.1x faster** |
| Pool Promise.all | 26.15ms | 85.58ms | 93.51ms | 253.61ms | 448.51ms | 1189.46ms | **idb ~2.7x faster** |

The pool Promise.all wall clock is the best throughput metric: it shows how quickly each backend can push N queries through 5 connections under maximum contention. At 1000 queries, idb completes the batch in under half a second while mapepire takes over a second.

### Analysis

- **idb-connector is consistently 2-3x faster for typical sequential workloads.** The pool sequential scenario (grab a connection, run a query, release) is closest to a typical production workload and shows a stable 2.5x advantage from idb-connector's zero-network-overhead architecture.
- **Results are highly reproducible.** Across 3 independent runs at each query count, idb medians barely moved (e.g., pool sequential: 0.66-0.70ms across all runs). Mapepire was equally stable for sequential workloads.
- **Parameterized queries show a similar ~3x advantage**, confirming the overhead is in the protocol layer, not the query type.
- **Large result sets consistently favour Mapepire by ~1.1x.** When DB2 execution and data transfer time dominates, the protocol overhead becomes negligible. Mapepire's server-side processing edges ahead by a small margin, confirming that the idb-connector advantage is most visible for lightweight, frequent queries.
- **Single connection Promise.all** is the scenario where Mapepire's async WebSocket model should theoretically excel (as seen in Liam's remote benchmarks), yet idb still wins by ~1.5x. Running locally eliminates the network latency that gave Mapepire its advantage in remote scenarios.
- **Connection creation** shows a stable ~4x advantage on median, though the first idb connection consistently hits ~145-165ms (vs a ~6ms minimum), likely due to cold-start activation of the first QSQSRVR prestart job.
- **Mapepire shows larger outliers under sustained load.** At 1000 queries, mapepire's max times grow disproportionately (e.g., parameterized query max: 73ms in one run vs idb's 5.67ms), suggesting occasional GC (Garbage Collection) pauses or WebSocket congestion in the Java server.

### Reproducing These Benchmarks

The benchmark suite is included in the rm-connector-js test suite. To run it:

1. Ensure the SAMPLE schema exists on your IBM i:
   ```sql
   CALL QSYS.CREATE_SQL_SAMPLE('SAMPLE');
   ```

2. Run the performance tests:
   ```bash
   IBMI_HOST=myibmi.com IBMI_USER=MYUSER IBMI_PASSWORD=MYPASS npm run test:performance
   ```

3. Optionally configure the number of queries per scenario (default: 50) and the SAMPLE schema name (default: SAMPLE):
   ```bash
   QUERY_COUNT=200 SAMPLE_SCHEMA=MYLIB IBMI_HOST=myibmi.com IBMI_USER=MYUSER IBMI_PASSWORD=MYPASS npm run test:performance
   ```

## Conclusion

The performance benefits of idb-connector over Mapepire when running on IBM i are real and stem from fundamental architectural differences: no network layer, no serialization overhead, no intermediary server process, and fewer data copies. These are not micro-optimizations that could disappear with a library update; they are inherent to the design of each connector.

The rm-connector-js approach of using Mapepire for off-IBM i development and idb-connector for on-IBM i production combines the convenience of cross-platform development with the performance benefits of native database access where it matters most.

## References

- [IBM/nodejs-idb-connector (GitHub)](https://github.com/IBM/nodejs-idb-connector)
- [IBM/nodejs-idb-pconnector (GitHub)](https://github.com/IBM/nodejs-idb-pconnector)
- [Mapepire-IBMi/mapepire-server (GitHub)](https://github.com/Mapepire-IBMi/mapepire-server)
- [Mapepire documentation](https://mapepire-ibmi.github.io/)
- [Mapepire: A new IBM i database client (Liam)](https://github.com/worksofliam/blog/issues/68)
- [Mapepire: Node.js performance testing against ODBC (Liam)](https://github.com/worksofliam/blog/issues/69)
- [IBM Introduces Mapepire (IT Jungle)](https://www.itjungle.com/2024/09/09/ibm-introduces-mapepire-the-new-db2-for-i-client/)

/**
 * Multiplex Mode Example
 *
 * Demonstrates the opt-in multiplex: true mode (mapepire backend only):
 *
 * - Each RmPoolConnection is SHARED — multiple callers can hold it
 *   simultaneously and concurrent pool.query() calls map directly to
 *   mapepire-js's parallel job.execute() calls on the same SQLJob.
 * - attach() round-robins across pool members instead of claiming
 *   exclusive ownership; detach() becomes a no-op.
 * - The pool is FIXED SIZE. initialConnections.size IS the pool size,
 *   maxSize is only a safety cap on initial creation, and
 *   incrementConnections is ignored. See the README's "Pool sizing
 *   under multiplex" section for the full rules.
 * - Per-attach health checks are skipped — use healthCheck.keepalive
 *   for periodic background checks instead.
 *
 * When to use this:
 *   - Mapepire workloads with CONCURRENT queries (Promise.all, burst
 *     patterns) where the default serialized pool becomes the bottleneck.
 *   - Especially valuable over a real network (workstation → remote IBM i)
 *     where round-trip latency is large: measured 21-29x faster than the
 *     serialized default for concurrent bursts.
 *
 * When NOT to use this:
 *   - Purely sequential workloads — multiplex provides no benefit when
 *     there is no concurrency to hide latency behind.
 *   - The idb backend — rm-connector-js rejects multiplex: true + idb at
 *     init with a clear error (idb is shared-memory IPC and cannot
 *     multiplex).
 */

const { RmPools } = require('rm-connector-js');

async function main() {
  const pools = new RmPools({
    logLevel: 'info',
    pools: [
      {
        id: 'mydb',
        PoolOptions: {
          backend: 'mapepire',
          creds: {
            host: 'myibmi.com',
            user: 'MYUSER',
            password: 'MYPASSWORD',
            rejectUnauthorized: false,
          },

          // Under multiplex, initialConnections.size IS the pool size.
          // There is no auto-growth — concurrency is handled by fanning
          // queries through these same connections via round-robin.
          initialConnections: { size: 5, expiry: null },

          // maxSize is only a safety cap on initial creation here.
          // It is NOT an elastic ceiling under load.
          maxSize: 10,

          // Multiplex mode: shared connections, round-robin dispatch,
          // unlimited in-flight per connection.
          multiplex: true,

          // Per-attach health checks are skipped in multiplex mode.
          // Use keepalive for periodic background checks instead.
          healthCheck: {
            keepalive: 5, // ping idle connections every 5 minutes
          },
        },
      },
    ],
  });

  await pools.init();
  const pool = await pools.get('mydb');

  // Fire a burst of 50 concurrent queries at a pool of 5 connections.
  // Round-robin dispatch means each connection carries ~10 queries
  // in flight at once, all demuxed by mapepire-js's correlation IDs.
  const N = 50;
  const start = Date.now();

  // Note the explicit CAST on the parameter marker. DB2 for i cannot
  // infer the data type of a bare `?` in a SELECT list (there is no
  // comparison column to provide context) and will return SQL0418
  // "Use of parameter marker, NULL, or UNKNOWN not valid." without it.
  // In a WHERE clause the column type gives DB2 the context it needs
  // and the cast is not required.
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      pool.query('SELECT CAST(? AS INTEGER) AS query_number FROM SYSIBM.SYSDUMMY1', {
        parameters: [i],
      })
    )
  );

  const elapsed = Date.now() - start;
  console.log(`Completed ${N} concurrent queries in ${elapsed}ms`);
  console.log(`First result:`, results[0].data);
  console.log(`Last result:`, results[N - 1].data);

  // Mid-flight visibility: getInfo() exposes an inFlight counter per
  // connection (since available/busy no longer carry their usual meaning
  // in multiplex mode). Here we inspect the pool after the burst — all
  // queries have completed so inFlight should be 0 on every connection.
  const info = pool.getInfo();
  console.log('\nPool info after burst:');
  console.log(JSON.stringify(info, null, 2));

  await pools.close();
  console.log('\nDone.');
}

async function idbRejectionExample() {
  // Combining multiplex: true with the idb backend is rejected at init
  // with a clear error. idb is shared-memory IPC to a single QSQSRVR job
  // per connection and cannot multiplex in any meaningful way.
  const pools = new RmPools({
    logLevel: 'info',
    pools: [
      {
        id: 'mydb',
        PoolOptions: {
          backend: 'idb',
          multiplex: true, // rejected
        },
      },
    ],
  });

  try {
    await pools.init();
  } catch (err) {
    console.error('Expected error:', err.message);
    // => RmPool: multiplex mode is not supported with the idb backend ...
  }
}

main().catch(console.error);
// idbRejectionExample().catch(console.error);

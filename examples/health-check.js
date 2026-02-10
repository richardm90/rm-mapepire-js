/**
 * Health Check Example
 *
 * Demonstrates the connection health check feature:
 *
 * - By default, every attach() verifies the connection is alive by
 *   executing a lightweight query (VALUES 1) before returning it.
 * - If a connection has gone stale (e.g. the IBM i job was killed),
 *   it is automatically retired and the next healthy connection is
 *   returned instead.
 * - The health check can be disabled via healthCheck.onAttach: false
 *   if the overhead of the extra round-trip is not desired.
 */

const { rmPools } = require('rm-mapepire-js');

async function main() {
  // Health check enabled (default behaviour)
  const pools = new rmPools({
    debug: true,
    pools: [
      {
        id: 'mydb',
        PoolOptions: {
          creds: {
            host: 'myibmi.com',
            user: 'MYUSER',
            password: 'MYPASSWORD',
            rejectUnauthorized: false
          },
          maxSize: 10,
          initialConnections: { size: 3 },
          // healthCheck.onAttach defaults to true — every attach()
          // verifies the connection is alive before returning it.
        },
      },
    ],
  });

  await pools.init();
  const pool = await pools.get('mydb');

  // Each attach() runs a health check. If a connection has died
  // (e.g. job ended on the IBM i), it is retired transparently
  // and the next healthy connection is returned.
  const conn = await pool.attach();
  const result = await conn.query('SELECT * FROM QIWS.QCUSTCDT');
  console.log('Query result:', result);
  await pool.detach(conn);

  // Or use pool.query() which handles attach/detach automatically
  const result2 = await pool.query('SELECT * FROM QIWS.QCUSTCDT');
  console.log('Query result:', result2);

  await pools.close();

  pool.printInfo();

  console.log('Done.');
}

async function disabledExample() {
  // Health check disabled — for environments where the extra
  // round-trip per attach is not acceptable.
  const pools = new rmPools({
    debug: true,
    pools: [
      {
        id: 'mydb',
        PoolOptions: {
          creds: {
            host: 'myibmi.com',
            user: 'MYUSER',
            password: 'MYPASSWORD',
            rejectUnauthorized: false
          },
          healthCheck: {
            onAttach: false, // Skip health check on attach
          },
        },
      },
    ],
  });

  await pools.init();
  const pool = await pools.get('mydb');

  // No health check — attach returns the connection immediately
  const conn = await pool.attach();
  const result = await conn.query('SELECT * FROM QIWS.QCUSTCDT');
  console.log('Query result:', result);
  await pool.detach(conn);

  await pools.close();

  pool.printInfo();
}

// main().catch(console.error);
disabledExample().catch(console.error);

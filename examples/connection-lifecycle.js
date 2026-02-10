/**
 * Connection Lifecycle Example
 *
 * Demonstrates how connection expiry works in practice:
 *
 * - Initial connections have no expiry (expiry: null), so they persist
 *   for the lifetime of the pool.
 * - Increment (overflow) connections are created on demand when all
 *   initial connections are busy, and expire after a set period of
 *   inactivity (e.g. 1 minute), automatically freeing IBM i job resources.
 *
 * This example creates a pool with 2 initial connections (no expiry)
 * and configures overflow connections to expire after 1 minute.
 * It then uses 3 connections (forcing an overflow), detaches them,
 * and waits for the overflow connection to expire.
 */

const { RmPools } = require('rm-mapepire-js');

async function main() {
  const pools = new RmPools({
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
          initialConnections: {
            size: 2,        // 2 connections created at startup
            expiry: null,   // These never expire
          },
          incrementConnections: {
            size: 1,        // Add 1 connection at a time when pool is exhausted
            expiry: 1,      // Overflow connections expire after 1 minute idle
          },
        },
      },
    ],
  });

  await pools.init();

  const pool = await pools.get('mydb');
  if (!pool) {
    throw new Error('Pool not found');
  }

  // Use all 2 initial connections
  const conn1 = await pool.attach();
  const conn2 = await pool.attach();

  // This triggers creation of an overflow connection (3rd)
  const conn3 = await pool.attach();

  console.log('\n--- After attaching 3 connections ---');
  pool.printStats();

  await conn1.query('SELECT * FROM QIWS.QCUSTCDT');
  await conn2.query('SELECT * FROM QIWS.QCUSTCDT');
  await conn3.query('SELECT * FROM QIWS.QCUSTCDT');

  // Detach all connections back to the pool
  await pool.detach(conn1);
  await pool.detach(conn2);
  await pool.detach(conn3);

  console.log('\n--- After detaching all connections ---');
  console.log('The overflow connection (conn3) will expire in 1 minute.');
  pool.printStats();

  // Wait 70 seconds for the overflow connection to expire
  console.log('\nWaiting 70 seconds for overflow connection to expire...');
  await new Promise(resolve => setTimeout(resolve, 70000));

  console.log('\n--- After expiry ---');
  console.log('The overflow connection has been retired automatically.');
  pool.printStats();

  // Close the pool
  await pool.close();
  console.log('\nPool closed.');
}

main().catch(console.error);

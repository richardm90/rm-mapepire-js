/**
 * Pool Diagnostics Example
 *
 * Demonstrates the diagnostic methods available on pools and connections:
 * - getInfo()    — returns pool/connection details as an object
 * - printInfo()  — prints a formatted summary to the console
 * - getStats()   — returns summary statistics as an object
 * - printStats() — prints summary statistics to the console
 */

const { RmPools, RmConnection } = require('rm-connector-js');
// const { RmPools, RmConnection } = require('../dist');

async function main() {
  const pools = new RmPools({
    pools: [
      {
        id: 'mydb',
        PoolOptions: {
          creds: {
            host: 'myibmi.com',
            user: 'MYUSER',
            password: 'MYPASSWORD',
            rejectUnauthorized: false,
          },
          maxSize: 10,
          initialConnections: {
            size: 2,
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

  // --- getInfo() — returns detailed pool information as an object ---
  const info = pool.getInfo();
  console.log('Pool info:', JSON.stringify(info, null, 2));

  // --- printInfo() — prints a formatted summary to the console ---
  pool.printInfo();

  // --- getStats() — returns summary statistics as an object ---
  const stats = pool.getStats();
  console.log('Pool stats:', JSON.stringify(stats, null, 2));

  // --- printStats() — prints summary statistics to the console ---
  pool.printStats();

  // --- Pool connection diagnostics ---
  const conn = await pool.attach();

  // getInfo() on a pool connection
  const connInfo = conn.getInfo();
  console.log('\nPool connection info:', JSON.stringify(connInfo, null, 2));

  // printInfo() on a pool connection
  conn.printInfo();

  // Observe the change in pool stats while a connection is attached
  console.log('\nAfter attaching a connection:');
  pool.printStats();

  await pool.detach(conn);
  console.log('\nAfter detaching the connection:');
  pool.printStats();

  await pool.retireAll();

  // --- Standalone connection diagnostics ---
  const standalone = new RmConnection({
    creds: {
      host: 'myibmi.com',
      user: 'MYUSER',
      password: 'MYPASSWORD',
      rejectUnauthorized: false,
    },
  });

  await standalone.init();

  // getInfo() on a standalone connection
  const standaloneInfo = standalone.getInfo();
  console.log('\nStandalone connection info:', JSON.stringify(standaloneInfo, null, 2));

  // printInfo() on a standalone connection
  standalone.printInfo();

  await standalone.close();
}

main().catch(console.error);

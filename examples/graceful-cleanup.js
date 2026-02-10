/**
 * Graceful Cleanup Example
 *
 * Demonstrates how to properly clean up connections and pools
 * when your application is shutting down.
 *
 * - detach: returns a connection to the pool (marks it as available)
 * - detachAll: returns all connections in a pool
 * - retire: permanently closes a single connection
 * - retireAll: permanently closes all connections in a pool
 */

const { RmPools } = require('rm-mapepire-js');

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
            rejectUnauthorized: false
          },
          maxSize: 10,
          initialConnections: {
            size: 3,
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

  // Attach and use multiple connections
  const conn1 = await pool.attach();
  const conn2 = await pool.attach();

  await conn1.query('SELECT * FROM QIWS.QCUSTCDT WHERE STATE=\'MN\'');
  await conn2.query('SELECT * FROM QIWS.QCUSTCDT WHERE STATE=\'NY\'');

  // Return individual connections to the pool
  await pool.detach(conn1);
  await pool.detach(conn2);

  // Or return all connections at once
  await pool.detachAll();

  // When shutting down, retire all connections to close them permanently
  await pool.retireAll();
  console.log('All connections closed');
}

main().catch(console.error);

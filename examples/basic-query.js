/**
 * Basic Query Example
 *
 * Demonstrates how to set up a connection pool and execute a simple SQL query.
 */

const { RmPools } = require('rm-mapepire-js');
// const { RmPools } = require('../dist');

async function main() {
  // Create a pools manager with a single pool
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
            size: 2,
          },
        },
      },
    ],
  });

  // Initialize all pools (creates the initial connections)
  await pools.init();

  // Get the pool by its id
  const pool = await pools.get('mydb');
  if (!pool) {
    throw new Error('Pool not found');
  }

  // Attach a connection from the pool
  const conn = await pool.attach();

  // Execute a query
  const result = await conn.query('SELECT * FROM QIWS.QCUSTCDT');
  console.log(result.data);

  // Return the connection to the pool when done
  await pool.detach(conn);

  // Retire all connections
  await pool.retireAll();
}

main().catch(console.error);
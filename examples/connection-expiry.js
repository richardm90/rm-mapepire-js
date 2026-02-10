/**
 * Connection Expiry Example
 *
 * Demonstrates how to configure automatic connection expiry.
 * Idle connections are automatically retired after the specified
 * number of minutes, helping to free up IBM i job resources.
 *
 * - Initial connections: created at pool startup
 * - Increment connections: created on demand when all existing
 *   connections are busy (up to maxSize)
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
          maxSize: 20,
          initialConnections: {
            size: 4,
            expiry: 30, // Initial connections expire after 30 minutes idle
          },
          incrementConnections: {
            size: 2,
            expiry: 10, // Overflow connections expire after 10 minutes idle
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

  // When all 4 initial connections are busy and a 5th is requested,
  // the pool will create 2 more connections (incrementConnections.size).
  // Those overflow connections will expire after 10 minutes of being idle.
  const conn = await pool.attach();
  const result = await conn.query('SELECT * FROM QIWS.QCUSTCDT');
  console.log(result);
  await pool.detach(conn);

  // Retire all connections
  await pool.retireAll();
}

main().catch(console.error);

/**
 * Environment Variables Example
 *
 * Demonstrates how to set IBM i job-level environment variables
 * on pooled connections. These are set via the ADDENVVAR CL command
 * when each connection is initialized.
 */

const { rmPools } = require('rm-mapepire-js');

async function main() {
  const pools = new rmPools({
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
          envvars: [
            { envvar: 'APP_ENV', value: 'production' },
            { envvar: 'LOG_LEVEL', value: 'info' },
            { envvar: 'REGION', value: 'UK_SW' },
          ],
        },
      },
    ],
  });

  await pools.init();

  // Each connection in the pool will have the environment variables set
  const pool = await pools.get('mydb');
  if (!pool) {
    throw new Error('Pool not found');
  }

  const conn = await pool.attach();

  // The environment variables are available to programs running in
  // the IBM i job associated with this connection
  const result = await conn.query('SELECT * FROM QIWS.QCUSTCDT');
  console.log(result);

  await pool.detach(conn);

  // Retire all connections
  await pool.retireAll();
}

main().catch(console.error);

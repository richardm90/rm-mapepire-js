/**
 * Init Commands Example
 *
 * Demonstrates how to run setup commands on each pooled connection
 * when it is initialized. Commands can be CL commands (default) or
 * SQL statements.
 *
 * Use cases include setting environment variables, adjusting the
 * library list, or calling IBM i programs to configure the job.
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
          initCommands: [
            // CL commands (type defaults to 'cl')
            { command: "ADDENVVAR ENVVAR(APP_ENV) VALUE('production') REPLACE(*YES)" },
            { command: "ADDENVVAR ENVVAR(REGION) VALUE('UK_SW') REPLACE(*YES)" },
            { command: 'ADDLIBLE MYLIB', type: 'cl' },
            // SQL statements
            { command: 'SET SCHEMA MYLIB', type: 'sql' },
          ],
        },
      },
    ],
  });

  await pools.init();

  // Each connection in the pool will have the init commands applied
  const pool = await pools.get('mydb');
  if (!pool) {
    throw new Error('Pool not found');
  }

  const conn = await pool.attach();

  const result = await conn.query('SELECT * FROM QIWS.QCUSTCDT');
  console.log(result);

  await pool.detach(conn);

  // Retire all connections
  await pool.retireAll();
}

main().catch(console.error);

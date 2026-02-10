/**
 * Stored Procedure Example
 *
 * Demonstrates how to call an IBM i stored procedure using a pooled connection.
 * This example uses QSYS2.QCMDEXC, which is available on all IBM i systems
 * and allows you to execute CL commands via SQL.
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
          initialConnections: {
            size: 1,
            expiry: 5,
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

  const conn = await pool.attach();

  const library = 'QIWS';
  const table = 'QCUSTCDT';
  const objectType = 'TABLE';
  const user = 'MYUSER';
  const envvar = 'LOG_LEVEL';
  let envvar_value = 'info';

  // Call QSYS2.QCMDEXC to execute a CL command
  // This example adds a library to the job's library list
  await conn.query('CALL QSYS2.QCMDEXC(?)', {
    parameters: [`ADDLIBLE LIB(${library})`],
  });
  console.log('Library added to library list');

  // Call QSYS2.QCMDEXC to send a message
  await conn.query('CALL QSYS2.QCMDEXC(?)', {
    parameters: [`SNDMSG MSG('Hello from rm-mapepire-js') TOUSR(${user})`],
  });
  console.log('Message sent');

  // Call QSYS2.GENERATE_SQL to generate DDL statements
  let result = await conn.query('CALL QSYS2.GENERATE_SQL(?,?,?)', {
    parameters: [table, library, objectType],
  });
  console.dir(result);

  // Call QSYS2.QCMDEXC to set an environment variable
  await conn.query('CALL QSYS2.QCMDEXC(?)', {
    parameters: [`ADDENVVAR ENVVAR(${envvar}) VALUE(${envvar_value}) REPLACE(*YES)`],
  });
  console.log(`Set environment variable: ${envvar}=${envvar_value}`);

  // Call my stored procedure to return an environment variable value
  result = await conn.query('CALL QGPL.GET_ENVVAR(?,?)', { parameters: [envvar, ''] });
  envvar_value = result.output_parms[1].value;
  console.log(`Retrieved environment variable: ${envvar}=${envvar_value}`);

  await pool.detach(conn);

  // Retire all connections
  await pool.retireAll();
}

main().catch(console.error);

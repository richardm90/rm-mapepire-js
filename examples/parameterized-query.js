/**
 * Parameterized Query Example
 *
 * Demonstrates how to execute queries with parameter markers
 * to safely pass user-supplied values.
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

  // Use parameter markers (?) to safely pass values
  const result = await conn.query(
    'SELECT * FROM QIWS.QCUSTCDT WHERE STATE = ? AND BALDUE > ?',
    { parameters: ['NY', 100] }
  );
  console.log('Customers in NY with a balance over 50:', result);

  // Insert with parameters
  await conn.query(
    'INSERT INTO QIWS.QCUSTCDT (CUSNUM, LSTNAM, INIT) VALUES (?, ?, ?)',
    { parameters: [990100, 'Moulton', 'R'] }
  );
  console.log('Customer inserted');

  await pool.detach(conn);

  // Retire all connections
  await pool.retireAll();
}

main().catch(console.error);

/**
 * Multiple Pools Example
 *
 * Demonstrates how to configure and use multiple connection pools,
 * for example separate pools for production queries and reporting.
 */

const { rmPools } = require('rm-mapepire-js');

async function main() {
  const pools = new rmPools({
    pools: [
      {
        id: 'prod',
        PoolOptions: {
          creds: {
            host: 'prod.example.com',
            user: 'APPUSER',
            password: 'PRODPASS',
            rejectUnauthorized: false
          },
          maxSize: 20,
          initialConnections: {
            size: 5,
          },
        },
      },
      {
        id: 'reporting',
        PoolOptions: {
          creds: {
            host: 'rpt.example.com',
            user: 'RPTUSER',
            password: 'RPTPASS',
          },
          maxSize: 5,
          initialConnections: {
            size: 1,
          },
        },
      },
    ],
  });

  await pools.init();

  // Use the production pool for transactional work
  const prodPool = await pools.get('prod');
  if (!prodPool) {
    throw new Error('prod pool not found');
  }

  const prodConn = await prodPool.attach();
  await prodConn.query(
    'INSERT INTO MYLIB.ORDERS (CUSTOMER, ITEM, QTY) VALUES (?, ?, ?)',
    { parameters: ['ACME Corp', 'Widget', 100] }
  );
  await prodPool.detach(prodConn);

  // Use the reporting pool for read-heavy queries
  const rptPool = await pools.get('reporting');
  if (!rptPool) {
    throw new Error('reporting pool not found');
  }

  const rptConn = await rptPool.attach();
  const report = await rptConn.query(
    'SELECT DEPARTMENT, SUM(SALARY) AS TOTAL_SALARY FROM MYLIB.EMPLOYEES GROUP BY DEPARTMENT'
  );
  console.log('Salary report:', report);
  await rptPool.detach(rptConn);

  // Retire all connections
  await prodPool.retireAll();
  await rptPool.retireAll();
}

main().catch(console.error);

/**
 * Custom Logger Example
 *
 * Demonstrates how to provide a custom logger to rm-connector-js.
 * The logger interface requires a single `log(level, message, meta)` method,
 * which is compatible with popular logging libraries like Winston and Pino.
 *
 * This example shows:
 * - A simple custom logger that formats output differently
 * - How the logger flows from RmPools down to individual connections
 * - Per-pool logger overrides
 */

const { RmPools } = require('rm-connector-js');

// A simple custom logger that prefixes each line with a tag
const myLogger = {
  log(level, message, meta) {
    const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
    const service = meta?.service || 'app';
    console.log(`[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${service}] ${message}`);
  },
};

// A quieter logger for the reporting pool (only logs errors)
const quietLogger = {
  log(level, message, meta) {
    if (level === 'error') {
      console.error(`REPORTING ERROR: ${message}`);
    }
  },
};

async function main() {
  const pools = new RmPools({
    logLevel: 'debug',  // Global log level
    logger: myLogger,   // Global logger — used by all pools unless overridden
    pools: [
      {
        id: 'main',
        PoolOptions: {
          creds: {
            host: 'myibmi.com',
            user: 'MYUSER',
            password: 'MYPASSWORD',
            rejectUnauthorized: false
          },
          initialConnections: { size: 2 },
          // Uses the global myLogger
        },
      },
      {
        id: 'reporting',
        PoolOptions: {
          creds: {
            host: 'myibmi.com',
            user: 'MYUSER',
            password: 'MYPASSWORD',
            rejectUnauthorized: false
          },
          initialConnections: { size: 1 },
          logger: quietLogger,  // Per-pool override — only logs errors
        },
      },
    ],
  });

  await pools.init();

  // Query using the main pool (verbose logging via myLogger)
  const mainPool = await pools.get('main');
  const conn = await mainPool.attach();
  const result = await conn.query('SELECT * FROM QIWS.QCUSTCDT');
  console.log(`\nQuery returned ${result.data.length} rows\n`);
  await mainPool.detach(conn);

  // Query using the reporting pool (quiet — only errors are logged)
  const rptPool = await pools.get('reporting');
  const rptConn = await rptPool.attach();
  const rptResult = await rptConn.query(
    'SELECT STATE, COUNT(*) AS CNT FROM QIWS.QCUSTCDT GROUP BY STATE'
  );
  console.log('State counts:', rptResult.data);

  await rptPool.detach(rptConn);
  await pools.close();
}

main().catch(console.error);

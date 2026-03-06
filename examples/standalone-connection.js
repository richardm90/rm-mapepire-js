/**
 * Standalone Connection Example
 *
 * Demonstrates using RmConnection directly without pooling.
 * Useful for simple scripts, one-off queries, or CLI tools.
 *
 * Shows both mapepire (remote) and idb (native IBM i) backends.
 */

const { RmConnection } = require('rm-connector-js');

// --- Remote connection via mapepire (works from any platform) ---

async function remoteExample() {
  const conn = new RmConnection({
    backend: 'mapepire',
    creds: {
      host: 'myibmi.com',
      user: 'MYUSER',
      password: 'MYPASSWORD',
      rejectUnauthorized: false,
    },
    JDBCOptions: {
      libraries: 'MYLIB',
    },
    initCommands: [
      { command: 'CHGJOB INQMSGRPY(*DFT)' },
    ],
    keepalive: 5, // ping every 5 minutes to keep WebSocket alive
  });

  await conn.init();
  console.log('Connected (mapepire). Job:', conn.jobName);

  const result = await conn.execute('SELECT * FROM QIWS.QCUSTCDT');
  console.log('Rows:', result.data.length);

  await conn.close();
}

// --- Native connection via idb-pconnector (IBM i only) ---

async function nativeExample() {
  const conn = new RmConnection({
    backend: 'idb',
    JDBCOptions: {
      libraries: 'MYLIB',
      naming: 'system',
    },
    initCommands: [
      { command: 'ADDLIBLE QGPL', type: 'cl' },
      { command: 'SET DATFMT *ISO', type: 'sql' },
      { command: 'ADDENVVAR ENVVAR(WEBAPI_COMPANY) VALUE(\'01\') REPLACE(*YES)', type: 'cl' },
    ],
  });

  await conn.init();
  console.log('Connected (idb). Job:', conn.jobName);

  // Simple query
  const result = await conn.execute('SELECT * FROM QIWS.QCUSTCDT');
  console.log('Rows:', result.data.length);

  // Parameterized query
  const filtered = await conn.execute(
    'SELECT * FROM QIWS.QCUSTCDT WHERE STATE = ?',
    { parameters: ['NY'] }
  );
  console.log('NY customers:', filtered.data.length);

  await conn.close();
}

// --- Auto-detect backend ---

async function autoExample() {
  // 'auto' (the default) uses idb on IBM i, mapepire elsewhere
  const conn = new RmConnection({
    creds: {
      host: 'myibmi.com',
      user: 'MYUSER',
      password: 'MYPASSWORD',
      rejectUnauthorized: false,
    },
  });

  await conn.init();
  console.log('Connected (auto). Job:', conn.jobName);

  const result = await conn.execute('VALUES CURRENT TIMESTAMP');
  console.log('Server time:', result.data);

  await conn.close();
}

remoteExample().catch(console.error);
// nativeExample().catch(console.error);   // Uncomment when running on IBM i
// autoExample().catch(console.error);

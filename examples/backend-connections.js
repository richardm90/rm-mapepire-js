/**
 * Backend Connection Options Example
 *
 * Demonstrates the different ways to connect using each backend:
 *
 *   mapepire  - Remote WebSocket connection (any platform)
 *   idb       - Native DB2 CLI connection (IBM i only)
 *
 * The idb backend supports three connection modes:
 *   1. Local (*LOCAL) as the current user (default)
 *   2. Local (*LOCAL) under a different user profile (profile swap)
 *   3. Remote system via an RDB directory entry (WRKRDBDIRE)
 */

const { RmConnection } = require('rm-connector-js');

// ---------------------------------------------------------------------------
// mapepire backend - remote connection via WebSocket
// ---------------------------------------------------------------------------

async function mapepireConnection() {
  const conn = new RmConnection({
    backend: 'mapepire',
    creds: {
      host: 'myibmi.com',
      user: 'MYUSER',
      password: 'MYPASSWORD',
      rejectUnauthorized: false,
    },
  });

  await conn.init();
  console.log('mapepire connected. Job:', conn.jobName);

  const result = await conn.execute('VALUES CURRENT TIMESTAMP');
  console.log('Server time:', result.data);

  await conn.close();
}

// ---------------------------------------------------------------------------
// idb backend - local connection as current user (default)
// ---------------------------------------------------------------------------
// No credentials needed. The connection runs under the user profile
// of the Node.js job.

async function idbLocalDefault() {
  const conn = new RmConnection({
    backend: 'idb',
  });

  await conn.init();
  console.log('idb *LOCAL (current user) connected. Job:', conn.jobName);

  const result = await conn.execute('VALUES CURRENT USER');
  console.log('Current user:', result.data);

  await conn.close();
}

// ---------------------------------------------------------------------------
// idb backend - profile swap on *LOCAL
// ---------------------------------------------------------------------------
// Connects to the local database but authenticates as a different user.
// Useful for running queries under an application service profile.

async function idbProfileSwap() {
  const conn = new RmConnection({
    backend: 'idb',
    creds: {
      user: 'SVCACCOUNT',
      password: 'SVCPASSWORD',
    },
  });

  await conn.init();
  console.log('idb *LOCAL (profile swap) connected. Job:', conn.jobName);

  const result = await conn.execute('VALUES CURRENT USER');
  console.log('Running as:', result.data);

  await conn.close();
}

// ---------------------------------------------------------------------------
// idb backend - remote RDB via directory entry
// ---------------------------------------------------------------------------
// Connects to another IBM i system using an RDB directory entry.
// The entry must be configured on the local system (ADDRDBDIRE / WRKRDBDIRE).
// The "database" value is the RDB name, not a hostname.

async function idbRemoteRdb() {
  const conn = new RmConnection({
    backend: 'idb',
    creds: {
      database: 'PRODSYS',
      user: 'REMOTEUSER',
      password: 'REMOTEPASSWORD',
    },
  });

  await conn.init();
  console.log('idb remote RDB connected. Job:', conn.jobName);

  const result = await conn.execute('VALUES CURRENT SERVER');
  console.log('Connected to:', result.data);

  await conn.close();
}

// Run the examples
mapepireConnection().catch(console.error);
// Uncomment the following when running on IBM i:
// idbLocalDefault().catch(console.error);
// idbProfileSwap().catch(console.error);
// idbRemoteRdb().catch(console.error);

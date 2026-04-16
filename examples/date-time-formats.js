/**
 * Date / Time Format Options Example
 *
 * Demonstrates how to override rm-connector-js's default date and time
 * formats via JDBCOptions. Both backends (idb and mapepire) honour the
 * same four JT400-style property names:
 *
 *   - "date format"       "mdy" | "dmy" | "ymd" | "usa" | "iso" | "eur" | "jis" | "julian"
 *   - "date separator"    "/" | "-" | "." | "," | "b"
 *   - "time format"       "hms" | "usa" | "iso" | "eur" | "jis"
 *   - "time separator"    ":" | "." | "," | "b"
 *
 * When the caller doesn't set any of these, rm-connector-js injects ISO
 * defaults on both backends so DATE and TIME columns come back identically
 * (the default DATE is "YYYY-MM-DD" and default TIME is "HH.MM.SS" — note
 * that DB2's "ISO" time format uses dots, not colons; use "jis" or
 * "hms" + ":" separator if you want colons).
 *
 * The second half of this example demonstrates INSERT, UPDATE, and
 * SELECT with DATE, TIME, and TIMESTAMP columns — showing that the
 * format settings apply consistently to writes as well as reads. Two
 * pools are used side-by-side: one with ISO defaults, one with USA
 * formatting. Both use a session table (DECLARE GLOBAL TEMPORARY TABLE
 * / SESSION.*) so there is nothing to clean up afterwards.
 *
 * Run:  node examples/date-time-formats.js
 */

const { RmPools } = require('rm-connector-js');
// const { RmPools } = require('../dist');

const CREDS = {
  host: 'myibmi.com',
  user: 'MYUSER',
  password: 'MYPASSWORD',
  rejectUnauthorized: false,
};

const SQL = `
  VALUES (
    CAST('2024-06-15' AS DATE),
    CAST('13:45:30'   AS TIME)
  )
`;

async function runWithOptions(label, JDBCOptions) {
  const pools = new RmPools({
    pools: [
      {
        id: 'mydb',
        PoolOptions: {
          // backend: 'mapepire',  // or 'idb' on an IBM i host
          creds: CREDS,
          JDBCOptions,
          maxSize: 2,
          initialConnections: { size: 1 },
        },
      },
    ],
    logLevel: 'none',
  });

  await pools.init();
  const pool = await pools.get('mydb');
  const conn = await pool.attach();

  const result = await conn.query(SQL);
  console.log(`--- ${label} ---`);
  console.log('JDBCOptions:', JDBCOptions);
  console.log('Row:       ', result.data[0]);
  console.log();

  await pool.detach(conn);
  await pool.retireAll();
}

async function main() {
  // 1. No JDBCOptions at all — rm-connector-js applies the ISO defaults.
  //    DATE  -> "2024-06-15"
  //    TIME  -> "13.45.30"   (DB2 ISO time uses dots, not colons)
  await runWithOptions('Default (rm-connector-js injects ISO)', undefined);

  // 2. JIS time format — produces HH:MM:SS with colons (most common override).
  //    DATE  -> "2024-06-15"
  //    TIME  -> "13:45:30"
  await runWithOptions('JIS time (colon-separated HH:MM:SS)', {
    'time format': 'jis',
  });

  // 3. HMS + explicit separator — same visual output as JIS but lets you
  //    pick any separator (":", ".", ",", or "b" for blank).
  //    DATE  -> "2024-06-15"
  //    TIME  -> "13:45:30"
  await runWithOptions('HMS time with ":" separator', {
    'time format': 'hms',
    'time separator': ':',
  });

  // 4. US locale — MDY date with slashes, USA time (12-hour clock with AM/PM).
  //    DATE  -> "06/15/2024"
  //    TIME  -> "01:45 PM"
  await runWithOptions('US locale (MDY date, USA time)', {
    'date format': 'usa',
    'date separator': '/',
    'time format': 'usa',
  });

  // 5. European locale — DMY date with dots, EUR time with dots.
  //    DATE  -> "15.06.2024"
  //    TIME  -> "13.45.30"
  await runWithOptions('European locale (DMY date, EUR time)', {
    'date format': 'eur',
    'date separator': '.',
    'time format': 'eur',
  });

  // ---------------------------------------------------------------
  // INSERT / UPDATE / SELECT with date/time types
  // ---------------------------------------------------------------
  // Demonstrates that the format settings apply to writes (INSERT,
  // UPDATE) as well as reads (SELECT). Two pools are used: one with
  // ISO defaults, one with USA formatting. Both operate on the same
  // session table (DECLARE GLOBAL TEMPORARY TABLE / SESSION.*), which
  // vanishes when the connection closes — nothing to clean up.

  console.log('=== INSERT / UPDATE / SELECT with date/time/timestamp columns ===\n');

  // --- Pool with ISO defaults (no JDBCOptions) ---

  const isoPools = new RmPools({
    pools: [
      {
        id: 'iso',
        PoolOptions: {
          // backend: 'mapepire',
          creds: CREDS,
          maxSize: 2,
          initialConnections: { size: 1 },
        },
      },
    ],
    logLevel: 'none',
  });

  await isoPools.init();
  const isoPool = await isoPools.get('iso');
  const isoConn = await isoPool.attach();

  // Create session table
  await isoConn.query(`
    DECLARE GLOBAL TEMPORARY TABLE DT_CRUD (
      ID        INTEGER NOT NULL,
      COL_DATE  DATE,
      COL_TIME  TIME,
      COL_TS    TIMESTAMP
    )
  `);

  // INSERT — values in DB2 ISO / native format
  //   DATE  = "2024-06-15"  (ISO)
  //   TIME  = "13.45.30"    (DB2 ISO — dots)
  //   TS    = "2024-06-15-13.45.30.123456" (DB2 native)
  await isoConn.query(
    'INSERT INTO SESSION.DT_CRUD VALUES (?, ?, ?, ?)',
    { parameters: [1, '2024-06-15', '13.45.30', '2024-06-15-13.45.30.123456'] }
  );

  let result = await isoConn.query('SELECT * FROM SESSION.DT_CRUD WHERE ID = 1');
  console.log('--- ISO defaults: SELECT after INSERT ---');
  console.log(JSON.stringify(result.data, null, 2));
  console.log();

  // UPDATE — change date and timestamp
  await isoConn.query(
    'UPDATE SESSION.DT_CRUD SET COL_DATE = ?, COL_TS = ? WHERE ID = ?',
    { parameters: ['2025-12-25', '2025-12-25-18.30.00.000000', 1] }
  );

  result = await isoConn.query('SELECT * FROM SESSION.DT_CRUD WHERE ID = 1');
  console.log('--- ISO defaults: SELECT after UPDATE ---');
  console.log(JSON.stringify(result.data, null, 2));
  console.log();

  await isoPool.detach(isoConn);
  await isoPool.retireAll();

  // --- Pool with USA formatting ---

  const usaPools = new RmPools({
    pools: [
      {
        id: 'usa',
        PoolOptions: {
          // backend: 'mapepire',
          creds: CREDS,
          JDBCOptions: {
            'date format': 'usa',
            'time format': 'usa',
          },
          maxSize: 2,
          initialConnections: { size: 1 },
        },
      },
    ],
    logLevel: 'none',
  });

  await usaPools.init();
  const usaPool = await usaPools.get('usa');
  const usaConn = await usaPool.attach();

  // Create session table (new connection, new QTEMP)
  await usaConn.query(`
    DECLARE GLOBAL TEMPORARY TABLE DT_CRUD (
      ID        INTEGER NOT NULL,
      COL_DATE  DATE,
      COL_TIME  TIME,
      COL_TS    TIMESTAMP
    )
  `);

  // INSERT — values in USA format
  //   DATE  = "06/15/2024"  (MM/DD/YYYY)
  //   TIME  = "01:45 PM"    (12-hour clock)
  //   TS    = DB2 native (timestamp format is not affected by date/time settings)
  await usaConn.query(
    'INSERT INTO SESSION.DT_CRUD VALUES (?, ?, ?, ?)',
    { parameters: [1, '06/15/2024', '01:45 PM', '2024-06-15-13.45.30.123456'] }
  );

  result = await usaConn.query('SELECT * FROM SESSION.DT_CRUD WHERE ID = 1');
  console.log('--- USA format: SELECT after INSERT ---');
  console.log(JSON.stringify(result.data, null, 2));
  console.log();

  // UPDATE — change date using USA format
  await usaConn.query(
    'UPDATE SESSION.DT_CRUD SET COL_DATE = ?, COL_TIME = ? WHERE ID = ?',
    { parameters: ['12/25/2025', '06:30 PM', 1] }
  );

  result = await usaConn.query('SELECT * FROM SESSION.DT_CRUD WHERE ID = 1');
  console.log('--- USA format: SELECT after UPDATE ---');
  console.log(JSON.stringify(result.data, null, 2));
  console.log();

  await usaPool.detach(usaConn);
  await usaPool.retireAll();

  // --- Pool with EUR formatting ---

  const eurPools = new RmPools({
    pools: [
      {
        id: 'eur',
        PoolOptions: {
          // backend: 'mapepire',
          creds: CREDS,
          JDBCOptions: {
            'date format': 'eur',
            'time format': 'eur',
          },
          maxSize: 2,
          initialConnections: { size: 1 },
        },
      },
    ],
    logLevel: 'none',
  });

  await eurPools.init();
  const eurPool = await eurPools.get('eur');
  const eurConn = await eurPool.attach();

  // Create session table (new connection, new QTEMP)
  await eurConn.query(`
    DECLARE GLOBAL TEMPORARY TABLE DT_CRUD (
      ID        INTEGER NOT NULL,
      COL_DATE  DATE,
      COL_TIME  TIME,
      COL_TS    TIMESTAMP
    )
  `);

  // INSERT — values in EUR format
  //   DATE  = "15.06.2024"  (DD.MM.YYYY)
  //   TIME  = "13.45.30"    (HH.MM.SS — dots, same as DB2 ISO)
  //   TS    = DB2 native (timestamp format is not affected by date/time settings)
  await eurConn.query(
    'INSERT INTO SESSION.DT_CRUD VALUES (?, ?, ?, ?)',
    { parameters: [1, '15.06.2024', '13.45.30', '2024-06-15-13.45.30.123456'] }
  );

  result = await eurConn.query('SELECT * FROM SESSION.DT_CRUD WHERE ID = 1');
  console.log('--- EUR format: SELECT after INSERT ---');
  console.log(JSON.stringify(result.data, null, 2));
  console.log();

  // UPDATE — change date and time using EUR format
  await eurConn.query(
    'UPDATE SESSION.DT_CRUD SET COL_DATE = ?, COL_TIME = ? WHERE ID = ?',
    { parameters: ['25.12.2025', '18.30.00', 1] }
  );

  result = await eurConn.query('SELECT * FROM SESSION.DT_CRUD WHERE ID = 1');
  console.log('--- EUR format: SELECT after UPDATE ---');
  console.log(JSON.stringify(result.data, null, 2));
  console.log();

  await eurPool.detach(eurConn);
  await eurPool.retireAll();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

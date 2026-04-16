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
    CAST('13:45:30'   AS TIME),
    CAST(12345.6789   AS DECIMAL(15, 4))
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

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Result Envelope — All SQL Data Types
 *
 * Runs the same SELECT four ways and prints the JSON envelope produced
 * by each. The query casts literals to every major DB2 for i SQL data
 * type so the envelope metadata and values exercise the full type
 * surface.
 *
 *   1. rm-connector-js, backend: 'idb'
 *   2. rm-connector-js, backend: 'mapepire'
 *   3. raw idb-pconnector (Statement.exec + prepare/execute/fetchAll)
 *   4. raw @ibm/mapepire-js (SQLJob.execute)
 *
 * Usage:
 *   node examples/result-envelope-all-types.js
 */

const { RmConnection } = require('rm-connector-js');
// const { RmConnection } = require('../dist');
const { Connection, Statement } = require('idb-pconnector');
const { SQLJob } = require('@ibm/mapepire-js');

const creds = {
  host: 'myibmi.com',
  user: 'MYUSER',
  password: 'MYPASSWORD',
  rejectUnauthorized: false,
};

const SQL = `
  SELECT
    CAST(32000              AS SMALLINT)        AS COL_SMALLINT,
    CAST(2147483000         AS INTEGER)         AS COL_INT,
    CAST(9007199254740000   AS BIGINT)          AS COL_BIGINT,
    CAST(12345.6789         AS DECIMAL(15,4))   AS COL_DECIMAL,
    CAST(98765.4321         AS NUMERIC(15,4))   AS COL_NUMERIC,
    CAST(3.14               AS REAL)            AS COL_REAL,
    CAST(2.718281828459045  AS DOUBLE)          AS COL_DOUBLE,
    CAST(1.1                AS DECFLOAT(34))    AS COL_DECFLOAT,
    CAST('HELLO'            AS CHAR(20))        AS COL_CHAR,
    CAST('World of DB2 for i' AS VARCHAR(100))  AS COL_VARCHAR,
    CAST('This is a CLOB'   AS CLOB(1K))        AS COL_CLOB,
    CAST('2024-06-15'       AS DATE)            AS COL_DATE,
    CAST('13:45:30'         AS TIME)            AS COL_TIME,
    CAST('2024-06-15-13.45.30.123456' AS TIMESTAMP) AS COL_TIMESTAMP,
    CAST(X'48454C4C4F0000000000000000000000' AS BINARY(16))   AS COL_BINARY,
    CAST(X'DEADBEEF'        AS VARBINARY(64))   AS COL_VARBINARY,
    CAST(X'0102030405'      AS BLOB(1K))        AS COL_BLOB,
    CAST('TestGraph'        AS GRAPHIC(10) CCSID 13488)   AS COL_GRAPHIC,
    CAST('VarGraphic'       AS VARGRAPHIC(40) CCSID 13488) AS COL_VARGRAPHIC,
    TRUE                                                   AS COL_BOOLEAN
  FROM SYSIBM.SYSDUMMY1
`;

function replacer(_key, value) {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `<Buffer ${value.toString('hex')}>`;
  return value;
}

async function runWrapper(backend) {
  const conn = new RmConnection({ backend, creds });
  await conn.init(true);
  try {
    return await conn.execute(SQL);
  } finally {
    await conn.close();
  }
}

// idb-pconnector has no single "envelope": Statement.exec(sql) resolves
// to an array of row objects, and the prepare/execute/fetchAll path
// returns its pieces separately. We print both so the shape is explicit.
async function runIdbRaw() {
  const conn = new Connection({ url: '*LOCAL' });
  await conn.connect();
  try {
    const stmtExec = new Statement(conn);
    const execResult = await stmtExec.exec(SQL);
    console.log('--- raw idb-pconnector: Statement.exec(sql) ---');
    console.log(JSON.stringify(execResult, replacer, 2));
    await stmtExec.close();

    const stmtPrep = new Statement(conn);
    await stmtPrep.prepare(SQL);
    const executeResult = await stmtPrep.execute();
    const fetchResult = await stmtPrep.fetchAll();
    console.log('--- raw idb-pconnector: Statement.execute() return value ---');
    console.log(JSON.stringify(executeResult ?? null, replacer, 2));
    console.log('--- raw idb-pconnector: Statement.fetchAll() ---');
    console.log(JSON.stringify(fetchResult, replacer, 2));
    await stmtPrep.close();
  } finally {
    await conn.close();
  }
}

async function runMapepireRaw() {
  const job = new SQLJob();
  await job.connect(creds);
  try {
    const result = await job.execute(SQL);
    console.log('--- raw @ibm/mapepire-js: SQLJob.execute(sql) ---');
    console.log(JSON.stringify(result, replacer, 2));
  } finally {
    await job.close();
  }
}

async function main() {
  const idbEnvelope = await runWrapper('idb');
  console.log('--- rm-connector-js idb envelope ---');
  console.log(JSON.stringify(idbEnvelope, replacer, 2));

  const mapEnvelope = await runWrapper('mapepire');
  console.log('--- rm-connector-js mapepire envelope ---');
  console.log(JSON.stringify(mapEnvelope, replacer, 2));

  await runIdbRaw();
  await runMapepireRaw();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

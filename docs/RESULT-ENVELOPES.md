# Result Envelope Examples

This document shows the full JSON result envelope returned by each backend
for an identical query that casts literals to every major DB2 for i SQL
data type. Use it as a reference when working out which fields are
available on which backend, or when deciding how to normalise output in
application code.

The envelopes below were produced by
[examples/result-envelope-all-types.js](../examples/result-envelope-all-types.js),
which runs the same `SELECT` four ways:

1. Through `rm-connector-js` with `backend: 'idb'`
2. Through `rm-connector-js` with `backend: 'mapepire'`
3. Directly against `idb-pconnector`
4. Directly against `@ibm/mapepire-js`

The first two show what applications see; the second two show what the
underlying drivers return before `rm-connector-js` normalises them. See
[BACKEND-DIFFERENCES.md](BACKEND-DIFFERENCES.md) for a field-by-field
comparison and the rationale behind each difference.

## The query

```sql
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
```

## `rm-connector-js` with `backend: 'idb'`

```json
{
  "success": true,
  "data": [
    {
      "COL_SMALLINT": 32000,
      "COL_INT": 2147483000,
      "COL_BIGINT": "9007199254740000",
      "COL_DECIMAL": 12345.6789,
      "COL_NUMERIC": 98765.4321,
      "COL_REAL": 3.14,
      "COL_DOUBLE": 2.71828,
      "COL_DECFLOAT": "1.1",
      "COL_CHAR": "HELLO",
      "COL_VARCHAR": "World of DB2 for i",
      "COL_CLOB": "This is a CLOB",
      "COL_DATE": "2024-06-15",
      "COL_TIME": "13.45.30",
      "COL_TIMESTAMP": "2024-06-15-13.45.30.123456",
      "COL_BINARY": {
        "type": "Buffer",
        "data": [72, 69, 76, 76, 79, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      },
      "COL_VARBINARY": {
        "type": "Buffer",
        "data": [222, 173, 190, 239]
      },
      "COL_BLOB": {
        "type": "Buffer",
        "data": [1, 2, 3, 4, 5]
      },
      "COL_GRAPHIC": "TestGraph",
      "COL_VARGRAPHIC": "VarGraphic",
      "COL_BOOLEAN": "TRUE"
    }
  ],
  "has_results": true,
  "is_done": true,
  "update_count": 0,
  "sql_rc": 0,
  "sql_state": "00000",
  "execution_time": 31.978746,
  "id": "1",
  "job": "021520/QUSER/QSQSRVR",
  "metadata": null
}
```

## `rm-connector-js` with `backend: 'mapepire'`

```json
{
  "id": "query3",
  "has_results": true,
  "update_count": -1,
  "metadata": {
    "column_count": 20,
    "job": "018276/QUSER/QZDASOINIT",
    "columns": [
      { "name": "COL_SMALLINT",   "type": "SMALLINT",   "display_size": 6,    "label": "COL_SMALLINT",   "precision": 5,  "scale": 0 },
      { "name": "COL_INT",        "type": "INTEGER",    "display_size": 11,   "label": "COL_INT",        "precision": 10, "scale": 0 },
      { "name": "COL_BIGINT",     "type": "BIGINT",     "display_size": 20,   "label": "COL_BIGINT",     "precision": 19, "scale": 0 },
      { "name": "COL_DECIMAL",    "type": "DECIMAL",    "display_size": 17,   "label": "COL_DECIMAL",    "precision": 15, "scale": 4 },
      { "name": "COL_NUMERIC",    "type": "NUMERIC",    "display_size": 17,   "label": "COL_NUMERIC",    "precision": 15, "scale": 4 },
      { "name": "COL_REAL",       "type": "REAL",       "display_size": 13,   "label": "COL_REAL",       "precision": 24, "scale": 0 },
      { "name": "COL_DOUBLE",     "type": "DOUBLE",     "display_size": 22,   "label": "COL_DOUBLE",     "precision": 53, "scale": 0 },
      { "name": "COL_DECFLOAT",   "type": "DECFLOAT",   "display_size": 42,   "label": "COL_DECFLOAT",   "precision": 34, "scale": 0 },
      { "name": "COL_CHAR",       "type": "CHAR",       "display_size": 20,   "label": "COL_CHAR",       "precision": 20, "scale": 0 },
      { "name": "COL_VARCHAR",    "type": "VARCHAR",    "display_size": 100,  "label": "COL_VARCHAR",    "precision": 100,"scale": 0 },
      { "name": "COL_CLOB",       "type": "CLOB",       "display_size": 1024, "label": "COL_CLOB",       "precision": 1024,"scale": 0 },
      { "name": "COL_DATE",       "type": "DATE",       "display_size": 10,   "label": "COL_DATE",       "precision": 10, "scale": 0 },
      { "name": "COL_TIME",       "type": "TIME",       "display_size": 8,    "label": "COL_TIME",       "precision": 8,  "scale": 0 },
      { "name": "COL_TIMESTAMP",  "type": "TIMESTAMP",  "display_size": 26,   "label": "COL_TIMESTAMP",  "precision": 26, "scale": 6 },
      { "name": "COL_BINARY",     "type": "BINARY",     "display_size": 16,   "label": "COL_BINARY",     "precision": 16, "scale": 0 },
      { "name": "COL_VARBINARY",  "type": "VARBINARY",  "display_size": 64,   "label": "COL_VARBINARY",  "precision": 64, "scale": 0 },
      { "name": "COL_BLOB",       "type": "BLOB",       "display_size": 1024, "label": "COL_BLOB",       "precision": 1024,"scale": 0 },
      { "name": "COL_GRAPHIC",    "type": "GRAPHIC",    "display_size": 10,   "label": "COL_GRAPHIC",    "precision": 10, "scale": 0 },
      { "name": "COL_VARGRAPHIC", "type": "VARGRAPHIC", "display_size": 40,   "label": "COL_VARGRAPHIC", "precision": 40, "scale": 0 },
      { "name": "COL_BOOLEAN",    "type": "BOOLEAN",    "display_size": 1,    "label": "COL_BOOLEAN",    "precision": 1,  "scale": 0 }
    ]
  },
  "data": [
    {
      "COL_SMALLINT": 32000,
      "COL_INT": 2147483000,
      "COL_BIGINT": 9007199254740000,
      "COL_DECIMAL": 12345.6789,
      "COL_NUMERIC": 98765.4321,
      "COL_REAL": 3.14,
      "COL_DOUBLE": 2.718281828459045,
      "COL_DECFLOAT": 1.1,
      "COL_CHAR": "HELLO",
      "COL_VARCHAR": "World of DB2 for i",
      "COL_CLOB": "This is a CLOB",
      "COL_DATE": "2024-06-15",
      "COL_TIME": "13.45.30",
      "COL_TIMESTAMP": "2024-06-15-13.45.30.123456",
      "COL_BINARY": "48454C4C4F0000000000000000000000",
      "COL_VARBINARY": "DEADBEEF",
      "COL_BLOB": "0102030405",
      "COL_GRAPHIC": "TestGraph",
      "COL_VARGRAPHIC": "VarGraphic",
      "COL_BOOLEAN": true
    }
  ],
  "is_done": true,
  "success": true,
  "execution_time": 440,
  "job": "018276/QUSER/QZDASOINIT"
}
```

## Raw `idb-pconnector`

Unlike `mapepire-js`, `idb-pconnector` does not return a single result
envelope. `Statement.exec(sql)` resolves to an array of row objects, and
the `prepare`/`execute`/`fetchAll` path returns its pieces separately:
`execute()` returns `null` for a plain SELECT (it is used to surface
stored-procedure output parameters), and `fetchAll()` returns the rows.
There is no top-level `success`, `update_count`, `sql_state`, or
`metadata` — those fields are synthesised by `rm-connector-js`.

Other notable differences versus the wrapper output: numeric columns
come back as strings (the wrapper applies
`enableNumericTypeConversion`), `CHAR` and `GRAPHIC` values are returned
with their trailing spaces intact (the wrapper applies `trimEnd`), and
`BOOLEAN` comes back as the string `"TRUE"`.

### `Statement.exec(sql)`

```json
[
  {
    "COL_SMALLINT": "32000",
    "COL_INT": "2147483000",
    "COL_BIGINT": "9007199254740000",
    "COL_DECIMAL": "12345.6789",
    "COL_NUMERIC": "98765.4321",
    "COL_REAL": "3.14",
    "COL_DOUBLE": "2.71828",
    "COL_DECFLOAT": "1.1",
    "COL_CHAR": "HELLO               ",
    "COL_VARCHAR": "World of DB2 for i",
    "COL_CLOB": "This is a CLOB",
    "COL_DATE": "2024-06-15",
    "COL_TIME": "13.45.30",
    "COL_TIMESTAMP": "2024-06-15-13.45.30.123456",
    "COL_BINARY": {
      "type": "Buffer",
      "data": [72, 69, 76, 76, 79, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    "COL_VARBINARY": {
      "type": "Buffer",
      "data": [222, 173, 190, 239]
    },
    "COL_BLOB": {
      "type": "Buffer",
      "data": [1, 2, 3, 4, 5]
    },
    "COL_GRAPHIC": "TestGraph ",
    "COL_VARGRAPHIC": "VarGraphic",
    "COL_BOOLEAN": "TRUE"
  }
]
```

### `Statement.prepare` / `execute` / `fetchAll`

```text
Statement.execute()  -> null
Statement.fetchAll() -> (same row array as Statement.exec above)
```

## Raw `@ibm/mapepire-js`

`SQLJob.execute(sql)` already returns a well-structured envelope; the
`rm-connector-js` mapepire backend passes it straight through and only
adds its own `job` field at the top level (in addition to the `job`
nested under `metadata`). The one place the wrapper envelope diverges
from the raw envelope is **date/time format** — `rm-connector-js`
injects `date format=iso`, `date separator=/`, `time format=iso`,
`time separator=:` as defaults on the JDBCOptions
before constructing the `SQLJob`, which matches what the idb backend
forces via `SQL_ATTR_DATE_FMT`/`SQL_ATTR_TIME_FMT`. So the raw envelope
below shows the *job-default* formatting that mapepire-js returns when
no `date format` is set — which on US-locale systems resolves to `*MDY`
via the QZDASOINIT prestart job inheriting `QDATFMT=*MDY`. Pass explicit
`date format`/`time format` values in `JDBCOptions` to override the
rm-connector-js defaults.

```json
{
  "id": "query6",
  "has_results": true,
  "update_count": -1,
  "metadata": {
    "column_count": 20,
    "job": "018275/QUSER/QZDASOINIT",
    "columns": [
      { "name": "COL_SMALLINT",   "type": "SMALLINT",   "display_size": 6,    "label": "COL_SMALLINT",   "precision": 5,  "scale": 0 },
      { "name": "COL_INT",        "type": "INTEGER",    "display_size": 11,   "label": "COL_INT",        "precision": 10, "scale": 0 },
      { "name": "COL_BIGINT",     "type": "BIGINT",     "display_size": 20,   "label": "COL_BIGINT",     "precision": 19, "scale": 0 },
      { "name": "COL_DECIMAL",    "type": "DECIMAL",    "display_size": 17,   "label": "COL_DECIMAL",    "precision": 15, "scale": 4 },
      { "name": "COL_NUMERIC",    "type": "NUMERIC",    "display_size": 17,   "label": "COL_NUMERIC",    "precision": 15, "scale": 4 },
      { "name": "COL_REAL",       "type": "REAL",       "display_size": 13,   "label": "COL_REAL",       "precision": 24, "scale": 0 },
      { "name": "COL_DOUBLE",     "type": "DOUBLE",     "display_size": 22,   "label": "COL_DOUBLE",     "precision": 53, "scale": 0 },
      { "name": "COL_DECFLOAT",   "type": "DECFLOAT",   "display_size": 42,   "label": "COL_DECFLOAT",   "precision": 34, "scale": 0 },
      { "name": "COL_CHAR",       "type": "CHAR",       "display_size": 20,   "label": "COL_CHAR",       "precision": 20, "scale": 0 },
      { "name": "COL_VARCHAR",    "type": "VARCHAR",    "display_size": 100,  "label": "COL_VARCHAR",    "precision": 100,"scale": 0 },
      { "name": "COL_CLOB",       "type": "CLOB",       "display_size": 1024, "label": "COL_CLOB",       "precision": 1024,"scale": 0 },
      { "name": "COL_DATE",       "type": "DATE",       "display_size": 10,   "label": "COL_DATE",       "precision": 10, "scale": 0 },
      { "name": "COL_TIME",       "type": "TIME",       "display_size": 8,    "label": "COL_TIME",       "precision": 8,  "scale": 0 },
      { "name": "COL_TIMESTAMP",  "type": "TIMESTAMP",  "display_size": 26,   "label": "COL_TIMESTAMP",  "precision": 26, "scale": 6 },
      { "name": "COL_BINARY",     "type": "BINARY",     "display_size": 16,   "label": "COL_BINARY",     "precision": 16, "scale": 0 },
      { "name": "COL_VARBINARY",  "type": "VARBINARY",  "display_size": 64,   "label": "COL_VARBINARY",  "precision": 64, "scale": 0 },
      { "name": "COL_BLOB",       "type": "BLOB",       "display_size": 1024, "label": "COL_BLOB",       "precision": 1024,"scale": 0 },
      { "name": "COL_GRAPHIC",    "type": "GRAPHIC",    "display_size": 10,   "label": "COL_GRAPHIC",    "precision": 10, "scale": 0 },
      { "name": "COL_VARGRAPHIC", "type": "VARGRAPHIC", "display_size": 40,   "label": "COL_VARGRAPHIC", "precision": 40, "scale": 0 },
      { "name": "COL_BOOLEAN",    "type": "BOOLEAN",    "display_size": 1,    "label": "COL_BOOLEAN",    "precision": 1,  "scale": 0 }
    ]
  },
  "data": [
    {
      "COL_SMALLINT": 32000,
      "COL_INT": 2147483000,
      "COL_BIGINT": 9007199254740000,
      "COL_DECIMAL": 12345.6789,
      "COL_NUMERIC": 98765.4321,
      "COL_REAL": 3.14,
      "COL_DOUBLE": 2.718281828459045,
      "COL_DECFLOAT": 1.1,
      "COL_CHAR": "HELLO",
      "COL_VARCHAR": "World of DB2 for i",
      "COL_CLOB": "This is a CLOB",
      "COL_DATE": "06/15/24",
      "COL_TIME": "13:45:30",
      "COL_TIMESTAMP": "2024-06-15 13:45:30.123456",
      "COL_BINARY": "48454C4C4F0000000000000000000000",
      "COL_VARBINARY": "DEADBEEF",
      "COL_BLOB": "0102030405",
      "COL_GRAPHIC": "TestGraph",
      "COL_VARGRAPHIC": "VarGraphic",
      "COL_BOOLEAN": true
    }
  ],
  "is_done": true,
  "success": true,
  "execution_time": 198
}
```

/**
 * Backend Parity Tests
 *
 * These integration tests run the SAME operations against both the mapepire and
 * idb backends on a real IBM i system, then compare the results to ensure they
 * produce equivalent output.
 *
 * These tests are NOT part of the regular `npm test` suite. They require:
 *   - Running on IBM i (or network access to an IBM i with mapepire)
 *   - Environment variables: IBMI_HOST, IBMI_USER, IBMI_PASSWORD
 *   - A running mapepire server on the target IBM i
 *
 * Run with: npm run test:parity
 */

import RmConnection from '../../src/rmConnection';
import { RmConnectionOptions, RmQueryResult } from '../../src/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAPEPIRE_CREDS = {
  host: process.env.IBMI_HOST || 'localhost',
  user: process.env.IBMI_USER || '',
  password: process.env.IBMI_PASSWORD || '',
  rejectUnauthorized: false,
};

/** Fields that are expected to differ between backends (see BACKEND-DIFFERENCES.md) */
function normalise(result: RmQueryResult<any>): {
  success: boolean;
  data: any[];
  has_results: boolean;
  is_done: boolean;
} {
  return {
    success: result.success,
    data: result.data,
    has_results: result.has_results,
    is_done: result.is_done,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseOpts(): { idb: RmConnectionOptions; mapepire: RmConnectionOptions } {
  return {
    idb: { backend: 'idb' },
    mapepire: { backend: 'mapepire', creds: MAPEPIRE_CREDS },
  };
}

async function withBothBackends(
  optsOverride: Partial<RmConnectionOptions> = {},
  fn: (idb: RmConnection, mapepire: RmConnection) => Promise<void>,
): Promise<void> {
  const base = baseOpts();
  const idb = new RmConnection({ ...base.idb, ...optsOverride });
  const mapepire = new RmConnection({ ...base.mapepire, ...optsOverride });

  await Promise.all([idb.init(true), mapepire.init(true)]);

  try {
    await fn(idb, mapepire);
  } finally {
    await Promise.all([idb.close(), mapepire.close()]);
  }
}

// ---------------------------------------------------------------------------
// Guard: skip entire suite if credentials are missing
// ---------------------------------------------------------------------------

const skip = !process.env.IBMI_HOST || !process.env.IBMI_USER || !process.env.IBMI_PASSWORD;

const describeIf = skip ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIf('Backend Parity', () => {
  jest.setTimeout(30_000);

  const SHARED_LIB = 'PARITYTEST';

  // Top-level teardown: drop the shared test schema after all tests complete
  afterAll(async () => {
    const teardown = new RmConnection({ backend: 'idb' });
    await teardown.init(true);
    try {
      await teardown.execute(`DROP SCHEMA ${SHARED_LIB} CASCADE`);
    } catch (e) {
      // Best-effort cleanup
    } finally {
      await teardown.close();
    }
  });

  // ----- Basic queries -----

  describe('Simple queries', () => {
    it('SELECT with mixed data types', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT
          CUSNUM, LSTNAM, INIT, STREET, CITY, STATE, ZIPCOD, CDTLMT, CHGCOD, BALDUE, CDTDUE
          FROM QIWS.QCUSTCDT ORDER BY CUSNUM`;

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    it('VALUES expression', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = 'VALUES (1, 2, 3)';

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    it('SELECT with no results', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT * FROM QIWS.QCUSTCDT WHERE CUSNUM = -1`;

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    it('CURRENT TIMESTAMP / CURRENT DATE / CURRENT TIME', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        // Use CURRENT_TIMESTAMP with ISO format to avoid job date format differences
        const sql = `VALUES VARCHAR_FORMAT(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')`;

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        // Both should return a single row with the same formatted timestamp (within the same second)
        expect(idbRes.success).toBe(true);
        expect(mapRes.success).toBe(true);
        expect(idbRes.data.length).toBe(1);
        expect(mapRes.data.length).toBe(1);
        // Verify same column name
        expect(Object.keys(idbRes.data[0])).toEqual(Object.keys(mapRes.data[0]));
      });
    });
  });

  // ----- Parameterized queries -----

  describe('Parameterized queries', () => {
    it('SELECT with parameter markers', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = 'SELECT CUSNUM, LSTNAM, STATE FROM QIWS.QCUSTCDT WHERE STATE = ? ORDER BY CUSNUM';
        const opts = { parameters: ['NY'] };

        const [idbRes, mapRes] = await Promise.all([
          idb.execute(sql, opts),
          mapepire.execute(sql, opts),
        ]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    it('SELECT with multiple parameters', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = 'SELECT CUSNUM, LSTNAM FROM QIWS.QCUSTCDT WHERE STATE = ? AND CDTLMT > ? ORDER BY CUSNUM';
        const opts = { parameters: ['TX', 100] };

        const [idbRes, mapRes] = await Promise.all([
          idb.execute(sql, opts),
          mapepire.execute(sql, opts),
        ]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });
  });

  // ----- CL commands -----

  describe('CL commands via QCMDEXC', () => {
    it('CHGJOB command succeeds on both backends', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = 'CALL QSYS2.QCMDEXC(?)';
        const opts = { parameters: ['CHGJOB INQMSGRPY(*DFT)'] };

        const [idbRes, mapRes] = await Promise.all([
          idb.execute(sql, opts),
          mapepire.execute(sql, opts),
        ]);

        expect(idbRes.success).toBe(true);
        expect(mapRes.success).toBe(true);
      });
    });
  });

  // ----- String trimming -----

  describe('String trimming', () => {
    it('CHAR columns should be trimmed consistently', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        // LSTNAM is CHAR(8) — both backends should trimEnd trailing spaces
        const sql = 'SELECT LSTNAM FROM QIWS.QCUSTCDT ORDER BY CUSNUM';

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });
  });

  // ----- Numeric types -----

  describe('Numeric types', () => {
    it('numeric values should match (decimal, integer)', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = 'SELECT CUSNUM, CDTLMT, BALDUE, CDTDUE FROM QIWS.QCUSTCDT ORDER BY CUSNUM';

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });
  });

  // ----- Error handling -----

  describe('Error handling', () => {
    it('both backends should fail on invalid SQL', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = 'SELECT * FROM NONEXISTENT.TABLE_DOES_NOT_EXIST';

        await expect(idb.execute(sql)).rejects.toThrow();
        await expect(mapepire.execute(sql)).rejects.toThrow();
      });
    });

    it('both backends should fail on syntax errors', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = 'SELCT * FORM QIWS.QCUSTCDT';

        await expect(idb.execute(sql)).rejects.toThrow();
        await expect(mapepire.execute(sql)).rejects.toThrow();
      });
    });
  });

  // ----- Column names -----

  describe('Column names', () => {
    it('column names should match between backends', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = 'SELECT CUSNUM, LSTNAM, INIT, STATE FROM QIWS.QCUSTCDT FETCH FIRST 1 ROW ONLY';

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        const idbCols = Object.keys(idbRes.data[0]).sort();
        const mapCols = Object.keys(mapRes.data[0]).sort();
        expect(idbCols).toEqual(mapCols);
      });
    });
  });

  // ----- JDBCOptions: libraries -----

  describe('JDBCOptions: libraries', () => {
    it('should resolve library objects identically', async () => {
      await withBothBackends({ JDBCOptions: { libraries: ['QIWS'] } }, async (idb, mapepire) => {
        // With QIWS in library list, unqualified access should work
        const sql = 'SELECT CUSNUM, LSTNAM FROM QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    it('should accept single library as string', async () => {
      await withBothBackends({ JDBCOptions: { libraries: 'QIWS' as any } }, async (idb, mapepire) => {
        const sql = 'SELECT COUNT(*) AS CNT FROM QCUSTCDT';

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });
  });

  // ----- JDBCOptions: multiple libraries -----

  describe('JDBCOptions: multiple libraries', () => {
    const TEST_LIB = 'PARITYTEST';

    // Setup: create a test library with a table and seed data
    beforeAll(async () => {
      const setup = new RmConnection({ backend: 'idb' });
      await setup.init(true);
      try {
        // Create library (ignore error if it already exists).
        // We use CREATE SCHEMA instead of QCMDEXC CRTLIB because idb-pconnector
        // wraps CL errors as generic SQLCODE=-443 without the underlying CPF code,
        // making it impossible to distinguish "already exists" from real failures.
        try {
          await setup.execute(`CREATE SCHEMA ${TEST_LIB}`);
        } catch (e: any) {
          // SQLCODE=-601 = object already exists
          if (!e?.message?.includes('SQLCODE=-601')) throw e;
        }
        // Create and populate test table
        await setup.execute(`CREATE OR REPLACE TABLE ${TEST_LIB}.PRODUCTS (
          PRODID INT NOT NULL, PRODNAME VARCHAR(30), PRICE DECIMAL(9,2)
        )`);
        await setup.execute(`DELETE FROM ${TEST_LIB}.PRODUCTS`);
        await setup.execute(`INSERT INTO ${TEST_LIB}.PRODUCTS VALUES (1, 'Widget', 9.99)`);
        await setup.execute(`INSERT INTO ${TEST_LIB}.PRODUCTS VALUES (2, 'Gadget', 24.50)`);
        await setup.execute(`INSERT INTO ${TEST_LIB}.PRODUCTS VALUES (3, 'Sprocket', 3.75)`);
      } finally {
        await setup.close();
      }
    });

    // Teardown: drop only the table — the PARITYTEST schema is shared with
    // other describe blocks and is cleaned up by the top-level afterAll.
    afterAll(async () => {
      const teardown = new RmConnection({ backend: 'idb' });
      await teardown.init(true);
      try {
        await teardown.execute(`DROP TABLE IF EXISTS ${TEST_LIB}.PRODUCTS`);
      } catch (e) {
        // Best-effort cleanup
      } finally {
        await teardown.close();
      }
    });

    it('should resolve unqualified table from custom library', async () => {
      await withBothBackends(
        { JDBCOptions: { libraries: [TEST_LIB] } },
        async (idb, mapepire) => {
          const sql = 'SELECT PRODID, PRODNAME, PRICE FROM PRODUCTS ORDER BY PRODID';

          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
          expect(idbRes.data.length).toBe(3);
        },
      );
    });

    it('should resolve unqualified from first library, qualified from others', async () => {
      // mapepire sets default schema to first library; idb adds all to library list.
      // Both can resolve unqualified from the first library and qualified from others.
      await withBothBackends(
        { JDBCOptions: { libraries: [TEST_LIB, 'QIWS'] } },
        async (idb, mapepire) => {
          // Unqualified: resolves from first library (PARITYTEST)
          const prodSql = 'SELECT PRODID, PRODNAME FROM PRODUCTS ORDER BY PRODID';
          const [idbProd, mapProd] = await Promise.all([idb.execute(prodSql), mapepire.execute(prodSql)]);
          expect(normalise(idbProd)).toEqual(normalise(mapProd));

          // Qualified: explicit library reference works regardless
          const custSql = 'SELECT CUSNUM, LSTNAM FROM QIWS.QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';
          const [idbCust, mapCust] = await Promise.all([idb.execute(custSql), mapepire.execute(custSql)]);
          expect(normalise(idbCust)).toEqual(normalise(mapCust));
        },
      );
    });

    it('should resolve with system naming and multiple libraries', async () => {
      await withBothBackends(
        { JDBCOptions: { libraries: [TEST_LIB, 'QIWS'], naming: 'system' } },
        async (idb, mapepire) => {
          // Unqualified access resolves from first library
          const prodSql = 'SELECT PRODID, PRODNAME, PRICE FROM PRODUCTS ORDER BY PRODID';
          const [idbProd, mapProd] = await Promise.all([idb.execute(prodSql), mapepire.execute(prodSql)]);
          expect(normalise(idbProd)).toEqual(normalise(mapProd));

          // Unqualified access resolves from second library via *LIBL
          const custSql = 'SELECT CUSNUM, LSTNAM FROM QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';
          const [idbCust, mapCust] = await Promise.all([idb.execute(custSql), mapepire.execute(custSql)]);
          expect(normalise(idbCust)).toEqual(normalise(mapCust));
        },
      );
    });

    it('first library determines default schema for both backends', async () => {
      // When QIWS is first, unqualified QCUSTCDT resolves from QIWS on both backends
      await withBothBackends(
        { JDBCOptions: { libraries: ['QIWS', TEST_LIB] } },
        async (idb, mapepire) => {
          const sql = 'SELECT CUSNUM, LSTNAM FROM QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });
  });

  // ----- JDBCOptions: naming -----

  describe('JDBCOptions: naming', () => {
    it('system naming should allow slash separator', async () => {
      await withBothBackends({ JDBCOptions: { naming: 'system' } }, async (idb, mapepire) => {
        const sql = 'SELECT CUSNUM, LSTNAM FROM QIWS/QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    it('sql naming should allow dot separator', async () => {
      await withBothBackends({ JDBCOptions: { naming: 'sql' } }, async (idb, mapepire) => {
        const sql = 'SELECT CUSNUM, LSTNAM FROM QIWS.QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });
  });

  // ----- JDBCOptions: transaction isolation -----

  describe('JDBCOptions: transaction isolation', () => {
    const isolationLevels = [
      'none',
      'read uncommitted',
      'read committed',
      'repeatable read',
      'serializable',
    ] as const;

    for (const level of isolationLevels) {
      it(`isolation '${level}' — query results should match`, async () => {
        await withBothBackends(
          { JDBCOptions: { 'transaction isolation': level } },
          async (idb, mapepire) => {
            const sql = 'SELECT CUSNUM, LSTNAM FROM QIWS.QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

            const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

            expect(normalise(idbRes)).toEqual(normalise(mapRes));
          },
        );
      });
    }
  });

  // ----- JDBCOptions: auto commit -----

  describe('JDBCOptions: auto commit', () => {
    it('auto commit true — query results should match', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': true } },
        async (idb, mapepire) => {
          const sql = 'SELECT CUSNUM, LSTNAM FROM QIWS.QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });

    it('auto commit false — query results should match', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': false, 'transaction isolation': 'read committed' } },
        async (idb, mapepire) => {
          const sql = 'SELECT CUSNUM, LSTNAM FROM QIWS.QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });
  });

  // ----- JDBCOptions: combined -----

  describe('JDBCOptions: combined options', () => {
    it('libraries + naming + transaction isolation together', async () => {
      await withBothBackends(
        {
          JDBCOptions: {
            libraries: ['QIWS'],
            naming: 'system',
            'transaction isolation': 'read committed',
            'auto commit': true,
          },
        },
        async (idb, mapepire) => {
          const sql = 'SELECT CUSNUM, LSTNAM FROM QIWS/QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });
  });

  // ----- DML with commitment control -----

  describe('DML with commitment control', () => {
    // Each test creates its own temp table (DECLARE GLOBAL TEMPORARY TABLE)
    // which is session-scoped and automatically cleaned up on disconnect.

    it('INSERT with auto commit true', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': true, 'transaction isolation': 'read committed' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_INS (
            ID INT, NAME VARCHAR(20)
          ) WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_INS VALUES (?, ?)';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_INS ORDER BY ID';

          // Create table and insert on both
          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Alice'] });
            await conn.execute(insertSql, { parameters: [2, 'Bob'] });
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });

    it('UPDATE with auto commit true', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': true, 'transaction isolation': 'read committed' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_UPD (
            ID INT, NAME VARCHAR(20)
          ) WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_UPD VALUES (?, ?)';
          const updateSql = 'UPDATE SESSION.PARITY_UPD SET NAME = ? WHERE ID = ?';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_UPD ORDER BY ID';

          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Alice'] });
            await conn.execute(insertSql, { parameters: [2, 'Bob'] });
            await conn.execute(updateSql, { parameters: ['Charlie', 2] });
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });

    it('DELETE with auto commit true', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': true, 'transaction isolation': 'read committed' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_DEL (
            ID INT, NAME VARCHAR(20)
          ) WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_DEL VALUES (?, ?)';
          const deleteSql = 'DELETE FROM SESSION.PARITY_DEL WHERE ID = ?';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_DEL ORDER BY ID';

          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Alice'] });
            await conn.execute(insertSql, { parameters: [2, 'Bob'] });
            await conn.execute(insertSql, { parameters: [3, 'Charlie'] });
            await conn.execute(deleteSql, { parameters: [2] });
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });

    it('INSERT/SELECT with no commit (isolation none)', async () => {
      await withBothBackends(
        { JDBCOptions: { 'transaction isolation': 'none' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_NC (
            ID INT, NAME VARCHAR(20)
          ) WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_NC VALUES (?, ?)';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_NC ORDER BY ID';

          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Alpha'] });
            await conn.execute(insertSql, { parameters: [2, 'Beta'] });
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });

    it('INSERT/SELECT with read uncommitted', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': false, 'transaction isolation': 'read uncommitted' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_RU (
            ID INT, NAME VARCHAR(20)
          ) WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_RU VALUES (?, ?)';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_RU ORDER BY ID';

          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Gamma'] });
            await conn.execute(insertSql, { parameters: [2, 'Delta'] });
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });

    it('INSERT/SELECT with serializable', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': false, 'transaction isolation': 'serializable' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_SER (
            ID INT, NAME VARCHAR(20)
          ) WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_SER VALUES (?, ?)';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_SER ORDER BY ID';

          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Epsilon'] });
            await conn.execute(insertSql, { parameters: [2, 'Zeta'] });
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });
  });

  // ----- Commitment control: transactional guarantees -----

  describe('Commitment control: transactional guarantees', () => {

    it('COMMIT should persist changes', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': false, 'transaction isolation': 'read committed' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_CMT (
            ID INT, NAME VARCHAR(20)
          ) ON COMMIT PRESERVE ROWS WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_CMT VALUES (?, ?)';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_CMT ORDER BY ID';

          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Alice'] });
            await conn.execute('COMMIT');
            await conn.execute(insertSql, { parameters: [2, 'Bob'] });
            await conn.execute('COMMIT');
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
          expect(idbRes.data.length).toBe(2);
        },
      );
    });

    it('ROLLBACK should revert uncommitted changes', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': false, 'transaction isolation': 'read committed' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_RBK (
            ID INT, NAME VARCHAR(20)
          ) ON COMMIT PRESERVE ROWS WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_RBK VALUES (?, ?)';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_RBK ORDER BY ID';

          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Alice'] });
            await conn.execute('COMMIT');
            await conn.execute(insertSql, { parameters: [2, 'Bob'] });
            await conn.execute('ROLLBACK');
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
          // Only the committed row should remain
          expect(idbRes.data.length).toBe(1);
          expect(idbRes.data[0].NAME).toBe('Alice');
        },
      );
    });

    it('failed statement should not corrupt transaction state', async () => {
      await withBothBackends(
        { JDBCOptions: { 'auto commit': false, 'transaction isolation': 'read committed' } },
        async (idb, mapepire) => {
          const createSql = `DECLARE GLOBAL TEMPORARY TABLE PARITY_ERR (
            ID INT, NAME VARCHAR(20)
          ) ON COMMIT PRESERVE ROWS WITH REPLACE`;
          const insertSql = 'INSERT INTO SESSION.PARITY_ERR VALUES (?, ?)';
          const selectSql = 'SELECT ID, NAME FROM SESSION.PARITY_ERR ORDER BY ID';

          for (const conn of [idb, mapepire]) {
            await conn.execute(createSql);
            await conn.execute(insertSql, { parameters: [1, 'Alice'] });

            // Execute an invalid statement
            try {
              await conn.execute('SELECT * FROM NONEXISTENT.TABLE_DOES_NOT_EXIST');
            } catch (_e) {
              // Expected to fail
            }

            // Connection should still be usable — insert and commit
            await conn.execute(insertSql, { parameters: [2, 'Bob'] });
            await conn.execute('COMMIT');
          }

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(selectSql),
            mapepire.execute(selectSql),
          ]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
          expect(idbRes.data.length).toBe(2);
        },
      );
    });
  });

  // ----- initCommands -----

  describe('initCommands', () => {
    it('CL init commands execute on both backends', async () => {
      await withBothBackends(
        { initCommands: [{ command: 'CHGJOB INQMSGRPY(*DFT)', type: 'cl' }] },
        async (idb, mapepire) => {
          const sql = 'SELECT CUSNUM FROM QIWS.QCUSTCDT ORDER BY CUSNUM FETCH FIRST 1 ROW ONLY';

          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });

    it('SQL init commands execute on both backends', async () => {
      await withBothBackends(
        { initCommands: [{ command: 'SET SCHEMA QIWS', type: 'sql' }] },
        async (idb, mapepire) => {
          const sql = 'SELECT CUSNUM FROM QCUSTCDT ORDER BY CUSNUM FETCH FIRST 3 ROWS ONLY';

          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          expect(normalise(idbRes)).toEqual(normalise(mapRes));
        },
      );
    });
  });

  // ===================================================================
  // Data type parity
  // ===================================================================
  // Tests that all major DB2 for i SQL data types produce identical
  // results from both backends.
  //
  // Types NOT covered: DATALINK, ROWID, XML, DBCLOB, FLOAT (alias for DOUBLE)
  // ===================================================================

  describe('Data type parity', () => {
    const DT_LIB = 'PARITYTEST';
    const DT_TABLE = `${DT_LIB}.DATATYPES`;

    // --- Setup: create DATATYPES table and insert test rows ---

    beforeAll(async () => {
      const setup = new RmConnection({ backend: 'idb' });
      await setup.init(true);
      try {
        // Ensure library exists (ignore -601 if already there).
        // CREATE SCHEMA gives us a standard SQL error; QCMDEXC wraps CL errors
        // as generic SQLCODE=-443 losing the CPF code from the message.
        try {
          await setup.execute(`CREATE SCHEMA ${DT_LIB}`);
        } catch (e: any) {
          if (!e?.message?.includes('SQLCODE=-601')) throw e;
        }

        await setup.execute(`CREATE OR REPLACE TABLE ${DT_TABLE} (
          ROW_ID         INTEGER       NOT NULL,
          ROW_LABEL      VARCHAR(30)   NOT NULL,
          COL_SMALLINT   SMALLINT,
          COL_INT        INTEGER,
          COL_BIGINT     BIGINT,
          COL_DECIMAL    DECIMAL(15,4),
          COL_NUMERIC    NUMERIC(15,4),
          COL_REAL       REAL,
          COL_DOUBLE     DOUBLE,
          COL_CHAR       CHAR(20),
          COL_VARCHAR    VARCHAR(100),
          COL_CLOB       CLOB(1K),
          COL_DATE       DATE,
          COL_TIME       TIME,
          COL_TIMESTAMP  TIMESTAMP,
          COL_BINARY     BINARY(16),
          COL_VARBINARY  VARBINARY(64),
          COL_BLOB       BLOB(1K),
          COL_GRAPHIC    GRAPHIC(10) CCSID 13488,
          COL_VARGRAPHIC VARGRAPHIC(40) CCSID 13488
        )`);

        // Row 1: all values populated
        await setup.execute(`DELETE FROM ${DT_TABLE}`);
        await setup.execute(`INSERT INTO ${DT_TABLE} VALUES (
          1, 'ALL_VALUES',
          32000, 2147483000, 9007199254740000,
          12345.6789, 98765.4321,
          3.14, 2.718281828459045,
          'HELLO', 'World of DB2 for i', 'This is a CLOB value',
          '2024-06-15', '13:45:30', '2024-06-15-13.45.30.123456',
          CAST(X'48454C4C4F0000000000000000000000' AS BINARY(16)),
          CAST(X'DEADBEEF' AS VARBINARY(64)),
          CAST(X'0102030405' AS BLOB(1K)),
          'TestGraph', 'VarGraphic'
        )`);

        // Row 2: all nulls (except PK)
        await setup.execute(
          `INSERT INTO ${DT_TABLE} (ROW_ID, ROW_LABEL) VALUES (2, 'ALL_NULLS')`
        );

        // Row 3: edge cases
        await setup.execute(`INSERT INTO ${DT_TABLE} VALUES (
          3, 'EDGE_CASES',
          -32768, -2147483648, -9007199254740000,
          0.0000, 0.0000,
          0.0, -1.7976931348623157E+308,
          '                    ', '', '',
          '1970-01-01', '00:00:00', '1970-01-01-00.00.00.000000',
          CAST(X'00000000000000000000000000000000' AS BINARY(16)),
          CAST(X'' AS VARBINARY(64)),
          CAST(X'' AS BLOB(1K)),
          '          ', ''
        )`);
      } finally {
        await setup.close();
      }
    }, 60_000);

    afterAll(async () => {
      const teardown = new RmConnection({ backend: 'idb' });
      await teardown.init(true);
      try {
        await teardown.execute(`DROP TABLE ${DT_TABLE}`);
      } catch (e) {
        // Best-effort cleanup
      } finally {
        await teardown.close();
      }
    });

    // ----- Integer types -----

    it('integer types (SMALLINT, INTEGER, BIGINT)', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT COL_SMALLINT, COL_INT, COL_BIGINT FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        // SMALLINT and INTEGER match across backends
        expect(idbRes.data[0].COL_SMALLINT).toBe(mapRes.data[0].COL_SMALLINT);
        expect(idbRes.data[0].COL_INT).toBe(mapRes.data[0].COL_INT);
        expect(idbRes.data[0].COL_SMALLINT).toBe(32000);
        expect(idbRes.data[0].COL_INT).toBe(2147483000);

        // BIGINT: idb returns string, mapepire returns number
        expect(idbRes.data[0].COL_BIGINT).toBe('9007199254740000');
        expect(mapRes.data[0].COL_BIGINT).toBe(9007199254740000);
      });
    });

    // ----- Exact numeric types -----

    it('exact numeric types (DECIMAL, NUMERIC)', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT COL_DECIMAL, COL_NUMERIC FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);
        expect(normalise(idbRes)).toEqual(normalise(mapRes));
        expect(idbRes.data[0].COL_DECIMAL).toBe(12345.6789);
        expect(idbRes.data[0].COL_NUMERIC).toBe(98765.4321);
      });
    });

    // ----- Approximate numeric types -----

    it('approximate numeric types (REAL, DOUBLE)', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT COL_REAL, COL_DOUBLE FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        // REAL matches across backends
        expect(idbRes.data[0].COL_REAL).toBe(mapRes.data[0].COL_REAL);
        expect(idbRes.data[0].COL_REAL).toBe(3.14);

        // DOUBLE: idb truncates to ~6 significant digits, mapepire returns full precision
        expect(idbRes.data[0].COL_DOUBLE).toBeCloseTo(mapRes.data[0].COL_DOUBLE, 5);
        expect(mapRes.data[0].COL_DOUBLE).toBe(2.718281828459045);
        expect(idbRes.data[0].COL_DOUBLE).toBe(2.71828);
      });
    });

    // ----- Character types -----

    it('character types (CHAR, VARCHAR)', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT COL_CHAR, COL_VARCHAR FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);
        expect(normalise(idbRes)).toEqual(normalise(mapRes));
        // CHAR(20) 'HELLO' should be trimmed by both backends
        expect(idbRes.data[0].COL_CHAR).toBe('HELLO');
        expect(idbRes.data[0].COL_VARCHAR).toBe('World of DB2 for i');
      });
    });

    it('CLOB values', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT COL_CLOB FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);
        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    // ----- Date/time types -----

    it('date/time via VARCHAR_FORMAT (canonical)', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT
          VARCHAR_FORMAT(COL_DATE, 'YYYY-MM-DD') AS COL_DATE,
          VARCHAR_FORMAT(CAST(COL_TIME AS TIMESTAMP), 'HH24:MI:SS') AS COL_TIME,
          VARCHAR_FORMAT(COL_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS.NNNNNN') AS COL_TIMESTAMP
          FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);
        expect(normalise(idbRes)).toEqual(normalise(mapRes));
        expect(idbRes.data[0].COL_DATE).toBe('2024-06-15');
        expect(idbRes.data[0].COL_TIME).toBe('13:45:30');
        expect(idbRes.data[0].COL_TIMESTAMP).toBe('2024-06-15 13:45:30.123456');
      });
    });

    it('date/time raw format comparison', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT COL_DATE, COL_TIME, COL_TIMESTAMP FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        // Raw date/time formats differ between backends (documented in BACKEND-DIFFERENCES.md).
        // The canonical VARCHAR_FORMAT test validates correctness; here we just verify
        // both backends return data without error.
        expect(idbRes.data.length).toBe(1);
        expect(mapRes.data.length).toBe(1);
      });
    });

    // ----- Binary types -----

    it('binary types (BINARY, VARBINARY)', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT HEX(COL_BINARY) AS COL_BINARY, HEX(COL_VARBINARY) AS COL_VARBINARY FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);
        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    it('BLOB values', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT HEX(COL_BLOB) AS COL_BLOB FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);
        expect(normalise(idbRes)).toEqual(normalise(mapRes));
        expect(idbRes.data[0].COL_BLOB).toBe('0102030405');
      });
    });

    // ----- GRAPHIC types -----

    it('GRAPHIC and VARGRAPHIC', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT COL_GRAPHIC, COL_VARGRAPHIC FROM ${DT_TABLE} WHERE ROW_ID = 1`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);
        expect(normalise(idbRes)).toEqual(normalise(mapRes));
      });
    });

    // ----- NULL values -----

    it('NULL values across all types', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT * FROM ${DT_TABLE} WHERE ROW_ID = 2`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        const idbRow = idbRes.data[0];
        const mapRow = mapRes.data[0];

        // Most types return null on both backends
        expect(idbRow.COL_SMALLINT).toBeNull();
        expect(idbRow.COL_INT).toBeNull();
        expect(idbRow.COL_BIGINT).toBeNull();
        expect(idbRow.COL_DECIMAL).toBeNull();
        expect(idbRow.COL_VARCHAR).toBeNull();
        expect(idbRow.COL_DATE).toBeNull();
        expect(idbRow.COL_BLOB).toBeNull();

        // CLOB: idb returns empty string for NULL, mapepire returns null
        expect(idbRow.COL_CLOB).toBe('');
        expect(mapRow.COL_CLOB).toBeNull();
      });
    });

    // ----- Edge cases -----

    it('edge case values', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `SELECT COL_SMALLINT, COL_INT, COL_BIGINT, COL_DECIMAL, COL_NUMERIC,
          COL_REAL, COL_DOUBLE, COL_CHAR, COL_VARCHAR
          FROM ${DT_TABLE} WHERE ROW_ID = 3`;
        const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

        // Types that match across backends
        expect(idbRes.data[0].COL_SMALLINT).toBe(mapRes.data[0].COL_SMALLINT);
        expect(idbRes.data[0].COL_INT).toBe(mapRes.data[0].COL_INT);
        expect(idbRes.data[0].COL_SMALLINT).toBe(-32768);
        expect(idbRes.data[0].COL_INT).toBe(-2147483648);
        expect(idbRes.data[0].COL_DECIMAL).toBe(0);
        expect(idbRes.data[0].COL_VARCHAR).toBe('');

        // BIGINT: idb returns string, mapepire returns number
        expect(idbRes.data[0].COL_BIGINT).toBe('-9007199254740000');
        expect(mapRes.data[0].COL_BIGINT).toBe(-9007199254740000);

        // DOUBLE: idb truncates to ~6 significant digits
        const idbDouble = idbRes.data[0].COL_DOUBLE;
        const mapDouble = mapRes.data[0].COL_DOUBLE;
        const relError = Math.abs((idbDouble - mapDouble) / mapDouble);
        expect(relError).toBeLessThan(1e-5);
      });
    });

    // ----- BOOLEAN (V7R4+) -----

    describe('BOOLEAN (V7R4+)', () => {
      const BOOL_TABLE = `${DT_LIB}.DT_BOOL`;
      let supported = true;

      beforeAll(async () => {
        const setup = new RmConnection({ backend: 'idb' });
        await setup.init(true);
        try {
          await setup.execute(`CREATE OR REPLACE TABLE ${BOOL_TABLE} (
            ROW_ID INT NOT NULL, COL_BOOL BOOLEAN
          )`);
          await setup.execute(`INSERT INTO ${BOOL_TABLE} VALUES (1, TRUE)`);
          await setup.execute(`INSERT INTO ${BOOL_TABLE} VALUES (2, FALSE)`);
          await setup.execute(`INSERT INTO ${BOOL_TABLE} VALUES (3, NULL)`);
        } catch (e) {
          supported = false;
          console.log('BOOLEAN type not supported on this IBM i version, skipping');
        } finally {
          await setup.close();
        }
      });

      afterAll(async () => {
        if (!supported) return;
        const teardown = new RmConnection({ backend: 'idb' });
        await teardown.init(true);
        try {
          await teardown.execute(`DROP TABLE ${BOOL_TABLE}`);
        } catch (e) { /* best-effort */ }
        finally { await teardown.close(); }
      });

      // Note: idb-pconnector returns BOOLEAN as strings due to a buffer handling
      // issue in nodejs-idb-connector. A fix for garbage bytes after "FALSE" is
      // pending upstream: https://github.com/IBM/nodejs-idb-connector/pull/191
      it('BOOLEAN true/false/null values match', async () => {
        if (!supported) return;
        await withBothBackends({}, async (idb, mapepire) => {
          const sql = `SELECT ROW_ID, COL_BOOL FROM ${BOOL_TABLE} ORDER BY ROW_ID`;
          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          // mapepire returns native booleans
          expect(mapRes.data[0].COL_BOOL).toBe(true);
          expect(mapRes.data[1].COL_BOOL).toBe(false);
          expect(mapRes.data[2].COL_BOOL).toBeNull();

          // idb returns BOOLEAN as strings; pending upstream fix, FALSE may
          // contain trailing garbage bytes so we use startsWith
          expect(idbRes.data[0].COL_BOOL).toBe('TRUE');
          expect(typeof idbRes.data[1].COL_BOOL).toBe('string');
          expect(idbRes.data[1].COL_BOOL.startsWith('FALSE')).toBe(true);
          expect(idbRes.data[2].COL_BOOL).toBeNull();
        });
      });
    });

    // ----- DECFLOAT (V7R4+) -----

    describe('DECFLOAT (V7R4+)', () => {
      const DF_TABLE = `${DT_LIB}.DT_DECFLOAT`;
      let supported = true;

      beforeAll(async () => {
        const setup = new RmConnection({ backend: 'idb' });
        await setup.init(true);
        try {
          await setup.execute(`CREATE OR REPLACE TABLE ${DF_TABLE} (
            ROW_ID INT NOT NULL, COL_DF16 DECFLOAT(16), COL_DF34 DECFLOAT(34)
          )`);
          await setup.execute(`INSERT INTO ${DF_TABLE} VALUES (1, 12345.6789, 98765432101234.5678901234567890)`);
          await setup.execute(`INSERT INTO ${DF_TABLE} VALUES (2, NULL, NULL)`);
        } catch (e) {
          supported = false;
          console.log('DECFLOAT type not supported on this IBM i version, skipping');
        } finally {
          await setup.close();
        }
      });

      afterAll(async () => {
        if (!supported) return;
        const teardown = new RmConnection({ backend: 'idb' });
        await teardown.init(true);
        try {
          await teardown.execute(`DROP TABLE ${DF_TABLE}`);
        } catch (e) { /* best-effort */ }
        finally { await teardown.close(); }
      });

      it('DECFLOAT(16) and DECFLOAT(34) values match', async () => {
        if (!supported) return;
        await withBothBackends({}, async (idb, mapepire) => {
          const sql = `SELECT ROW_ID, COL_DF16, COL_DF34 FROM ${DF_TABLE} ORDER BY ROW_ID`;
          const [idbRes, mapRes] = await Promise.all([idb.execute(sql), mapepire.execute(sql)]);

          // Row 1: idb returns DECFLOAT as strings (preserving full precision),
          // mapepire returns as numbers (truncated to JS double precision)
          expect(idbRes.data[0].COL_DF16).toBe('12345.6789');
          expect(mapRes.data[0].COL_DF16).toBe(12345.6789);
          expect(idbRes.data[0].COL_DF34).toBe('98765432101234.5678901234567890');
          expect(mapRes.data[0].COL_DF34).toBe(98765432101234.56);

          // Row 2: nulls match on both backends
          expect(idbRes.data[1].COL_DF16).toBeNull();
          expect(mapRes.data[1].COL_DF16).toBeNull();
          expect(idbRes.data[1].COL_DF34).toBeNull();
          expect(mapRes.data[1].COL_DF34).toBeNull();
        });
      });
    });
  });

  // ===================================================================
  // Stored procedure output parameters
  //
  // Tests that output parameters from stored procedures are returned
  // correctly on both backends. A test procedure is created with IN,
  // OUT, and INOUT parameters of various types.
  //
  // Known differences (see BACKEND-DIFFERENCES.md):
  //   - Both backends return entries for all parameters (IN + OUT + INOUT)
  //   - idb: value present on all parameters; mapepire: value only on OUT/INOUT
  //   - mapepire includes extra metadata (type, name, precision, scale, ccsid)
  //   - NULL OUT params: idb returns zero values (""/0), mapepire returns null
  // ===================================================================

  describe('Stored procedure output parameters', () => {
    const SP_LIB = 'PARITYTEST';
    const SP_NAME = `${SP_LIB}.PARITY_SP`;

    beforeAll(async () => {
      const setup = new RmConnection({ backend: 'idb' });
      await setup.init(true);
      try {
        try {
          await setup.execute(`CREATE SCHEMA ${SP_LIB}`);
        } catch (e: any) {
          if (!e?.message?.includes('SQLCODE=-601')) throw e;
        }

        await setup.execute(`CREATE OR REPLACE PROCEDURE ${SP_NAME} (
          IN  P_NAME     VARCHAR(50),
          IN  P_AMOUNT   DECIMAL(9,2),
          OUT P_GREETING VARCHAR(100),
          OUT P_DOUBLED  DECIMAL(11,2),
          INOUT P_COUNTER INTEGER
        )
        LANGUAGE SQL
        BEGIN
          SET P_GREETING = 'Hello, ' CONCAT TRIM(P_NAME) CONCAT '!';
          SET P_DOUBLED  = P_AMOUNT * 2;
          SET P_COUNTER  = P_COUNTER + 1;
        END`);
      } finally {
        await setup.close();
      }
    }, 60_000);

    afterAll(async () => {
      const teardown = new RmConnection({ backend: 'idb' });
      await teardown.init(true);
      try {
        await teardown.execute(`DROP PROCEDURE ${SP_NAME}`);
      } catch (e) {
        // Best-effort cleanup
      } finally {
        await teardown.close();
      }
    });

    it('basic OUT parameter values match', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `CALL ${SP_NAME}(?, ?, ?, ?, ?)`;
        const opts = { parameters: ['Alice', 12.50, '', 0, 5] };

        const [idbRes, mapRes] = await Promise.all([
          idb.execute(sql, opts),
          mapepire.execute(sql, opts),
        ]);

        expect(idbRes.success).toBe(true);
        expect(mapRes.success).toBe(true);

        const idbParms = (idbRes as any).output_parms;
        const mapParms = (mapRes as any).output_parms;

        expect(idbParms).toBeDefined();
        expect(mapParms).toBeDefined();

        // Both backends should return the correct output values.
        // Find by index — idb uses 1-based indexing for all params,
        // mapepire may only include output params.
        const idbGreeting = idbParms.find((p: any) => p.index === 3);
        const mapGreeting = mapParms.find((p: any) => p.index === 3);
        expect(idbGreeting.value).toBe('Hello, Alice!');
        expect(mapGreeting.value).toBe('Hello, Alice!');

        const idbDoubled = idbParms.find((p: any) => p.index === 4);
        const mapDoubled = mapParms.find((p: any) => p.index === 4);
        expect(Number(idbDoubled.value)).toBe(25.00);
        expect(Number(mapDoubled.value)).toBe(25.00);

        // INOUT parameter
        const idbCounter = idbParms.find((p: any) => p.index === 5);
        const mapCounter = mapParms.find((p: any) => p.index === 5);
        expect(Number(idbCounter.value)).toBe(6);
        expect(Number(mapCounter.value)).toBe(6);
      });
    });

    it('both backends return all parameters but differ on IN param values', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `CALL ${SP_NAME}(?, ?, ?, ?, ?)`;
        const opts = { parameters: ['Bob', 7.00, '', 0, 10] };

        const [idbRes, mapRes] = await Promise.all([
          idb.execute(sql, opts),
          mapepire.execute(sql, opts),
        ]);

        const idbParms = (idbRes as any).output_parms;
        const mapParms = (mapRes as any).output_parms;

        // Both backends return entries for ALL parameters (input + output)
        expect(idbParms.length).toBe(5);
        expect(mapParms.length).toBe(5);

        // Both have entries for IN parameters (index 1 and 2)
        expect(idbParms.find((p: any) => p.index === 1)).toBeDefined();
        expect(mapParms.find((p: any) => p.index === 1)).toBeDefined();

        // idb includes value on IN parameters
        const idbInParam = idbParms.find((p: any) => p.index === 1);
        expect(idbInParam.value).toBe('Bob');

        // mapepire does NOT include value on IN parameters
        const mapInParam = mapParms.find((p: any) => p.index === 1);
        expect(mapInParam.value).toBeUndefined();
      });
    });

    it('mapepire includes extra metadata fields', async () => {
      await withBothBackends({}, async (idb, mapepire) => {
        const sql = `CALL ${SP_NAME}(?, ?, ?, ?, ?)`;
        const opts = { parameters: ['Charlie', 1.00, '', 0, 0] };

        const [idbRes, mapRes] = await Promise.all([
          idb.execute(sql, opts),
          mapepire.execute(sql, opts),
        ]);

        const idbParms = (idbRes as any).output_parms;
        const mapParms = (mapRes as any).output_parms;

        const idbGreeting = idbParms.find((p: any) => p.index === 3);
        const mapGreeting = mapParms.find((p: any) => p.index === 3);

        // idb output_parms entries only have index and value
        expect(Object.keys(idbGreeting).sort()).toEqual(['index', 'value']);

        // mapepire output_parms entries include additional metadata
        expect(mapGreeting).toHaveProperty('type');
        expect(mapGreeting).toHaveProperty('name');
        expect(mapGreeting).toHaveProperty('precision');
        expect(mapGreeting).toHaveProperty('scale');
        expect(mapGreeting).toHaveProperty('ccsid');
      });
    });

    it('NULL output parameter values across types', async () => {
      // idb never returns null for NULL OUT params — it returns the type's
      // zero value (empty string for string/date types, 0 for numerics).
      // mapepire returns null for all types.
      const SP_NULL = `${SP_LIB}.PARITY_SP_NULL`;
      const setup = new RmConnection({ backend: 'idb' });
      await setup.init(true);
      try {
        await setup.execute(`CREATE OR REPLACE PROCEDURE ${SP_NULL} (
          OUT P_VARCHAR    VARCHAR(50),
          OUT P_INT        INTEGER,
          OUT P_DECIMAL    DECIMAL(9,2),
          OUT P_DATE       DATE,
          OUT P_CLOB       CLOB(1K),
          OUT P_SMALLINT   SMALLINT,
          OUT P_NUMERIC    NUMERIC(9,2),
          OUT P_CHAR       CHAR(20),
          OUT P_TIME       TIME,
          OUT P_TIMESTAMP  TIMESTAMP,
          OUT P_BLOB       BLOB(1K)
        )
        LANGUAGE SQL
        BEGIN
          SET P_VARCHAR   = NULL;
          SET P_INT       = NULL;
          SET P_DECIMAL   = NULL;
          SET P_DATE      = NULL;
          SET P_CLOB      = NULL;
          SET P_SMALLINT  = NULL;
          SET P_NUMERIC   = NULL;
          SET P_CHAR      = NULL;
          SET P_TIME      = NULL;
          SET P_TIMESTAMP = NULL;
          SET P_BLOB      = NULL;
        END`);
      } finally {
        await setup.close();
      }

      try {
        await withBothBackends({}, async (idb, mapepire) => {
          const sql = `CALL ${SP_NULL}(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          const opts = { parameters: ['', 0, 0, '', '', 0, 0, '', '', '', ''] };

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(sql, opts),
            mapepire.execute(sql, opts),
          ]);

          const idbParms = (idbRes as any).output_parms;
          const mapParms = (mapRes as any).output_parms;

          // mapepire returns null for all NULL OUT params
          for (let i = 1; i <= 11; i++) {
            const mapVal = mapParms.find((p: any) => p.index === i);
            expect(mapVal.value).toBeNull();
          }

          // idb returns zero values instead of null:
          // string/date/time/clob → empty string, numeric → 0
          const idbVarchar = idbParms.find((p: any) => p.index === 1);
          expect(idbVarchar.value).toBe('');

          const idbInt = idbParms.find((p: any) => p.index === 2);
          expect(idbInt.value).toBe(0);

          const idbDecimal = idbParms.find((p: any) => p.index === 3);
          expect(idbDecimal.value).toBe(0);

          const idbDate = idbParms.find((p: any) => p.index === 4);
          expect(idbDate.value).toBe('');

          const idbClob = idbParms.find((p: any) => p.index === 5);
          expect(idbClob.value).toBe('');

          const idbSmallint = idbParms.find((p: any) => p.index === 6);
          expect(idbSmallint.value).toBe(0);

          const idbNumeric = idbParms.find((p: any) => p.index === 7);
          expect(idbNumeric.value).toBe(0);

          const idbChar = idbParms.find((p: any) => p.index === 8);
          expect(idbChar.value).toBe('');

          const idbTime = idbParms.find((p: any) => p.index === 9);
          expect(idbTime.value).toBe('');

          const idbTimestamp = idbParms.find((p: any) => p.index === 10);
          expect(idbTimestamp.value).toBe('');

          const idbBlob = idbParms.find((p: any) => p.index === 11);
          expect(idbBlob.value).toBe('');
        });
      } finally {
        const teardown = new RmConnection({ backend: 'idb' });
        await teardown.init(true);
        try {
          await teardown.execute(`DROP PROCEDURE ${SP_NULL}`);
        } catch (e) {
          // Best-effort
        } finally {
          await teardown.close();
        }
      }
    });

    it('multiple output parameters with different types', async () => {
      const SP_MULTI = `${SP_LIB}.PARITY_SP_MULTI`;
      const setup = new RmConnection({ backend: 'idb' });
      await setup.init(true);
      try {
        await setup.execute(`CREATE OR REPLACE PROCEDURE ${SP_MULTI} (
          OUT P_STR    VARCHAR(50),
          OUT P_INT    INTEGER,
          OUT P_DEC    DECIMAL(9,2),
          OUT P_DATE   DATE
        )
        LANGUAGE SQL
        BEGIN
          SET P_STR  = 'test output';
          SET P_INT  = 42;
          SET P_DEC  = 123.45;
          SET P_DATE = DATE('2024-06-15');
        END`);
      } finally {
        await setup.close();
      }

      try {
        await withBothBackends({}, async (idb, mapepire) => {
          const sql = `CALL ${SP_MULTI}(?, ?, ?, ?)`;
          const opts = { parameters: ['', 0, 0, ''] };

          const [idbRes, mapRes] = await Promise.all([
            idb.execute(sql, opts),
            mapepire.execute(sql, opts),
          ]);

          const idbParms = (idbRes as any).output_parms;
          const mapParms = (mapRes as any).output_parms;

          // VARCHAR output
          const idbStr = idbParms.find((p: any) => p.index === 1);
          const mapStr = mapParms.find((p: any) => p.index === 1);
          expect(idbStr.value).toBe('test output');
          expect(mapStr.value).toBe('test output');

          // INTEGER output
          const idbInt = idbParms.find((p: any) => p.index === 2);
          const mapInt = mapParms.find((p: any) => p.index === 2);
          expect(Number(idbInt.value)).toBe(42);
          expect(Number(mapInt.value)).toBe(42);

          // DECIMAL output
          const idbDec = idbParms.find((p: any) => p.index === 3);
          const mapDec = mapParms.find((p: any) => p.index === 3);
          expect(Number(idbDec.value)).toBe(123.45);
          expect(Number(mapDec.value)).toBe(123.45);

          // DATE output — both should return a date string
          const idbDate = idbParms.find((p: any) => p.index === 4);
          const mapDate = mapParms.find((p: any) => p.index === 4);
          expect(idbDate.value).toBeDefined();
          expect(mapDate.value).toBeDefined();
          // The actual format may differ (see BACKEND-DIFFERENCES.md raw DATE format)
          // but both should represent the same date
        });
      } finally {
        const teardown = new RmConnection({ backend: 'idb' });
        await teardown.init(true);
        try {
          await teardown.execute(`DROP PROCEDURE ${SP_MULTI}`);
        } catch (e) {
          // Best-effort
        } finally {
          await teardown.close();
        }
      }
    });
  });
});

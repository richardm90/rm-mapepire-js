/**
 * Backend Performance Tests
 *
 * These tests compare the performance of the mapepire and idb backends
 * running on the same IBM i system. They are designed to complement
 * Liam's benchmarks (which tested remote ODBC vs Mapepire from a Mac)
 * by measuring both backends locally on IBM i.
 *
 * These tests are NOT part of the regular `npm test` suite. They require:
 *   - Running on IBM i (for idb-pconnector access)
 *   - Network access to the same IBM i with mapepire
 *   - Environment variables: IBMI_HOST, IBMI_USER, IBMI_PASSWORD
 *   - A running mapepire server on the target IBM i
 *   - The SAMPLE schema (created via: CALL QSYS.CREATE_SQL_SAMPLE('SAMPLE'))
 *
 * Run with: npm run test:performance
 */

import { performance } from 'perf_hooks';
import RmConnection from '../../src/rmConnection';
import RmPool from '../../src/rmPool';
import { RmConnectionOptions, PoolOptions } from '../../src/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAPEPIRE_CREDS = {
  host: process.env.IBMI_HOST || 'localhost',
  user: process.env.IBMI_USER || '',
  password: process.env.IBMI_PASSWORD || '',
  rejectUnauthorized: false,
};

/** Number of queries per scenario (configurable via QUERY_COUNT env var) */
const QUERY_COUNT = Number(process.env.QUERY_COUNT) || 50;

/** Number of warm-up queries before measurement */
const WARMUP_COUNT = 3;

/** Pool size (matches Liam's benchmark) */
const POOL_SIZE = 5;

/** SAMPLE schema name (configurable via SAMPLE_SCHEMA env var) */
const SAMPLE_SCHEMA = process.env.SAMPLE_SCHEMA || 'SAMPLE';

/** SQL statement for standard benchmarks (same as Liam's) */
const SQL_STANDARD = `SELECT * FROM ${SAMPLE_SCHEMA}.DEPARTMENT`;

/** SQL statement for large result set benchmarks */
const SQL_LARGE = `SELECT * FROM ${SAMPLE_SCHEMA}.EMPLOYEE CROSS JOIN (VALUES 1,2,3,4,5,6,7,8,9,10) AS T(N)`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimingResult {
  times: number[];
  wallClock: number;
}

interface Stats {
  min: number;
  max: number;
  avg: number;
  median: number;
  total: number;
  wallClock: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseOpts(): { idb: RmConnectionOptions; mapepire: RmConnectionOptions } {
  return {
    idb: { backend: 'idb', logLevel: 'none' },
    mapepire: { backend: 'mapepire', creds: MAPEPIRE_CREDS, logLevel: 'none' },
  };
}

function poolOpts(): { idb: PoolOptions; mapepire: PoolOptions } {
  return {
    idb: {
      backend: 'idb',
      logLevel: 'none',
      maxSize: POOL_SIZE,
      initialConnections: { size: POOL_SIZE },
    },
    mapepire: {
      backend: 'mapepire',
      creds: MAPEPIRE_CREDS,
      logLevel: 'none',
      maxSize: POOL_SIZE,
      initialConnections: { size: POOL_SIZE },
    },
  };
}

function calcStats(timing: TimingResult): Stats {
  const sorted = [...timing.times].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, t) => acc + t, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    median,
    total: sum,
    wallClock: timing.wallClock,
    count: sorted.length,
  };
}

function formatMs(ms: number): string {
  return ms.toFixed(2) + 'ms';
}

function printComparison(label: string, idbStats: Stats, mapepireStats: Stats): void {
  console.log('');
  console.log(`  ┌─────────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${label.padEnd(63)} │`);
  console.log(`  ├──────────────────┬──────────────────┬──────────────────┬────────┤`);
  console.log(`  │ Metric           │ idb              │ mapepire         │ Ratio  │`);
  console.log(`  ├──────────────────┼──────────────────┼──────────────────┼────────┤`);

  const rows: [string, number, number][] = [
    ['Min', idbStats.min, mapepireStats.min],
    ['Max', idbStats.max, mapepireStats.max],
    ['Avg', idbStats.avg, mapepireStats.avg],
    ['Median', idbStats.median, mapepireStats.median],
    ['Total (sum)', idbStats.total, mapepireStats.total],
    ['Wall clock', idbStats.wallClock, mapepireStats.wallClock],
  ];

  for (const [metric, idb, map] of rows) {
    const r = map / idb;
    const ratioStr = r > 1 ? `${r.toFixed(1)}x` : `${(1 / r).toFixed(1)}x`;
    console.log(
      `  │ ${metric.padEnd(16)} │ ${formatMs(idb).padStart(16)} │ ${formatMs(map).padStart(16)} │ ${ratioStr.padStart(6)} │`,
    );
  }

  console.log(`  └──────────────────┴──────────────────┴──────────────────┴────────┘`);
  console.log(`  Queries: ${idbStats.count}, Warm-up: ${WARMUP_COUNT}`);
}

// ---------------------------------------------------------------------------
// Timing functions
// ---------------------------------------------------------------------------

/** Time N sequential queries on a single connection */
async function timeSequential(conn: RmConnection, sql: string, count: number): Promise<TimingResult> {
  const times: number[] = [];

  // Warm-up
  for (let i = 0; i < WARMUP_COUNT; i++) {
    await conn.execute(sql);
  }

  const wallStart = performance.now();
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await conn.execute(sql);
    times.push(performance.now() - start);
  }
  const wallClock = performance.now() - wallStart;

  return { times, wallClock };
}

/** Time N concurrent queries on a single connection via Promise.all */
async function timeConcurrentSingle(conn: RmConnection, sql: string, count: number): Promise<TimingResult> {
  // Warm-up
  for (let i = 0; i < WARMUP_COUNT; i++) {
    await conn.execute(sql);
  }

  const times: number[] = [];
  const wallStart = performance.now();

  await Promise.all(
    Array.from({ length: count }, async () => {
      const start = performance.now();
      await conn.execute(sql);
      times.push(performance.now() - start);
    }),
  );

  const wallClock = performance.now() - wallStart;
  return { times, wallClock };
}

/** Time N sequential queries using pool.query() (handles attach/detach internally) */
async function timePoolSequential(pool: RmPool, sql: string, count: number): Promise<TimingResult> {
  const times: number[] = [];

  // Warm-up
  for (let i = 0; i < WARMUP_COUNT; i++) {
    await pool.query(sql);
  }

  const wallStart = performance.now();
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await pool.query(sql);
    times.push(performance.now() - start);
  }
  const wallClock = performance.now() - wallStart;

  return { times, wallClock };
}

/** Time N concurrent queries using pool.query() via Promise.all */
async function timePoolConcurrent(pool: RmPool, sql: string, count: number): Promise<TimingResult> {
  // Warm-up
  for (let i = 0; i < WARMUP_COUNT; i++) {
    await pool.query(sql);
  }

  const times: number[] = [];
  const wallStart = performance.now();

  await Promise.all(
    Array.from({ length: count }, async () => {
      const start = performance.now();
      await pool.query(sql);
      times.push(performance.now() - start);
    }),
  );

  const wallClock = performance.now() - wallStart;
  return { times, wallClock };
}

// ---------------------------------------------------------------------------
// Guard: skip entire suite if credentials are missing
// ---------------------------------------------------------------------------

const skip = !process.env.IBMI_HOST || !process.env.IBMI_USER || !process.env.IBMI_PASSWORD;

const describeIf = skip ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIf('Backend Performance', () => {
  jest.setTimeout(120_000);

  // -------------------------------------------------------------------
  // 1. Connection Creation
  // -------------------------------------------------------------------
  describe('Connection creation', () => {
    it('measures connection creation time for both backends', async () => {
      const iterations = 10;
      const idbTimes: number[] = [];
      const mapepireTimes: number[] = [];
      const opts = baseOpts();

      for (let i = 0; i < iterations; i++) {
        const idbConn = new RmConnection(opts.idb);
        const start = performance.now();
        await idbConn.init(true);
        idbTimes.push(performance.now() - start);
        await idbConn.close();

        const mapConn = new RmConnection(opts.mapepire);
        const mStart = performance.now();
        await mapConn.init(true);
        mapepireTimes.push(performance.now() - mStart);
        await mapConn.close();
      }

      const idbStats = calcStats({ times: idbTimes, wallClock: idbTimes.reduce((a, b) => a + b, 0) });
      const mapStats = calcStats({ times: mapepireTimes, wallClock: mapepireTimes.reduce((a, b) => a + b, 0) });

      printComparison(`Connection Creation (${iterations} iterations)`, idbStats, mapStats);

      // Sanity check: both backends should have connected
      expect(idbTimes.length).toBe(iterations);
      expect(mapepireTimes.length).toBe(iterations);
    });
  });

  // -------------------------------------------------------------------
  // 2. Single Connection — Sequential (baseline latency)
  // -------------------------------------------------------------------
  describe('Single connection — sequential', () => {
    it('standard query', async () => {
      const opts = baseOpts();
      const idbConn = new RmConnection(opts.idb);
      const mapConn = new RmConnection(opts.mapepire);
      await Promise.all([idbConn.init(true), mapConn.init(true)]);

      try {
        const idbTiming = await timeSequential(idbConn, SQL_STANDARD, QUERY_COUNT);
        const mapTiming = await timeSequential(mapConn, SQL_STANDARD, QUERY_COUNT);

        printComparison(
          `Single Connection — Sequential (${SQL_STANDARD})`,
          calcStats(idbTiming),
          calcStats(mapTiming),
        );
      } finally {
        await Promise.all([idbConn.close(), mapConn.close()]);
      }
    });

    it('large result set', async () => {
      const opts = baseOpts();
      const idbConn = new RmConnection(opts.idb);
      const mapConn = new RmConnection(opts.mapepire);
      await Promise.all([idbConn.init(true), mapConn.init(true)]);

      try {
        const idbTiming = await timeSequential(idbConn, SQL_LARGE, QUERY_COUNT);
        const mapTiming = await timeSequential(mapConn, SQL_LARGE, QUERY_COUNT);

        printComparison(
          `Single Connection — Sequential — Large Result Set`,
          calcStats(idbTiming),
          calcStats(mapTiming),
        );
      } finally {
        await Promise.all([idbConn.close(), mapConn.close()]);
      }
    });
  });

  // -------------------------------------------------------------------
  // 3. Single Connection — Promise.all (concurrent on one connection)
  // -------------------------------------------------------------------
  describe('Single connection — Promise.all', () => {
    it('standard query', async () => {
      const opts = baseOpts();
      const idbConn = new RmConnection(opts.idb);
      const mapConn = new RmConnection(opts.mapepire);
      await Promise.all([idbConn.init(true), mapConn.init(true)]);

      try {
        const idbTiming = await timeConcurrentSingle(idbConn, SQL_STANDARD, QUERY_COUNT);
        const mapTiming = await timeConcurrentSingle(mapConn, SQL_STANDARD, QUERY_COUNT);

        printComparison(
          `Single Connection — Promise.all (${SQL_STANDARD})`,
          calcStats(idbTiming),
          calcStats(mapTiming),
        );
      } finally {
        await Promise.all([idbConn.close(), mapConn.close()]);
      }
    });
  });

  // -------------------------------------------------------------------
  // 4. Pool — Sequential
  // -------------------------------------------------------------------
  describe('Pool — sequential', () => {
    it('standard query', async () => {
      const opts = poolOpts();
      const idbPool = new RmPool({ id: 'idb-perf', config: { id: 'idb-perf', PoolOptions: opts.idb } }, 'none');
      const mapPool = new RmPool({ id: 'map-perf', config: { id: 'map-perf', PoolOptions: opts.mapepire } }, 'none');
      await Promise.all([idbPool.init(), mapPool.init()]);

      try {
        const idbTiming = await timePoolSequential(idbPool, SQL_STANDARD, QUERY_COUNT);
        const mapTiming = await timePoolSequential(mapPool, SQL_STANDARD, QUERY_COUNT);

        printComparison(
          `Pool (${POOL_SIZE}) — Sequential (${SQL_STANDARD})`,
          calcStats(idbTiming),
          calcStats(mapTiming),
        );
      } finally {
        await Promise.all([idbPool.close(), mapPool.close()]);
      }
    });
  });

  // -------------------------------------------------------------------
  // 5. Pool — Promise.all (concurrent burst)
  // -------------------------------------------------------------------
  describe('Pool — Promise.all', () => {
    it('standard query', async () => {
      const opts = poolOpts();
      const idbPool = new RmPool({ id: 'idb-perf', config: { id: 'idb-perf', PoolOptions: opts.idb } }, 'none');
      const mapPool = new RmPool({ id: 'map-perf', config: { id: 'map-perf', PoolOptions: opts.mapepire } }, 'none');
      await Promise.all([idbPool.init(), mapPool.init()]);

      try {
        const idbTiming = await timePoolConcurrent(idbPool, SQL_STANDARD, QUERY_COUNT);
        const mapTiming = await timePoolConcurrent(mapPool, SQL_STANDARD, QUERY_COUNT);

        printComparison(
          `Pool (${POOL_SIZE}) — Promise.all (${SQL_STANDARD})`,
          calcStats(idbTiming),
          calcStats(mapTiming),
        );
      } finally {
        await Promise.all([idbPool.close(), mapPool.close()]);
      }
    });
  });

  // -------------------------------------------------------------------
  // 6. Parameterized Queries
  // -------------------------------------------------------------------
  describe('Parameterized queries — sequential', () => {
    it('measures parameterized query performance', async () => {
      const opts = baseOpts();
      const idbConn = new RmConnection(opts.idb);
      const mapConn = new RmConnection(opts.mapepire);
      await Promise.all([idbConn.init(true), mapConn.init(true)]);

      const sql = 'SELECT * FROM QIWS.QCUSTCDT WHERE STATE = ?';
      const queryOpts = { parameters: ['TX'] };

      try {
        const idbTimes: number[] = [];
        const mapTimes: number[] = [];

        // Warm-up
        for (let i = 0; i < WARMUP_COUNT; i++) {
          await idbConn.execute(sql, queryOpts);
          await mapConn.execute(sql, queryOpts);
        }

        const idbWallStart = performance.now();
        for (let i = 0; i < QUERY_COUNT; i++) {
          const start = performance.now();
          await idbConn.execute(sql, queryOpts);
          idbTimes.push(performance.now() - start);
        }
        const idbWallClock = performance.now() - idbWallStart;

        const mapWallStart = performance.now();
        for (let i = 0; i < QUERY_COUNT; i++) {
          const start = performance.now();
          await mapConn.execute(sql, queryOpts);
          mapTimes.push(performance.now() - start);
        }
        const mapWallClock = performance.now() - mapWallStart;

        printComparison(
          `Parameterized Query — Sequential`,
          calcStats({ times: idbTimes, wallClock: idbWallClock }),
          calcStats({ times: mapTimes, wallClock: mapWallClock }),
        );
      } finally {
        await Promise.all([idbConn.close(), mapConn.close()]);
      }
    });
  });
});

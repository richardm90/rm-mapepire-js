/**
 * Native Mapepire Pool vs idb through RmPool
 *
 * This test compares raw Mapepire pool performance (with multiplexing)
 * against idb-pconnector through rm-connector-js's RmPool. The goal is
 * to determine whether Mapepire's ability to multiplex queries on a
 * single WebSocket connection can compensate for its higher per-query
 * latency when compared to idb's native DB2 CLI path.
 *
 * rm-connector-js treats each connection as one-query-at-a-time (the
 * lowest common denominator for both backends). Native Mapepire pools
 * can send multiple queries concurrently on the same connection.
 *
 * Run with: IBMI_HOST=... IBMI_USER=... IBMI_PASSWORD=... npx jest --config jest.perf.config.js native-mapepire-pool
 */

import { performance } from 'perf_hooks';
import { Pool as MapepirePool } from '@ibm/mapepire-js';
import RmPool from '../../src/rmPool';
import { PoolOptions } from '../../src/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAPEPIRE_CREDS = {
  host: process.env.IBMI_HOST || 'localhost',
  user: process.env.IBMI_USER || '',
  password: process.env.IBMI_PASSWORD || '',
  rejectUnauthorized: false,
};

const QUERY_COUNT = Number(process.env.QUERY_COUNT) || 50;
const WARMUP_COUNT = 3;
const POOL_SIZE = 5;

const SAMPLE_SCHEMA = process.env.SAMPLE_SCHEMA || 'SAMPLE';
const SQL_STANDARD = `SELECT * FROM ${SAMPLE_SCHEMA}.DEPARTMENT`;

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

// Bypass Jest's console.log decoration by writing directly to stdout.
const println = (s: string = ''): void => {
  process.stdout.write(s + '\n');
};

function printComparison(label: string, idbStats: Stats, mapepireStats: Stats): void {
  println('');
  println(`  ┌─────────────────────────────────────────────────────────────────┐`);
  println(`  │ ${label.padEnd(63)} │`);
  println(`  ├──────────────────┬──────────────────┬──────────────────┬────────┤`);
  println(`  │ Metric           │ idb (RmPool)     │ mapepire (native)│ Ratio  │`);
  println(`  ├──────────────────┼──────────────────┼──────────────────┼────────┤`);

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
    println(
      `  │ ${metric.padEnd(16)} │ ${formatMs(idb).padStart(16)} │ ${formatMs(map).padStart(16)} │ ${ratioStr.padStart(6)} │`,
    );
  }

  println(`  └──────────────────┴──────────────────┴──────────────────┴────────┘`);
  println(`  Queries: ${idbStats.count}, Warm-up: ${WARMUP_COUNT}, Pool size: ${POOL_SIZE}`);
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const skip = !process.env.IBMI_HOST || !process.env.IBMI_USER || !process.env.IBMI_PASSWORD;
const describeIf = skip ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIf('Native Mapepire Pool vs idb RmPool', () => {
  jest.setTimeout(120_000);

  // -------------------------------------------------------------------
  // Sequential — baseline (both use one-at-a-time semantics)
  // -------------------------------------------------------------------
  describe('Sequential', () => {
    it('compares sequential query throughput', async () => {
      // --- idb via RmPool ---
      const idbOpts: PoolOptions = {
        backend: 'idb',
        logLevel: 'none',
        maxSize: POOL_SIZE,
        initialConnections: { size: POOL_SIZE },
      };
      const idbPool = new RmPool({ id: 'idb-native', config: { id: 'idb-native', PoolOptions: idbOpts } }, 'none');
      await idbPool.init();

      // --- Native Mapepire pool ---
      const mapPool = new MapepirePool({
        creds: MAPEPIRE_CREDS,
        maxSize: POOL_SIZE,
        startingSize: POOL_SIZE,
      });
      await mapPool.init();

      try {
        // Warm-up both
        for (let i = 0; i < WARMUP_COUNT; i++) {
          await idbPool.query(SQL_STANDARD);
          await mapPool.execute(SQL_STANDARD);
        }

        // idb sequential
        const idbTimes: number[] = [];
        const idbWallStart = performance.now();
        for (let i = 0; i < QUERY_COUNT; i++) {
          const start = performance.now();
          await idbPool.query(SQL_STANDARD);
          idbTimes.push(performance.now() - start);
        }
        const idbWallClock = performance.now() - idbWallStart;

        // Mapepire sequential
        const mapTimes: number[] = [];
        const mapWallStart = performance.now();
        for (let i = 0; i < QUERY_COUNT; i++) {
          const start = performance.now();
          await mapPool.execute(SQL_STANDARD);
          mapTimes.push(performance.now() - start);
        }
        const mapWallClock = performance.now() - mapWallStart;

        printComparison(
          'Sequential',
          calcStats({ times: idbTimes, wallClock: idbWallClock }),
          calcStats({ times: mapTimes, wallClock: mapWallClock }),
        );
      } finally {
        await idbPool.close();
        mapPool.end();
      }
    });
  });

  // -------------------------------------------------------------------
  // Promise.all — this is where multiplexing matters
  // -------------------------------------------------------------------
  describe('Promise.all (concurrent burst)', () => {
    it('compares concurrent throughput — native multiplexing vs RmPool queuing', async () => {
      // --- idb via RmPool (one-at-a-time per connection) ---
      const idbOpts: PoolOptions = {
        backend: 'idb',
        logLevel: 'none',
        maxSize: POOL_SIZE,
        initialConnections: { size: POOL_SIZE },
      };
      const idbPool = new RmPool({ id: 'idb-native', config: { id: 'idb-native', PoolOptions: idbOpts } }, 'none');
      await idbPool.init();

      // --- Native Mapepire pool (multiplexed) ---
      const mapPool = new MapepirePool({
        creds: MAPEPIRE_CREDS,
        maxSize: POOL_SIZE,
        startingSize: POOL_SIZE,
      });
      await mapPool.init();

      try {
        // Warm-up both
        for (let i = 0; i < WARMUP_COUNT; i++) {
          await idbPool.query(SQL_STANDARD);
          await mapPool.execute(SQL_STANDARD);
        }

        // idb concurrent via RmPool
        const idbTimes: number[] = [];
        const idbWallStart = performance.now();
        await Promise.all(
          Array.from({ length: QUERY_COUNT }, async () => {
            const start = performance.now();
            await idbPool.query(SQL_STANDARD);
            idbTimes.push(performance.now() - start);
          }),
        );
        const idbWallClock = performance.now() - idbWallStart;

        // Mapepire concurrent via native pool (multiplexed)
        const mapTimes: number[] = [];
        const mapWallStart = performance.now();
        await Promise.all(
          Array.from({ length: QUERY_COUNT }, async () => {
            const start = performance.now();
            await mapPool.execute(SQL_STANDARD);
            mapTimes.push(performance.now() - start);
          }),
        );
        const mapWallClock = performance.now() - mapWallStart;

        printComparison(
          'Promise.all (concurrent burst)',
          calcStats({ times: idbTimes, wallClock: idbWallClock }),
          calcStats({ times: mapTimes, wallClock: mapWallClock }),
        );
      } finally {
        await idbPool.close();
        mapPool.end();
      }
    });
  });

  // -------------------------------------------------------------------
  // Scaling test — increase concurrency to stress multiplexing
  // -------------------------------------------------------------------
  describe('High concurrency burst', () => {
    it('compares throughput at higher concurrency (QUERY_COUNT * 2)', async () => {
      const highCount = QUERY_COUNT * 2;

      // --- idb via RmPool ---
      const idbOpts: PoolOptions = {
        backend: 'idb',
        logLevel: 'none',
        maxSize: POOL_SIZE,
        initialConnections: { size: POOL_SIZE },
      };
      const idbPool = new RmPool({ id: 'idb-native', config: { id: 'idb-native', PoolOptions: idbOpts } }, 'none');
      await idbPool.init();

      // --- Native Mapepire pool ---
      const mapPool = new MapepirePool({
        creds: MAPEPIRE_CREDS,
        maxSize: POOL_SIZE,
        startingSize: POOL_SIZE,
      });
      await mapPool.init();

      try {
        // Warm-up
        for (let i = 0; i < WARMUP_COUNT; i++) {
          await idbPool.query(SQL_STANDARD);
          await mapPool.execute(SQL_STANDARD);
        }

        // idb concurrent
        const idbTimes: number[] = [];
        const idbWallStart = performance.now();
        await Promise.all(
          Array.from({ length: highCount }, async () => {
            const start = performance.now();
            await idbPool.query(SQL_STANDARD);
            idbTimes.push(performance.now() - start);
          }),
        );
        const idbWallClock = performance.now() - idbWallStart;

        // Mapepire concurrent
        const mapTimes: number[] = [];
        const mapWallStart = performance.now();
        await Promise.all(
          Array.from({ length: highCount }, async () => {
            const start = performance.now();
            await mapPool.execute(SQL_STANDARD);
            mapTimes.push(performance.now() - start);
          }),
        );
        const mapWallClock = performance.now() - mapWallStart;

        printComparison(
          `High concurrency burst (${highCount} queries)`,
          calcStats({ times: idbTimes, wallClock: idbWallClock }),
          calcStats({ times: mapTimes, wallClock: mapWallClock }),
        );
      } finally {
        await idbPool.close();
        mapPool.end();
      }
    });
  });
});

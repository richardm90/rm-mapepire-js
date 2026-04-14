/**
 * Remote Mapepire Pool Comparison: Native vs rm-connector-js
 *
 * This test compares native Mapepire pool performance (with multiplexing)
 * against Mapepire accessed through rm-connector-js's RmPool (serialized,
 * one-at-a-time per connection).
 *
 * Designed to be run from a REMOTE machine (e.g., local dev PC) pointing
 * at an IBM i, where real network latency exists. This is the scenario
 * where multiplexing should provide the most benefit.
 *
 * Run with: IBMI_HOST=myibmi.com IBMI_USER=MYUSER IBMI_PASSWORD=MYPASS npx jest --config jest.perf.config.js remote-mapepire-pool
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

function printComparison(label: string, rmStats: Stats, nativeStats: Stats): void {
  println('');
  println(`  ┌─────────────────────────────────────────────────────────────────┐`);
  println(`  │ ${label.padEnd(63)} │`);
  println(`  ├──────────────────┬──────────────────┬──────────────────┬────────┤`);
  println(`  │ Metric           │ rm-connector-js  │ native mapepire  │ Ratio  │`);
  println(`  ├──────────────────┼──────────────────┼──────────────────┼────────┤`);

  const rows: [string, number, number][] = [
    ['Min', rmStats.min, nativeStats.min],
    ['Max', rmStats.max, nativeStats.max],
    ['Avg', rmStats.avg, nativeStats.avg],
    ['Median', rmStats.median, nativeStats.median],
    ['Total (sum)', rmStats.total, nativeStats.total],
    ['Wall clock', rmStats.wallClock, nativeStats.wallClock],
  ];

  for (const [metric, rm, native] of rows) {
    const r = rm / native;
    const ratioStr = r > 1 ? `${r.toFixed(1)}x` : `${(1 / r).toFixed(1)}x`;
    println(
      `  │ ${metric.padEnd(16)} │ ${formatMs(rm).padStart(16)} │ ${formatMs(native).padStart(16)} │ ${ratioStr.padStart(6)} │`,
    );
  }

  println(`  └──────────────────┴──────────────────┴──────────────────┴────────┘`);
  println(`  Queries: ${rmStats.count}, Warm-up: ${WARMUP_COUNT}, Pool size: ${POOL_SIZE}`);
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const skip = !process.env.IBMI_HOST || !process.env.IBMI_USER || !process.env.IBMI_PASSWORD;
const describeIf = skip ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIf('Remote Mapepire: Native Pool vs rm-connector-js Pool', () => {
  jest.setTimeout(120_000);

  // -------------------------------------------------------------------
  // Sequential — both use one-at-a-time semantics
  // -------------------------------------------------------------------
  describe('Sequential', () => {
    it('compares sequential query throughput', async () => {
      // --- rm-connector-js mapepire pool ---
      const rmOpts: PoolOptions = {
        backend: 'mapepire',
        creds: MAPEPIRE_CREDS,
        logLevel: 'none',
        maxSize: POOL_SIZE,
        initialConnections: { size: POOL_SIZE },
      };
      const rmPool = new RmPool({ id: 'rm-map', config: { id: 'rm-map', PoolOptions: rmOpts } }, 'none');
      await rmPool.init();

      // --- Native Mapepire pool ---
      const nativePool = new MapepirePool({
        creds: MAPEPIRE_CREDS,
        maxSize: POOL_SIZE,
        startingSize: POOL_SIZE,
      });
      await nativePool.init();

      try {
        // Warm-up both
        for (let i = 0; i < WARMUP_COUNT; i++) {
          await rmPool.query(SQL_STANDARD);
          await nativePool.execute(SQL_STANDARD);
        }

        // rm-connector-js sequential
        const rmTimes: number[] = [];
        const rmWallStart = performance.now();
        for (let i = 0; i < QUERY_COUNT; i++) {
          const start = performance.now();
          await rmPool.query(SQL_STANDARD);
          rmTimes.push(performance.now() - start);
        }
        const rmWallClock = performance.now() - rmWallStart;

        // Native mapepire sequential
        const nativeTimes: number[] = [];
        const nativeWallStart = performance.now();
        for (let i = 0; i < QUERY_COUNT; i++) {
          const start = performance.now();
          await nativePool.execute(SQL_STANDARD);
          nativeTimes.push(performance.now() - start);
        }
        const nativeWallClock = performance.now() - nativeWallStart;

        printComparison(
          'Sequential',
          calcStats({ times: rmTimes, wallClock: rmWallClock }),
          calcStats({ times: nativeTimes, wallClock: nativeWallClock }),
        );
      } finally {
        await rmPool.close();
        nativePool.end();
      }
    });
  });

  // -------------------------------------------------------------------
  // Promise.all — serialized RmPool vs multiplexed native pool
  // -------------------------------------------------------------------
  describe('Promise.all (concurrent burst)', () => {
    it('compares concurrent throughput — serialized vs multiplexed', async () => {
      // --- rm-connector-js mapepire pool (serialized) ---
      const rmOpts: PoolOptions = {
        backend: 'mapepire',
        creds: MAPEPIRE_CREDS,
        logLevel: 'none',
        maxSize: POOL_SIZE,
        initialConnections: { size: POOL_SIZE },
      };
      const rmPool = new RmPool({ id: 'rm-map', config: { id: 'rm-map', PoolOptions: rmOpts } }, 'none');
      await rmPool.init();

      // --- Native Mapepire pool (multiplexed) ---
      const nativePool = new MapepirePool({
        creds: MAPEPIRE_CREDS,
        maxSize: POOL_SIZE,
        startingSize: POOL_SIZE,
      });
      await nativePool.init();

      try {
        // Warm-up both
        for (let i = 0; i < WARMUP_COUNT; i++) {
          await rmPool.query(SQL_STANDARD);
          await nativePool.execute(SQL_STANDARD);
        }

        // rm-connector-js concurrent (serialized per connection)
        const rmTimes: number[] = [];
        const rmWallStart = performance.now();
        await Promise.all(
          Array.from({ length: QUERY_COUNT }, async () => {
            const start = performance.now();
            await rmPool.query(SQL_STANDARD);
            rmTimes.push(performance.now() - start);
          }),
        );
        const rmWallClock = performance.now() - rmWallStart;

        // Native mapepire concurrent (multiplexed)
        const nativeTimes: number[] = [];
        const nativeWallStart = performance.now();
        await Promise.all(
          Array.from({ length: QUERY_COUNT }, async () => {
            const start = performance.now();
            await nativePool.execute(SQL_STANDARD);
            nativeTimes.push(performance.now() - start);
          }),
        );
        const nativeWallClock = performance.now() - nativeWallStart;

        printComparison(
          'Promise.all (concurrent burst)',
          calcStats({ times: rmTimes, wallClock: rmWallClock }),
          calcStats({ times: nativeTimes, wallClock: nativeWallClock }),
        );
      } finally {
        await rmPool.close();
        nativePool.end();
      }
    });
  });

  // -------------------------------------------------------------------
  // High concurrency — push multiplexing harder
  // -------------------------------------------------------------------
  describe('High concurrency burst', () => {
    it('compares throughput at higher concurrency (QUERY_COUNT * 2)', async () => {
      const highCount = QUERY_COUNT * 2;

      // --- rm-connector-js mapepire pool ---
      const rmOpts: PoolOptions = {
        backend: 'mapepire',
        creds: MAPEPIRE_CREDS,
        logLevel: 'none',
        maxSize: POOL_SIZE,
        initialConnections: { size: POOL_SIZE },
      };
      const rmPool = new RmPool({ id: 'rm-map', config: { id: 'rm-map', PoolOptions: rmOpts } }, 'none');
      await rmPool.init();

      // --- Native Mapepire pool ---
      const nativePool = new MapepirePool({
        creds: MAPEPIRE_CREDS,
        maxSize: POOL_SIZE,
        startingSize: POOL_SIZE,
      });
      await nativePool.init();

      try {
        // Warm-up
        for (let i = 0; i < WARMUP_COUNT; i++) {
          await rmPool.query(SQL_STANDARD);
          await nativePool.execute(SQL_STANDARD);
        }

        // rm-connector-js concurrent
        const rmTimes: number[] = [];
        const rmWallStart = performance.now();
        await Promise.all(
          Array.from({ length: highCount }, async () => {
            const start = performance.now();
            await rmPool.query(SQL_STANDARD);
            rmTimes.push(performance.now() - start);
          }),
        );
        const rmWallClock = performance.now() - rmWallStart;

        // Native mapepire concurrent
        const nativeTimes: number[] = [];
        const nativeWallStart = performance.now();
        await Promise.all(
          Array.from({ length: highCount }, async () => {
            const start = performance.now();
            await nativePool.execute(SQL_STANDARD);
            nativeTimes.push(performance.now() - start);
          }),
        );
        const nativeWallClock = performance.now() - nativeWallStart;

        printComparison(
          `High concurrency burst (${highCount} queries)`,
          calcStats({ times: rmTimes, wallClock: rmWallClock }),
          calcStats({ times: nativeTimes, wallClock: nativeWallClock }),
        );
      } finally {
        await rmPool.close();
        nativePool.end();
      }
    });
  });
});

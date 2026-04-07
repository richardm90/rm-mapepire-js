/**
 * Pool Contention Proof
 *
 * These tests prove that the Promise.all pool performance tests depend on
 * health checks slowing down _attach() enough for earlier queries to complete
 * and release their connections.
 *
 * Run with: IBMI_HOST=... IBMI_USER=... IBMI_PASSWORD=... npx jest --config jest.perf.config.js pool-contention-proof
 */

import RmPool from '../../src/rmPool';
import { PoolOptions } from '../../src/types';

const skip = !process.env.IBMI_HOST || !process.env.IBMI_USER || !process.env.IBMI_PASSWORD;
const describeIf = skip ? describe.skip : describe;

describeIf('Pool Contention Proof', () => {
  jest.setTimeout(30_000);

  const POOL_SIZE = 5;
  const CONCURRENT_QUERIES = 10;
  const SQL = 'SELECT * FROM SAMPLE.DEPARTMENT';

  it('health check OFF — should throw when concurrent queries exceed pool size', async () => {
    const opts: PoolOptions = {
      backend: 'idb',
      logLevel: 'none',
      maxSize: POOL_SIZE,
      initialConnections: { size: POOL_SIZE },
      healthCheck: { onAttach: false },
    };

    const pool = new RmPool({ id: 'proof-no-hc', config: { id: 'proof-no-hc', PoolOptions: opts } }, 'none');
    await pool.init();

    // Use allSettled so in-flight queries complete before we close the pool
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_QUERIES }, () => pool.query(SQL)),
    );

    const failures = results.filter(r => r.status === 'rejected');
    const successes = results.filter(r => r.status === 'fulfilled');

    // Some should succeed (got a connection) and some should fail (pool exhausted)
    expect(successes.length).toBeGreaterThan(0);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every(r =>
      (r as PromiseRejectedResult).reason.message.match(/Maximum number of connections/),
    )).toBe(true);

    await pool.close();
  });

  it('health check ON — should succeed because attach is slowed by health check', async () => {
    const opts: PoolOptions = {
      backend: 'idb',
      logLevel: 'none',
      maxSize: POOL_SIZE,
      initialConnections: { size: POOL_SIZE },
      healthCheck: { onAttach: true },
    };

    const pool = new RmPool({ id: 'proof-hc', config: { id: 'proof-hc', PoolOptions: opts } }, 'none');
    await pool.init();

    try {
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_QUERIES }, () => pool.query(SQL)),
      );

      // All queries should succeed
      expect(results).toHaveLength(CONCURRENT_QUERIES);
      results.forEach(r => expect(r.success).toBe(true));
    } finally {
      await pool.close();
    }
  });
});

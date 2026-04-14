import './setup';
import RmPool from '../src/rmPool';
import RmConnection from '../src/rmConnection';
import { SQLJob } from '@ibm/mapepire-js';

describe('multiplex mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('RmConnection', () => {
    it('throws when multiplex is enabled with the idb backend', async () => {
      const conn = new RmConnection({
        creds: { host: 'h', user: 'u', password: 'p' },
        backend: 'idb',
        multiplex: true,
      });
      await expect(conn.init(true)).rejects.toThrow(/multiplex.*idb/);
    });

    it('initialises normally with multiplex + mapepire backend', async () => {
      const conn = new RmConnection({
        creds: { host: 'h', user: 'u', password: 'p' },
        backend: 'mapepire',
        multiplex: true,
      });
      await conn.init(true);
      expect(conn.multiplex).toBe(true);
      await conn.close();
    });
  });

  describe('RmPool', () => {
    const baseConfig = {
      id: 'mux-pool',
      config: {
        id: 'mux-pool',
        PoolOptions: {
          creds: { host: 'h', user: 'u', password: 'p' },
          backend: 'mapepire' as const,
          multiplex: true,
          maxSize: 4,
          initialConnections: { size: 2, expiry: null },
          incrementConnections: { size: 1, expiry: null },
        },
      },
    };

    it('rejects multiplex + idb at construction time', () => {
      expect(() => new RmPool({
        id: 'bad',
        config: {
          id: 'bad',
          PoolOptions: {
            creds: { host: 'h', user: 'u', password: 'p' },
            backend: 'idb',
            multiplex: true,
          },
        },
      })).toThrow(/multiplex.*idb/);
    });

    it('round-robins across connections without claiming exclusivity', async () => {
      const pool = new RmPool(baseConfig);
      await pool.init();

      const a = await pool.attach();
      const b = await pool.attach();
      const c = await pool.attach();
      const d = await pool.attach();

      expect(a.poolIndex).toBe(1);
      expect(b.poolIndex).toBe(2);
      expect(c.poolIndex).toBe(1);
      expect(d.poolIndex).toBe(2);

      // Connections are never marked unavailable in multiplex mode.
      expect(pool.connections.every(c => c.isAvailable())).toBe(true);

      await pool.close();
    });

    it('detach is a no-op in multiplex mode', async () => {
      const pool = new RmPool(baseConfig);
      await pool.init();
      const conn = await pool.attach();
      expect(conn.isAvailable()).toBe(true);
      await pool.detach(conn);
      // Still available, no expiry timer scheduled.
      expect(conn.isAvailable()).toBe(true);
      expect(conn.expiryTimerId).toBeNull();
      await pool.close();
    });

    it('runs N concurrent queries through a pool of 1 sharing one job', async () => {
      // Make execute slow enough that all queries overlap.
      const realExecute = SQLJob.prototype.execute;
      let peak = 0;
      let live = 0;
      (SQLJob.prototype as any).execute = async function (sql: string) {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise(r => setTimeout(r, 25));
        live -= 1;
        return { success: true, data: [{ sql }], metadata: {} };
      };

      try {
        const pool = new RmPool({
          id: 'mux-1',
          config: {
            id: 'mux-1',
            PoolOptions: {
              creds: { host: 'h', user: 'u', password: 'p' },
              backend: 'mapepire',
              multiplex: true,
              maxSize: 1,
              initialConnections: { size: 1, expiry: null },
            },
          },
        });
        await pool.init();

        const N = 8;
        const results = await Promise.all(
          Array.from({ length: N }, (_, i) => pool.query(`SELECT ${i}`))
        );

        expect(results).toHaveLength(N);
        expect(pool.connections).toHaveLength(1);
        expect(peak).toBe(N);
        // All results came from the same shared job.
        const jobs = new Set(results.map(r => r.job));
        expect(jobs.size).toBe(1);

        await pool.close();
      } finally {
        SQLJob.prototype.execute = realExecute;
      }
    });

    it('exposes inFlight in connection info', async () => {
      const pool = new RmPool(baseConfig);
      await pool.init();
      const info = pool.connections[0].getInfo() as any;
      expect(info.multiplex).toBe(true);
      expect(info.inFlight).toBe(0);
      await pool.close();
    });
  });
});

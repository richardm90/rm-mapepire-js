import rmPoolConnection from '../src/rmPoolConnection';
import rmPool from '../src/rmPool';
import { rmPools } from '../src/rmPools';
import { PoolConfig } from '../src/types';

jest.mock('@ibm/mapepire-js');

describe('Debug and Info Methods', () => {
  const mockPoolConfig: PoolConfig = {
    id: 'test-pool',
    PoolOptions: {
      creds: {
        host: 'test-host',
        user: 'test-user',
        password: 'test-password',
      },
      maxSize: 10,
      initialConnections: {
        size: 2,
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rmPoolConnection debug methods', () => {
    it('should return connection info', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      await connection.init(1);

      const info = connection.getInfo() as any;

      expect(info).toHaveProperty('poolId', 'test-pool');
      expect(info).toHaveProperty('poolIndex', 1);
      expect(info).toHaveProperty('jobName');
      expect(info).toHaveProperty('available', false);
      expect(info).toHaveProperty('status');
      expect(info).toHaveProperty('hasExpiryTimer', false);
      expect(info).toHaveProperty('expiry');
    });

    it('should print connection info without errors', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      await connection.init(1);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      connection.printInfo();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('rmPool debug methods', () => {
    it('should return pool info', async () => {
      const pool = new rmPool({ id: 'test-pool', config: mockPoolConfig });
      await pool.init();

      const info = pool.getInfo() as any;

      expect(info).toHaveProperty('id', 'test-pool');
      expect(info).toHaveProperty('totalConnections', 2);
      expect(info).toHaveProperty('availableConnections');
      expect(info).toHaveProperty('busyConnections');
      expect(info).toHaveProperty('maxSize', 10);
      expect(info).toHaveProperty('connections');
      expect(Array.isArray(info.connections)).toBe(true);
      expect(info.connections.length).toBe(2);
    });

    it('should return pool stats', async () => {
      const pool = new rmPool({ id: 'test-pool', config: mockPoolConfig });
      await pool.init();

      const stats = pool.getStats() as any;

      expect(stats).toHaveProperty('id', 'test-pool');
      expect(stats).toHaveProperty('total', 2);
      expect(stats).toHaveProperty('available');
      expect(stats).toHaveProperty('busy');
      expect(stats).toHaveProperty('maxSize', 10);
      expect(stats).toHaveProperty('utilizationPercent');
      expect(typeof stats.utilizationPercent).toBe('string');
    });

    it('should calculate utilization correctly', async () => {
      const pool = new rmPool({ id: 'test-pool', config: mockPoolConfig });
      await pool.init();

      const stats = pool.getStats() as any;

      // 0 busy connections out of 2 total connections = 0%
      expect(stats.utilizationPercent).toBe('0.0');
    });

    it('should track available vs busy connections', async () => {
      const pool = new rmPool({ id: 'test-pool', config: mockPoolConfig });
      await pool.init();

      // Initially all should be available
      let stats = pool.getStats() as any;
      expect(stats.available).toBe(2);
      expect(stats.busy).toBe(0);

      // Attach one connection (make it busy)
      const conn = await pool.attach();

      stats = pool.getStats() as any;
      expect(stats.available).toBe(1);
      expect(stats.busy).toBe(1);

      // Detach it
      await pool.detach(conn);

      stats = pool.getStats() as any;
      expect(stats.available).toBe(2);
      expect(stats.busy).toBe(0);
    });

    it('should print pool info without errors', async () => {
      const pool = new rmPool({ id: 'test-pool', config: mockPoolConfig });
      await pool.init();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      pool.printInfo();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should print pool stats without errors', async () => {
      const pool = new rmPool({ id: 'test-pool', config: mockPoolConfig });
      await pool.init();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      pool.printStats();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('rmPools debug methods', () => {
    it('should return pools info', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [mockPoolConfig],
      });

      await pools.init();

      const info = pools.getInfo() as any;

      expect(info).toHaveProperty('totalPools', 1);
      expect(info).toHaveProperty('activePools', 1);
      expect(info).toHaveProperty('pools');
      expect(Array.isArray(info.pools)).toBe(true);
      expect(info.pools[0]).toHaveProperty('id', 'test-pool');
      expect(info.pools[0]).toHaveProperty('active', true);
    });

    it('should include pool stats in pools info', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [mockPoolConfig],
      });

      await pools.init();

      const info = pools.getInfo() as any;

      expect(info.pools[0]).toHaveProperty('total');
      expect(info.pools[0]).toHaveProperty('available');
      expect(info.pools[0]).toHaveProperty('busy');
      expect(info.pools[0]).toHaveProperty('maxSize');
    });

    it('should print pools info without errors', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [mockPoolConfig],
      });

      await pools.init();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      pools.printInfo();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should print pools stats without errors', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [mockPoolConfig],
      });

      await pools.init();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      pools.printStats();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle multiple pools correctly', async () => {
      const poolConfig2: PoolConfig = {
        id: 'test-pool-2',
        PoolOptions: {
          creds: {
            host: 'test-host-2',
            user: 'test-user-2',
            password: 'test-password-2',
          },
          initialConnections: {
            size: 3,
          },
        },
      };

      const pools = new rmPools({
        activate: true,
        pools: [mockPoolConfig, poolConfig2],
      });

      await pools.init();

      const info = pools.getInfo() as any;

      expect(info.totalPools).toBe(2);
      expect(info.activePools).toBe(2);
      expect(info.pools.length).toBe(2);
    });

    it('should show inactive pools', async () => {
      const pools = new rmPools({
        activate: false,
        pools: [mockPoolConfig],
      });

      await pools.init();

      const info = pools.getInfo() as any;

      expect(info.totalPools).toBe(1);
      expect(info.activePools).toBe(0);
      expect(info.pools[0].active).toBe(false);
    });
  });
});
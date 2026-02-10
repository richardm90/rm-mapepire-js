import './setup';
import { RmPools } from '../src/rmPools';
import RmPool from '../src/rmPool';
import { PoolConfig } from '../src/types';

describe('RmPools', () => {
  const mockPoolConfig: PoolConfig = {
    id: 'test-pool-1',
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

  const mockPoolConfig2: PoolConfig = {
    id: 'test-pool-2',
    PoolOptions: {
      creds: {
        host: 'test-host-2',
        user: 'test-user-2',
        password: 'test-password-2',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a new RmPools instance', () => {
      const pools = new RmPools();

      expect(pools).toBeInstanceOf(RmPools);
      expect(pools.pools).toEqual([]);
      expect(pools.activate).toBe(true);
      expect(pools.debug).toBe(false);
    });

    it('should accept configuration options', () => {
      const pools = new RmPools({
        activate: false,
        debug: true,
      });

      expect(pools.activate).toBe(false);
      expect(pools.debug).toBe(true);
    });
  });

  describe('register', () => {
    it('should register a new pool', async () => {
      const pools = new RmPools({ activate: false });

      const result = await pools.register(mockPoolConfig);

      expect(result).toBe(true);
      expect(pools.pools.length).toBe(1);
      expect(pools.pools[0].id).toBe('test-pool-1');
    });

    it('should not register duplicate pool IDs', async () => {
      const pools = new RmPools({ activate: false });

      await pools.register(mockPoolConfig);
      const result = await pools.register(mockPoolConfig);

      expect(result).toBe(false);
      expect(pools.pools.length).toBe(1);
    });

    it('should activate pool if activate is true', async () => {
      const pools = new RmPools({ activate: true });

      await pools.register(mockPoolConfig);

      expect(pools.pools[0].active).toBe(true);
      expect(pools.pools[0].rmPool).toBeInstanceOf(RmPool);
    });

    it('should not exceed maximum number of pools', async () => {
      const pools = new RmPools({ activate: false });

      // Register 8 pools (MAX_POOLS)
      for (let i = 0; i < 8; i++) {
        const result = await pools.register({
          ...mockPoolConfig,
          id: `pool-${i}`,
        });
        expect(result).toBe(true);
      }

      // 9th pool should fail
      const result = await pools.register({
        ...mockPoolConfig,
        id: 'pool-9',
      });

      expect(result).toBe(false);
    });
  });

  describe('init', () => {
    it('should initialize all configured pools', async () => {
      const pools = new RmPools({
        activate: false,
        pools: [mockPoolConfig, mockPoolConfig2],
      });

      await pools.init();

      expect(pools.pools.length).toBe(2);
      expect(pools.pools[0].id).toBe('test-pool-1');
      expect(pools.pools[1].id).toBe('test-pool-2');
    });
  });

  describe('get', () => {
    it('should get a pool by ID', async () => {
      const pools = new RmPools({ activate: false });
      await pools.register(mockPoolConfig);
      await pools.register(mockPoolConfig2);

      const pool = await pools.get('test-pool-2');

      expect(pool).toBeInstanceOf(RmPool);
      expect(pool?.id).toBe('test-pool-2');
    });

    it('should return first pool if no ID provided', async () => {
      const pools = new RmPools({ activate: false });
      await pools.register(mockPoolConfig);
      await pools.register(mockPoolConfig2);

      const pool = await pools.get();

      expect(pool).toBeInstanceOf(RmPool);
      expect(pool?.id).toBe('test-pool-1');
    });

    it('should return null if pool not found', async () => {
      const pools = new RmPools({ activate: false });
      await pools.register(mockPoolConfig);

      const pool = await pools.get('non-existent');

      expect(pool).toBeNull();
    });

    it('should return null if no pools registered', async () => {
      const pools = new RmPools({ activate: false });

      const pool = await pools.get('any-id');

      expect(pool).toBeNull();
    });

    it('should activate pool if not already active', async () => {
      const pools = new RmPools({ activate: false });
      await pools.register(mockPoolConfig);

      expect(pools.pools[0].active).toBe(false);

      await pools.get('test-pool-1');

      expect(pools.pools[0].active).toBe(true);
    });
  });

  describe('sanitizePoolId', () => {
    it('should return first pool ID if no ID provided', async () => {
      const pools = new RmPools({ activate: false });
      await pools.register(mockPoolConfig);

      const sanitized = pools.sanitizePoolId();

      expect(sanitized).toBe('test-pool-1');
    });

    it('should return provided ID unchanged', async () => {
      const pools = new RmPools({ activate: false });
      await pools.register(mockPoolConfig);

      const sanitized = pools.sanitizePoolId('custom-id');

      expect(sanitized).toBe('custom-id');
    });

    it('should return undefined if no pools and no ID', () => {
      const pools = new RmPools({ activate: false });

      const sanitized = pools.sanitizePoolId();

      expect(sanitized).toBeUndefined();
    });
  });

  describe('attach', () => {
    it('should attach a connection from a pool', async () => {
      const pools = new RmPools({ activate: true });
      await pools.register(mockPoolConfig);

      const pool = await pools.get('test-pool-1');
      const connection = await pools.attach(pool!);

      expect(connection).toBeDefined();
      expect(connection.poolId).toBe('test-pool-1');
    });
  });

  describe('close', () => {
    it('should close all active pools', async () => {
      const pools = new RmPools({ activate: true });
      await pools.register(mockPoolConfig);
      await pools.register(mockPoolConfig2);

      expect(pools.pools[0].active).toBe(true);
      expect(pools.pools[1].active).toBe(true);

      const result = await pools.close();

      expect(result).toBe(true);
      expect(pools.pools[0].active).toBe(false);
      expect(pools.pools[1].active).toBe(false);
    });

    it('should retire all connections in each pool', async () => {
      const pools = new RmPools({ activate: true });
      await pools.register(mockPoolConfig);

      const pool = pools.pools[0].rmPool!;
      expect(pool.connections.length).toBe(2);

      await pools.close();

      expect(pool.connections.length).toBe(0);
    });

    it('should skip inactive pools', async () => {
      const pools = new RmPools({ activate: false });
      await pools.register(mockPoolConfig);

      expect(pools.pools[0].active).toBe(false);

      const result = await pools.close();

      expect(result).toBe(true);
      expect(pools.pools[0].active).toBe(false);
    });

    it('should succeed when no pools are registered', async () => {
      const pools = new RmPools();

      const result = await pools.close();

      expect(result).toBe(true);
    });
  });

  describe('logger injection', () => {
    it('should use custom logger when provided', async () => {
      const customLogger = { log: jest.fn() };
      const pools = new RmPools({
        activate: true,
        debug: true,
        logger: customLogger,
        pools: [mockPoolConfig],
      });

      await pools.init();

      expect(customLogger.log).toHaveBeenCalled();
      expect(customLogger.log.mock.calls.some(
        (call: any[]) => call[2]?.service === 'RmPools'
      )).toBe(true);
    });

    it('should pass custom logger down to RmPool', async () => {
      const customLogger = { log: jest.fn() };
      const pools = new RmPools({
        activate: true,
        debug: true,
        logger: customLogger,
        pools: [mockPoolConfig],
      });

      await pools.init();

      // RmPool should have logged via the custom logger
      expect(customLogger.log.mock.calls.some(
        (call: any[]) => call[2]?.service === 'RmPool'
      )).toBe(true);
    });

    it('should pass custom logger down to RmPoolConnection', async () => {
      const customLogger = { log: jest.fn() };
      const pools = new RmPools({
        activate: true,
        debug: true,
        logger: customLogger,
        pools: [mockPoolConfig],
      });

      await pools.init();

      // RmPoolConnection should have logged via the custom logger
      expect(customLogger.log.mock.calls.some(
        (call: any[]) => call[2]?.service === 'RmPoolConnection'
      )).toBe(true);
    });

    it('should use default logger when none provided', () => {
      const pools = new RmPools({ activate: false });
      // Should not throw — uses built-in console logger
      expect(pools.logger).toBeDefined();
    });
  });

  describe('connectionDiag', () => {
    it('should log connection diagnostics', async () => {
      const pools = new RmPools({ activate: true, debug: true });
      await pools.register(mockPoolConfig);

      const pool = await pools.get('test-pool-1');
      const connection = await pool!.attach();

      await pools.connectionDiag('test-pool-1', connection, 'SELECT * FROM TEST');

      // Should not throw
      expect(true).toBe(true);
    });
  });
});

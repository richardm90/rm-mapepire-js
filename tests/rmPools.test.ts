import './setup';
import { rmPools } from '../src/rmPools';
import rmPool from '../src/rmPool';
import { PoolConfig } from '../src/types';

describe('rmPools', () => {
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
    it('should create a new rmPools instance', () => {
      const pools = new rmPools();

      expect(pools).toBeInstanceOf(rmPools);
      expect(pools.pools).toEqual([]);
      expect(pools.activate).toBe(true);
      expect(pools.debug).toBe(false);
    });

    it('should accept configuration options', () => {
      const pools = new rmPools({
        activate: false,
        debug: true,
      });

      expect(pools.activate).toBe(false);
      expect(pools.debug).toBe(true);
    });
  });

  describe('register', () => {
    it('should register a new pool', async () => {
      const pools = new rmPools({ activate: false });

      const result = await pools.register(mockPoolConfig);

      expect(result).toBe(true);
      expect(pools.pools.length).toBe(1);
      expect(pools.pools[0].id).toBe('test-pool-1');
    });

    it('should not register duplicate pool IDs', async () => {
      const pools = new rmPools({ activate: false });

      await pools.register(mockPoolConfig);
      const result = await pools.register(mockPoolConfig);

      expect(result).toBe(false);
      expect(pools.pools.length).toBe(1);
    });

    it('should activate pool if activate is true', async () => {
      const pools = new rmPools({ activate: true });

      await pools.register(mockPoolConfig);

      expect(pools.pools[0].active).toBe(true);
      expect(pools.pools[0].rmPool).toBeInstanceOf(rmPool);
    });

    it('should not exceed maximum number of pools', async () => {
      const pools = new rmPools({ activate: false });

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
      const pools = new rmPools({
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
      const pools = new rmPools({ activate: false });
      await pools.register(mockPoolConfig);
      await pools.register(mockPoolConfig2);

      const pool = await pools.get('test-pool-2');

      expect(pool).toBeInstanceOf(rmPool);
      expect(pool?.id).toBe('test-pool-2');
    });

    it('should return first pool if no ID provided', async () => {
      const pools = new rmPools({ activate: false });
      await pools.register(mockPoolConfig);
      await pools.register(mockPoolConfig2);

      const pool = await pools.get();

      expect(pool).toBeInstanceOf(rmPool);
      expect(pool?.id).toBe('test-pool-1');
    });

    it('should return null if pool not found', async () => {
      const pools = new rmPools({ activate: false });
      await pools.register(mockPoolConfig);

      const pool = await pools.get('non-existent');

      expect(pool).toBeNull();
    });

    it('should return null if no pools registered', async () => {
      const pools = new rmPools({ activate: false });

      const pool = await pools.get('any-id');

      expect(pool).toBeNull();
    });

    it('should activate pool if not already active', async () => {
      const pools = new rmPools({ activate: false });
      await pools.register(mockPoolConfig);

      expect(pools.pools[0].active).toBe(false);

      await pools.get('test-pool-1');

      expect(pools.pools[0].active).toBe(true);
    });
  });

  describe('sanitizePoolId', () => {
    it('should return first pool ID if no ID provided', async () => {
      const pools = new rmPools({ activate: false });
      await pools.register(mockPoolConfig);

      const sanitized = pools.sanitizePoolId();

      expect(sanitized).toBe('test-pool-1');
    });

    it('should return provided ID unchanged', async () => {
      const pools = new rmPools({ activate: false });
      await pools.register(mockPoolConfig);

      const sanitized = pools.sanitizePoolId('custom-id');

      expect(sanitized).toBe('custom-id');
    });

    it('should return undefined if no pools and no ID', () => {
      const pools = new rmPools({ activate: false });

      const sanitized = pools.sanitizePoolId();

      expect(sanitized).toBeUndefined();
    });
  });

  describe('attach', () => {
    it('should attach a connection from a pool', async () => {
      const pools = new rmPools({ activate: true });
      await pools.register(mockPoolConfig);

      const pool = await pools.get('test-pool-1');
      const connection = await pools.attach(pool!);

      expect(connection).toBeDefined();
      expect(connection.poolId).toBe('test-pool-1');
    });
  });

  describe('connectionDiag', () => {
    it('should log connection diagnostics', async () => {
      const pools = new rmPools({ activate: true, debug: true });
      await pools.register(mockPoolConfig);

      const pool = await pools.get('test-pool-1');
      const connection = await pool!.attach();

      await pools.connectionDiag('test-pool-1', connection, 'SELECT * FROM TEST');

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
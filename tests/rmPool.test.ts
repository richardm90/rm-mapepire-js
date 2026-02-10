import './setup';
import rmPool from '../src/rmPool';
import rmPoolConnection from '../src/rmPoolConnection';

describe('rmPool', () => {
  const mockConfig = {
    id: 'test-pool',
    config: {
      id: 'test-pool',
      PoolOptions: {
        creds: {
          host: 'test-host',
          user: 'test-user',
          password: 'test-password',
        },
        maxSize: 5,
        initialConnections: {
          size: 2,
          expiry: null,
        },
        incrementConnections: {
          size: 1,
          expiry: null,
        },
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a new rmPool instance', () => {
      const pool = new rmPool(mockConfig);

      expect(pool).toBeInstanceOf(rmPool);
      expect(pool.id).toBe('test-pool');
      expect(pool.connections).toEqual([]);
      expect(pool.maxSize).toBe(5);
    });

    it('should use default values for optional properties', () => {
      const minimalConfig = {
        id: 'minimal-pool',
        config: {
          id: 'minimal-pool',
          PoolOptions: {
            creds: {
              host: 'test-host',
              user: 'test-user',
              password: 'test-password',
            },
          },
        },
      };

      const pool = new rmPool(minimalConfig);

      expect(pool.maxSize).toBe(20);
      expect(pool.initialConnections.size).toBe(8);
    });
  });

  describe('init', () => {
    it('should create initial connections', async () => {
      const pool = new rmPool(mockConfig);

      await pool.init();

      expect(pool.connections.length).toBe(2);
    });

    it('should make connections available', async () => {
      const pool = new rmPool(mockConfig);

      await pool.init();

      pool.connections.forEach(conn => {
        expect(conn.isAvailable()).toBe(true);
      });
    });
  });

  describe('attach', () => {
    it('should return an available connection', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const connection = await pool.attach();

      expect(connection).toBeInstanceOf(rmPoolConnection);
      expect(connection.isAvailable()).toBe(false);
    });

    it('should create new connections if all are busy', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      // Attach all initial connections
      await pool.attach();
      await pool.attach();

      // This should create a new connection
      const connection = await pool.attach();

      expect(pool.connections.length).toBe(3);
      expect(connection).toBeInstanceOf(rmPoolConnection);
    });

    it('should throw error when max connections reached', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      // Attach all possible connections
      for (let i = 0; i < 5; i++) {
        await pool.attach();
      }

      // Should throw when trying to exceed max
      await expect(pool.attach()).rejects.toThrow('Maximum number of connections');
    });
  });

  describe('detach', () => {
    it('should make connection available again', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const connection = await pool.attach();
      expect(connection.isAvailable()).toBe(false);

      await pool.detach(connection);
      expect(connection.isAvailable()).toBe(true);
    });
  });

  describe('detachAll', () => {
    it('should detach all connections', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      await pool.attach();
      await pool.attach();

      await pool.detachAll();

      pool.connections.forEach(conn => {
        expect(conn.isAvailable()).toBe(true);
      });
    });
  });

  describe('retire', () => {
    it('should remove connection from pool', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const initialLength = pool.connections.length;
      const connection = pool.connections[0];

      await pool.retire(connection);

      expect(pool.connections.length).toBe(initialLength - 1);
    });
  });

  describe('retireAll', () => {
    it('should retire all connections', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      await pool.retireAll();

      expect(pool.connections.length).toBe(0);
    });
  });

  describe('expiry timers', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should set expiry timer for connection', async () => {
      const configWithExpiry = {
        ...mockConfig,
        config: {
          ...mockConfig.config,
          PoolOptions: {
            ...mockConfig.config.PoolOptions,
            initialConnections: {
              size: 1,
              expiry: 1, // 1 minute
            },
          },
        },
      };

      const pool = new rmPool(configWithExpiry);
      await pool.init();

      const connection = pool.connections[0];
      expect(connection.expiryTimerId).not.toBeNull();
    });

    it('should cancel expiry timer', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const connection = pool.connections[0];
      connection.expiryTimerId = setTimeout(() => {}, 1000) as NodeJS.Timeout;

      pool.cancelExpiryTimer(connection);

      expect(connection.expiryTimerId).toBeNull();
    });

    it('should retire connection when expiry timer fires', async () => {
      const configWithExpiry = {
        ...mockConfig,
        config: {
          ...mockConfig.config,
          PoolOptions: {
            ...mockConfig.config.PoolOptions,
            initialConnections: {
              size: 1,
              expiry: 1, // 1 minute
            },
          },
        },
      };

      const pool = new rmPool(configWithExpiry);
      await pool.init();

      expect(pool.connections.length).toBe(1);

      // Advance timers past expiry
      await jest.advanceTimersByTimeAsync(60 * 1000);

      expect(pool.connections.length).toBe(0);
    });

    it('should mark connection unavailable when expired', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const connection = pool.connections[0];
      connection.setAvailable(true);

      await pool.setExpired(connection);

      expect(connection.isAvailable()).toBe(false);
    });
  });
});
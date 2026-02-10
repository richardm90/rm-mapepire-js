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

  describe('attach concurrency', () => {
    it('should not assign the same connection to concurrent callers', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      // Concurrently attach both initial connections
      const [conn1, conn2] = await Promise.all([pool.attach(), pool.attach()]);

      expect(conn1).not.toBe(conn2);
      expect(conn1.isAvailable()).toBe(false);
      expect(conn2.isAvailable()).toBe(false);
    });

    it('should serialize connection creation under contention', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      // Use all initial connections
      await pool.attach();
      await pool.attach();

      // Both callers need new connections — mutex ensures
      // they don't both create the same connection
      const [conn3, conn4] = await Promise.all([pool.attach(), pool.attach()]);

      expect(conn3).not.toBe(conn4);
      expect(pool.connections.length).toBe(4);
    });

    it('should propagate errors without blocking the queue', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      // Exhaust all connections (maxSize = 5)
      for (let i = 0; i < 5; i++) {
        await pool.attach();
      }

      // This should fail — max reached
      await expect(pool.attach()).rejects.toThrow('Maximum number of connections');

      // Detach one and verify the queue still works
      await pool.detach(pool.connections[0]);
      const conn = await pool.attach();
      expect(conn).toBeDefined();
      expect(conn.isAvailable()).toBe(false);
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

    it('should keep stable poolIndex after retire', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      // Initial connections get IDs 1 and 2
      const conn1 = pool.connections[0];
      const conn2 = pool.connections[1];
      expect(conn1.poolIndex).toBe(1);
      expect(conn2.poolIndex).toBe(2);

      // Retire conn1 — conn2 should keep its original ID
      await pool.retire(conn1);
      expect(pool.connections.length).toBe(1);
      expect(pool.connections[0].poolIndex).toBe(2);

      // Attach conn2 so all connections are busy, forcing a new one
      const attached = await pool.attach();
      expect(attached.poolIndex).toBe(2);

      // This attach forces creation of a new connection — should get ID 3
      const conn3 = await pool.attach();
      expect(conn3.poolIndex).toBe(3);
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

  describe('health check on attach', () => {
    it('should retire unhealthy connection and return next healthy one', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      // Make first connection fail health check
      const conn1 = pool.connections[0];
      jest.spyOn(conn1, 'isHealthy').mockResolvedValue(false);

      const attached = await pool.attach();

      // Should have retired conn1 and returned conn2
      expect(attached).toBe(pool.connections[0]);
      expect(attached.poolIndex).toBe(2);
      expect(pool.connections.length).toBe(1);
    });

    it('should create new connection if all existing fail health check', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      // Make both initial connections fail health check
      jest.spyOn(pool.connections[0], 'isHealthy').mockResolvedValue(false);
      jest.spyOn(pool.connections[1], 'isHealthy').mockResolvedValue(false);

      const attached = await pool.attach();

      // Both original connections retired, a new one was created
      expect(attached.poolIndex).toBe(3);
      expect(pool.connections.length).toBe(1);
    });

    it('should skip health check when disabled', async () => {
      const configNoHealthCheck = {
        ...mockConfig,
        config: {
          ...mockConfig.config,
          PoolOptions: {
            ...mockConfig.config.PoolOptions,
            healthCheck: { onAttach: false },
          },
        },
      };

      const pool = new rmPool(configNoHealthCheck);
      await pool.init();

      // Make connection "unhealthy" — but health check is disabled
      const spy = jest.spyOn(pool.connections[0], 'isHealthy').mockResolvedValue(false);

      const attached = await pool.attach();

      // Should return connection without checking health
      expect(spy).not.toHaveBeenCalled();
      expect(attached.poolIndex).toBe(1);
      expect(pool.connections.length).toBe(2);
    });

    it('should default to health check enabled', () => {
      const pool = new rmPool(mockConfig);
      expect(pool.healthCheckOnAttach).toBe(true);
    });
  });

  describe('events', () => {
    it('should emit pool:initialized on init', async () => {
      const pool = new rmPool(mockConfig);
      const handler = jest.fn();
      pool.on('pool:initialized', handler);

      await pool.init();

      expect(handler).toHaveBeenCalledWith({
        poolId: 'test-pool',
        connections: 2,
      });
    });

    it('should emit connection:created for each new connection', async () => {
      const pool = new rmPool(mockConfig);
      const handler = jest.fn();
      pool.on('connection:created', handler);

      await pool.init();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ poolId: 'test-pool', poolIndex: 1 })
      );
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ poolId: 'test-pool', poolIndex: 2 })
      );
    });

    it('should emit connection:attached and connection:detached', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const attachHandler = jest.fn();
      const detachHandler = jest.fn();
      pool.on('connection:attached', attachHandler);
      pool.on('connection:detached', detachHandler);

      const conn = await pool.attach();
      expect(attachHandler).toHaveBeenCalledWith({
        poolId: 'test-pool',
        poolIndex: conn.poolIndex,
      });

      await pool.detach(conn);
      expect(detachHandler).toHaveBeenCalledWith({
        poolId: 'test-pool',
        poolIndex: conn.poolIndex,
      });
    });

    it('should emit connection:retired when a connection is retired', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const handler = jest.fn();
      pool.on('connection:retired', handler);

      const conn = pool.connections[0];
      await pool.retire(conn);

      expect(handler).toHaveBeenCalledWith({
        poolId: 'test-pool',
        poolIndex: 1,
      });
    });

    it('should emit connection:healthCheckFailed when health check fails', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const handler = jest.fn();
      pool.on('connection:healthCheckFailed', handler);

      jest.spyOn(pool.connections[0], 'isHealthy').mockResolvedValue(false);

      await pool.attach();

      expect(handler).toHaveBeenCalledWith({
        poolId: 'test-pool',
        poolIndex: 1,
      });
    });

    it('should emit pool:exhausted when max connections reached', async () => {
      const pool = new rmPool(mockConfig);
      await pool.init();

      const handler = jest.fn();
      pool.on('pool:exhausted', handler);

      // Attach all connections to exhaust the pool
      for (let i = 0; i < pool.maxSize; i++) {
        await pool.attach();
      }

      // Next attach should throw and emit pool:exhausted
      await expect(pool.attach()).rejects.toThrow();

      expect(handler).toHaveBeenCalledWith({
        poolId: 'test-pool',
        maxSize: 5,
      });
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
import './setup';
import { rmPools } from '../src/rmPools';

describe('Integration Tests', () => {
  describe('Full workflow', () => {
    it('should manage multiple pools and connections', async () => {
      // Create pools manager
      const pools = new rmPools({
        debug: false,
        activate: true,
        pools: [
          {
            id: 'primary',
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
          },
          {
            id: 'secondary',
            PoolOptions: {
              creds: {
                host: 'test-host-2',
                user: 'test-user-2',
                password: 'test-password-2',
              },
              maxSize: 5,
              initialConnections: {
                size: 1,
              },
            },
          },
        ],
      });

      // Initialize all pools
      await pools.init();

      // Get primary pool
      const primaryPool = await pools.get('primary');
      expect(primaryPool).toBeDefined();
      expect(primaryPool!.id).toBe('primary');
      expect(primaryPool!.connections.length).toBe(2);

      // Attach connection from primary
      const conn1 = await primaryPool!.attach();
      expect(conn1.isAvailable()).toBe(false);

      // Execute query
      const result = await conn1.query('SELECT * FROM TEST_TABLE');
      expect(result).toBeDefined();

      // Detach connection
      await primaryPool!.detach(conn1);
      expect(conn1.isAvailable()).toBe(true);

      // Get secondary pool
      const secondaryPool = await pools.get('secondary');
      expect(secondaryPool).toBeDefined();
      expect(secondaryPool!.id).toBe('secondary');

      // Attach multiple connections
      const conn2 = await primaryPool!.attach();
      const conn3 = await primaryPool!.attach();

      expect(primaryPool!.connections.length).toBe(2);

      // Detach all
      await primaryPool!.detachAll();

      primaryPool!.connections.forEach(conn => {
        expect(conn.isAvailable()).toBe(true);
      });
    });

    it('should handle pool exhaustion gracefully', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [
          {
            id: 'limited',
            PoolOptions: {
              creds: {
                host: 'test-host',
                user: 'test-user',
                password: 'test-password',
              },
              maxSize: 3,
              initialConnections: {
                size: 2,
              },
              incrementConnections: {
                size: 1,
              },
            },
          },
        ],
      });

      await pools.init();
      const pool = await pools.get('limited');

      // Attach all available connections
      const conn1 = await pool!.attach();
      const conn2 = await pool!.attach();
      const conn3 = await pool!.attach();

      expect(pool!.connections.length).toBe(3);

      // Try to exceed max
      await expect(pool!.attach()).rejects.toThrow();

      // Detach one and try again
      await pool!.detach(conn1);
      const conn4 = await pool!.attach();

      expect(conn4).toBeDefined();
    });

    it('should retire connections properly', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [
          {
            id: 'test',
            PoolOptions: {
              creds: {
                host: 'test-host',
                user: 'test-user',
                password: 'test-password',
              },
              initialConnections: {
                size: 3,
              },
            },
          },
        ],
      });

      await pools.init();
      const pool = await pools.get('test');

      expect(pool!.connections.length).toBe(3);

      // Retire one connection
      const conn = pool!.connections[0];
      await pool!.retire(conn);

      expect(pool!.connections.length).toBe(2);

      // Retire all
      await pool!.retireAll();

      expect(pool!.connections.length).toBe(0);
    });

    it('should execute queries directly on the pool', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [
          {
            id: 'query-test',
            PoolOptions: {
              creds: {
                host: 'test-host',
                user: 'test-user',
                password: 'test-password',
              },
              initialConnections: {
                size: 2,
              },
            },
          },
        ],
      });

      await pools.init();
      const pool = await pools.get('query-test');

      // Verify all connections are available before query
      expect(pool!.connections.every(c => c.isAvailable())).toBe(true);

      // Execute query directly on pool
      const result = await pool!.query('SELECT * FROM TEST_TABLE');
      expect(result).toBeDefined();

      // Verify all connections are available after query (detached automatically)
      expect(pool!.connections.every(c => c.isAvailable())).toBe(true);
    });

    it('should handle pool query with options', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [
          {
            id: 'query-opts-test',
            PoolOptions: {
              creds: {
                host: 'test-host',
                user: 'test-user',
                password: 'test-password',
              },
              initialConnections: {
                size: 1,
              },
            },
          },
        ],
      });

      await pools.init();
      const pool = await pools.get('query-opts-test');

      // Execute query with options
      const result = await pool!.query('SELECT * FROM TEST_TABLE WHERE id = ?', {
        parameters: [1],
      });
      expect(result).toBeDefined();

      // Verify connection is detached
      expect(pool!.connections.every(c => c.isAvailable())).toBe(true);
    });

    it('should detach connection even if query fails', async () => {
      const pools = new rmPools({
        activate: true,
        pools: [
          {
            id: 'query-error-test',
            PoolOptions: {
              creds: {
                host: 'test-host',
                user: 'test-user',
                password: 'test-password',
              },
              initialConnections: {
                size: 1,
              },
            },
          },
        ],
      });

      await pools.init();
      const pool = await pools.get('query-error-test');

      // Execute invalid query
      try {
        await pool!.query('INVALID SQL STATEMENT');
      } catch (error) {
        // Error is expected
      }

      // Verify connection is still detached despite error
      expect(pool!.connections.every(c => c.isAvailable())).toBe(true);
    });
  });
});
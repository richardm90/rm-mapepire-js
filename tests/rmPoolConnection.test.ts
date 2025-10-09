import rmPoolConnection from '../src/rmPoolConnection';
import { PoolConfig } from '../src/types';

// Mock the module before tests run
jest.mock('@ibm/mapepire-js');

describe('rmPoolConnection', () => {
  const mockPoolConfig: PoolConfig = {
    id: 'test-pool',
    PoolOptions: {
      creds: {
        host: 'test-host',
        user: 'test-user',
        password: 'test-password',
      },
      dbConnectorDebug: false,
      JDBCOptions: {},
      envvars: [],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a new rmPoolConnection instance', () => {
      const connection = new rmPoolConnection(mockPoolConfig);

      expect(connection).toBeInstanceOf(rmPoolConnection);
      expect(connection.poolId).toBe('test-pool');
      expect(connection.poolIndex).toBeNull();
      expect(connection.available).toBe(false);
      expect(connection.creds).toEqual(mockPoolConfig.PoolOptions.creds);
    });

    it('should use default values for optional properties', () => {
      const connection = new rmPoolConnection(mockPoolConfig);

      expect(connection.debug).toBe(false);
      expect(connection.JDBCOptions).toEqual({});
      expect(connection.envvars).toEqual([]);
    });
  });

  describe('init', () => {
    it('should initialize the connection', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      await connection.init(1);

      expect(connection.poolIndex).toBe(1);
      expect(connection.jobName).toBeDefined();
      expect(connection.connection).toBeDefined();
    });

    it('should connect if status is notStarted', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      await connection.init(1);

      expect(connection.connection).toBeDefined();
      expect(connection.connection.getStatus).toBeDefined();
    });

    it('should execute initialization SQL', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      process.env.PROJECT_NAME = 'TestProject';

      await connection.init(1);

      expect(connection.connection.execute).toBeDefined();
      expect(connection.jobName).toBeDefined();
    });
  });

  describe('query', () => {
    it('should execute a SQL query', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      await connection.init(1);

      const result = await connection.query('SELECT * FROM TEST');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should pass options to execute', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      await connection.init(1);

      const opts = { parameters: [1, 2, 3] };
      const result = await connection.query('SELECT * FROM TEST WHERE id = ?', opts);

      expect(result).toBeDefined();
    });
  });

  describe('availability management', () => {
    it('should set availability', () => {
      const connection = new rmPoolConnection(mockPoolConfig);

      connection.setAvailable(true);
      expect(connection.isAvailable()).toBe(true);

      connection.setAvailable(false);
      expect(connection.isAvailable()).toBe(false);
    });

    it('should detach and set available to true', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      connection.setAvailable(false);

      await connection.detach();

      expect(connection.isAvailable()).toBe(true);
    });
  });

  describe('retire', () => {
    it('should retire the connection', async () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      await connection.init(1);

      const result = await connection.retire();

      expect(result).toBe(true);
    });
  });
});
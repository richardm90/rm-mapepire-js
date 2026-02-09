import rmPoolConnection from '../src/rmPoolConnection';
import { PoolConfig } from '../src/types';
import { SQLJob } from '@ibm/mapepire-js';

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

  describe('buildEnvVarCommand', () => {
    it('should build a valid ADDENVVAR command', () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      const cmd = connection.buildAddEnvVarCommand('MY_VAR', 'hello');
      expect(cmd).toBe("ADDENVVAR ENVVAR(MY_VAR) VALUE('hello')");
    });

    it('should escape single quotes in the value', () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      const cmd = connection.buildAddEnvVarCommand('MY_VAR', "it's a test");
      expect(cmd).toBe("ADDENVVAR ENVVAR(MY_VAR) VALUE('it''s a test')");
    });

    it('should escape multiple single quotes in the value', () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      const cmd = connection.buildAddEnvVarCommand('MY_VAR', "a'b'c");
      expect(cmd).toBe("ADDENVVAR ENVVAR(MY_VAR) VALUE('a''b''c')");
    });

    it('should reject envvar names with special characters', () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      expect(() => connection.buildAddEnvVarCommand("DROP TABLE--", "val")).toThrow('Invalid environment variable name');
      expect(() => connection.buildAddEnvVarCommand("MY VAR", "val")).toThrow('Invalid environment variable name');
      expect(() => connection.buildAddEnvVarCommand("MY'VAR", "val")).toThrow('Invalid environment variable name');
      expect(() => connection.buildAddEnvVarCommand("MY;VAR", "val")).toThrow('Invalid environment variable name');
    });

    it('should reject envvar names starting with a number', () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      expect(() => connection.buildAddEnvVarCommand("1VAR", "val")).toThrow('Invalid environment variable name');
    });

    it('should accept envvar names starting with underscore', () => {
      const connection = new rmPoolConnection(mockPoolConfig);
      const cmd = connection.buildAddEnvVarCommand('_MY_VAR', 'hello');
      expect(cmd).toBe("ADDENVVAR ENVVAR(_MY_VAR) VALUE('hello')");
    });
  });

  describe('init with parameterized queries', () => {
    it('should use parameterized call for LPRINTF', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const connection = new rmPoolConnection(mockPoolConfig);
      process.env.PROJECT_NAME = 'TestProject';

      await connection.init(1);

      const lprintfCall = executeSpy.mock.calls.find((call: any[]) => call[0].includes('LPRINTF'));
      expect(lprintfCall).toBeDefined();
      expect(lprintfCall![0]).toBe('CALL SYSTOOLS.LPRINTF(?)');
      expect(lprintfCall![1]).toEqual({ parameters: [expect.stringContaining('TestProject')] });

      executeSpy.mockRestore();
    });

    it('should use parameterized call for QCMDEXC when setting envvars', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const configWithEnvvars: PoolConfig = {
        ...mockPoolConfig,
        PoolOptions: {
          ...mockPoolConfig.PoolOptions,
          envvars: [{ envvar: 'TEST_VAR', value: 'test_value' }],
        },
      };
      const connection = new rmPoolConnection(configWithEnvvars);

      await connection.init(1);

      const qcmdexcCall = executeSpy.mock.calls.find((call: any[]) => call[0].includes('QCMDEXC'));
      expect(qcmdexcCall).toBeDefined();
      expect(qcmdexcCall![0]).toBe('CALL QSYS2.QCMDEXC(?)');
      expect(qcmdexcCall![1]).toEqual({ parameters: ["ADDENVVAR ENVVAR(TEST_VAR) VALUE('test_value')"] });

      executeSpy.mockRestore();
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
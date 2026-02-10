import rmConnection from '../src/rmConnection';
import { EnvVar } from '../src/types';
import { SQLJob, States } from '@ibm/mapepire-js';

jest.mock('@ibm/mapepire-js');

describe('rmConnection', () => {
  const mockCreds = {
    host: 'test-host',
    user: 'test-user',
    password: 'test-password',
  };
  const mockJDBCOptions = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a new rmConnection instance', () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);

      expect(conn).toBeInstanceOf(rmConnection);
      expect(conn.creds).toEqual(mockCreds);
      expect(conn.JDBCOptions).toEqual({});
      expect(conn.envvars).toEqual([]);
      expect(conn.available).toBe(false);
      expect(conn.debug).toBe(false);
    });

    it('should accept envvars and debug parameters', () => {
      const envvars: EnvVar[] = [{ envvar: 'MY_VAR', value: 'my_val' }];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, envvars, true);

      expect(conn.envvars).toEqual(envvars);
      expect(conn.debug).toBe(true);
    });
  });

  describe('init', () => {
    it('should initialize the connection and set job name', async () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();

      expect(conn.job).toBeDefined();
      expect(conn.jobName).toBeDefined();
      expect(conn.getStatus()).toBe(States.JobStatus.READY);
    });

    it('should connect if status is NOT_STARTED', async () => {
      const connectSpy = jest.spyOn(SQLJob.prototype, 'connect');
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();

      expect(connectSpy).toHaveBeenCalledWith(mockCreds);
      connectSpy.mockRestore();
    });

    it('should suppress connection log message when flag is set', async () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      // Should not throw when called with true
      await conn.init(true);
      expect(conn.jobName).toBeDefined();
    });

    it('should set environment variables using parameterized QCMDEXC', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const envvars: EnvVar[] = [{ envvar: 'TEST_VAR', value: 'test_value' }];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, envvars);

      await conn.init();

      const qcmdexcCall = executeSpy.mock.calls.find((call: any[]) => call[0].includes('QCMDEXC'));
      expect(qcmdexcCall).toBeDefined();
      expect(qcmdexcCall![0]).toBe('CALL QSYS2.QCMDEXC(?)');
      expect(qcmdexcCall![1]).toEqual({
        parameters: ["ADDENVVAR ENVVAR(TEST_VAR) VALUE('test_value') REPLACE(*YES)"],
      });

      executeSpy.mockRestore();
    });

    it('should skip envvars with null name or value', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const envvars: EnvVar[] = [
        { envvar: null, value: 'val' },
        { envvar: 'VAR', value: null },
      ];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, envvars);

      await conn.init();

      const qcmdexcCalls = executeSpy.mock.calls.filter((call: any[]) => call[0].includes('QCMDEXC'));
      expect(qcmdexcCalls).toHaveLength(0);

      executeSpy.mockRestore();
    });
  });

  describe('execute', () => {
    it('should execute SQL and return result', async () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();

      const result = await conn.execute('SELECT * FROM TEST');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should pass options to the underlying job', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();

      const opts = { parameters: [1, 2] };
      await conn.execute('SELECT * FROM TEST WHERE id = ?', opts);

      const matchingCall = executeSpy.mock.calls.find(
        (call: any[]) => call[0] === 'SELECT * FROM TEST WHERE id = ?'
      );
      expect(matchingCall).toBeDefined();
      expect(matchingCall![1]).toEqual(opts);

      executeSpy.mockRestore();
    });
  });

  describe('query', () => {
    it('should execute SQL via query and return result', async () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();

      const result = await conn.query('SELECT 1 FROM SYSIBM.SYSDUMMY1');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('close', () => {
    it('should close the underlying job', async () => {
      const closeSpy = jest.spyOn(SQLJob.prototype, 'close');
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();

      await conn.close();

      expect(closeSpy).toHaveBeenCalled();
      expect(conn.getStatus()).toBe(States.JobStatus.ENDED);

      closeSpy.mockRestore();
    });
  });

  describe('getStatus', () => {
    it('should return READY after init', async () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();

      expect(conn.getStatus()).toBe(States.JobStatus.READY);
    });

    it('should return ENDED after close', async () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();
      await conn.close();

      expect(conn.getStatus()).toBe(States.JobStatus.ENDED);
    });
  });

  describe('getInfo', () => {
    it('should return connection information', async () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      await conn.init();

      const info = conn.getInfo() as any;

      expect(info.jobName).toBeDefined();
      expect(info.available).toBe(false);
      expect(info.status).toBe(States.JobStatus.READY);
    });
  });

  describe('buildAddEnvVarCommand', () => {
    it('should build a valid ADDENVVAR command', () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      const cmd = conn.buildAddEnvVarCommand('MY_VAR', 'hello');
      expect(cmd).toBe("ADDENVVAR ENVVAR(MY_VAR) VALUE('hello') REPLACE(*YES)");
    });

    it('should escape single quotes in the value', () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      const cmd = conn.buildAddEnvVarCommand('MY_VAR', "it's a test");
      expect(cmd).toBe("ADDENVVAR ENVVAR(MY_VAR) VALUE('it''s a test') REPLACE(*YES)");
    });

    it('should escape multiple single quotes in the value', () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      const cmd = conn.buildAddEnvVarCommand('MY_VAR', "a'b'c");
      expect(cmd).toBe("ADDENVVAR ENVVAR(MY_VAR) VALUE('a''b''c') REPLACE(*YES)");
    });

    it('should reject envvar names with special characters', () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      expect(() => conn.buildAddEnvVarCommand("DROP TABLE--", "val")).toThrow('Invalid environment variable name');
      expect(() => conn.buildAddEnvVarCommand("MY VAR", "val")).toThrow('Invalid environment variable name');
      expect(() => conn.buildAddEnvVarCommand("MY'VAR", "val")).toThrow('Invalid environment variable name');
      expect(() => conn.buildAddEnvVarCommand("MY;VAR", "val")).toThrow('Invalid environment variable name');
    });

    it('should reject envvar names starting with a number', () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      expect(() => conn.buildAddEnvVarCommand("1VAR", "val")).toThrow('Invalid environment variable name');
    });

    it('should accept envvar names starting with underscore', () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      const cmd = conn.buildAddEnvVarCommand('_MY_VAR', 'hello');
      expect(cmd).toBe("ADDENVVAR ENVVAR(_MY_VAR) VALUE('hello') REPLACE(*YES)");
    });
  });
});

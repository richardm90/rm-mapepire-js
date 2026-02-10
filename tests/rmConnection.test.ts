import rmConnection from '../src/rmConnection';
import { InitCommand } from '../src/types';
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
      expect(conn.initCommands).toEqual([]);
      expect(conn.available).toBe(false);
      expect(conn.debug).toBe(false);
    });

    it('should accept initCommands and debug parameters', () => {
      const initCommands: InitCommand[] = [{ command: 'CHGLIBL LIBL(MYLIB QGPL)' }];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, initCommands, true);

      expect(conn.initCommands).toEqual(initCommands);
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

    it('should execute CL init commands via parameterized QCMDEXC', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const initCommands: InitCommand[] = [{ command: 'CHGLIBL LIBL(MYLIB QGPL)' }];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, initCommands);

      await conn.init();

      const qcmdexcCall = executeSpy.mock.calls.find((call: any[]) => call[0].includes('QCMDEXC'));
      expect(qcmdexcCall).toBeDefined();
      expect(qcmdexcCall![0]).toBe('CALL QSYS2.QCMDEXC(?)');
      expect(qcmdexcCall![1]).toEqual({
        parameters: ['CHGLIBL LIBL(MYLIB QGPL)'],
      });

      executeSpy.mockRestore();
    });

    it('should default to cl type when not specified', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const initCommands: InitCommand[] = [{ command: 'ADDLIBLE MYLIB' }];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, initCommands);

      await conn.init();

      const qcmdexcCall = executeSpy.mock.calls.find((call: any[]) => call[0].includes('QCMDEXC'));
      expect(qcmdexcCall).toBeDefined();
      expect(qcmdexcCall![0]).toBe('CALL QSYS2.QCMDEXC(?)');
      expect(qcmdexcCall![1]).toEqual({
        parameters: ['ADDLIBLE MYLIB'],
      });

      executeSpy.mockRestore();
    });

    it('should execute SQL init commands directly', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const initCommands: InitCommand[] = [{ command: 'SET SCHEMA MYLIB', type: 'sql' }];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, initCommands);

      await conn.init();

      const sqlCall = executeSpy.mock.calls.find((call: any[]) => call[0] === 'SET SCHEMA MYLIB');
      expect(sqlCall).toBeDefined();

      executeSpy.mockRestore();
    });

    it('should skip init commands with empty command', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const initCommands: InitCommand[] = [{ command: '' }];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, initCommands);

      await conn.init();

      const qcmdexcCalls = executeSpy.mock.calls.filter((call: any[]) => call[0].includes('QCMDEXC'));
      expect(qcmdexcCalls).toHaveLength(0);

      executeSpy.mockRestore();
    });

    it('should execute mixed CL and SQL init commands', async () => {
      const executeSpy = jest.spyOn(SQLJob.prototype, 'execute');
      const initCommands: InitCommand[] = [
        { command: 'CHGLIBL LIBL(MYLIB QGPL)', type: 'cl' },
        { command: 'SET SCHEMA MYLIB', type: 'sql' },
      ];
      const conn = new rmConnection(mockCreds, mockJDBCOptions, initCommands);

      await conn.init();

      const qcmdexcCall = executeSpy.mock.calls.find((call: any[]) => call[0].includes('QCMDEXC'));
      expect(qcmdexcCall).toBeDefined();
      expect(qcmdexcCall![1]).toEqual({
        parameters: ['CHGLIBL LIBL(MYLIB QGPL)'],
      });

      const sqlCall = executeSpy.mock.calls.find((call: any[]) => call[0] === 'SET SCHEMA MYLIB');
      expect(sqlCall).toBeDefined();

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

  describe('logger injection', () => {
    it('should use custom logger when provided', async () => {
      const customLogger = { log: jest.fn() };
      const conn = new rmConnection(mockCreds, mockJDBCOptions, [], true, customLogger);
      await conn.init();

      expect(customLogger.log).toHaveBeenCalled();
      expect(customLogger.log.mock.calls.some(
        (call: any[]) => call[2]?.service === 'rmConnection'
      )).toBe(true);
    });

    it('should use default logger when none provided', () => {
      const conn = new rmConnection(mockCreds, mockJDBCOptions);
      expect(conn.logger).toBeDefined();
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

});

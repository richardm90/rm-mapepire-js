import './setup';
import { RmLogger } from '../src/logger';
import { RmPools } from '../src/rmPools';
import { PoolConfig } from '../src/types';

describe('RmLogger', () => {
  let mockLogger: { log: jest.Mock };

  beforeEach(() => {
    mockLogger = { log: jest.fn() };
  });

  describe('log level filtering', () => {
    it('should log error messages at error level', () => {
      const rmLogger = new RmLogger(mockLogger, 'error', 'TestService');
      rmLogger.error('test error');
      expect(mockLogger.log).toHaveBeenCalledWith('error', 'test error', { service: 'TestService' });
    });

    it('should suppress info messages at error level', () => {
      const rmLogger = new RmLogger(mockLogger, 'error', 'TestService');
      rmLogger.info('test info');
      expect(mockLogger.log).not.toHaveBeenCalled();
    });

    it('should suppress debug messages at error level', () => {
      const rmLogger = new RmLogger(mockLogger, 'error', 'TestService');
      rmLogger.debug('test debug');
      expect(mockLogger.log).not.toHaveBeenCalled();
    });

    it('should log error and info messages at info level', () => {
      const rmLogger = new RmLogger(mockLogger, 'info', 'TestService');
      rmLogger.error('test error');
      rmLogger.info('test info');
      expect(mockLogger.log).toHaveBeenCalledTimes(2);
    });

    it('should suppress debug messages at info level', () => {
      const rmLogger = new RmLogger(mockLogger, 'info', 'TestService');
      rmLogger.debug('test debug');
      expect(mockLogger.log).not.toHaveBeenCalled();
    });

    it('should log all messages at debug level', () => {
      const rmLogger = new RmLogger(mockLogger, 'debug', 'TestService');
      rmLogger.error('test error');
      rmLogger.info('test info');
      rmLogger.debug('test debug');
      expect(mockLogger.log).toHaveBeenCalledTimes(3);
    });

    it('should suppress all messages at none level', () => {
      const rmLogger = new RmLogger(mockLogger, 'none', 'TestService');
      rmLogger.error('test error');
      rmLogger.info('test info');
      rmLogger.debug('test debug');
      expect(mockLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('should include prefix in formatted message', () => {
      const rmLogger = new RmLogger(mockLogger, 'info', 'TestService', 'Pool: myPool');
      rmLogger.info('connected');
      expect(mockLogger.log).toHaveBeenCalledWith('info', 'Pool: myPool - connected', { service: 'TestService' });
    });

    it('should format message without prefix when none set', () => {
      const rmLogger = new RmLogger(mockLogger, 'info', 'TestService');
      rmLogger.info('connected');
      expect(mockLogger.log).toHaveBeenCalledWith('info', 'connected', { service: 'TestService' });
    });

    it('should use updated prefix after setPrefix', () => {
      const rmLogger = new RmLogger(mockLogger, 'info', 'TestService');
      rmLogger.setPrefix('Job: 123456');
      rmLogger.info('connected');
      expect(mockLogger.log).toHaveBeenCalledWith('info', 'Job: 123456 - connected', { service: 'TestService' });
    });
  });
});

describe('Log level integration', () => {
  const mockPoolConfig: PoolConfig = {
    id: 'test-pool',
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should suppress info messages when logLevel is error', async () => {
    const customLogger = { log: jest.fn() };
    const pools = new RmPools({
      logLevel: 'error',
      logger: customLogger,
      pools: [mockPoolConfig],
    });

    await pools.init();

    // Info messages like 'Pool activated' should be suppressed
    const infoLogs = customLogger.log.mock.calls.filter(
      (call: any[]) => call[0] === 'info'
    );
    expect(infoLogs.length).toBe(0);
  });

  it('should show info messages when logLevel is info', async () => {
    const customLogger = { log: jest.fn() };
    const pools = new RmPools({
      logLevel: 'info',
      logger: customLogger,
      pools: [mockPoolConfig],
    });

    await pools.init();

    // Info messages like 'Pool activated' should appear
    const infoLogs = customLogger.log.mock.calls.filter(
      (call: any[]) => call[0] === 'info'
    );
    expect(infoLogs.length).toBeGreaterThan(0);
  });

  it('should suppress all messages when logLevel is none', async () => {
    const customLogger = { log: jest.fn() };
    const pools = new RmPools({
      logLevel: 'none',
      logger: customLogger,
      pools: [mockPoolConfig],
    });

    await pools.init();

    expect(customLogger.log).not.toHaveBeenCalled();
  });

  it('should show debug messages when logLevel is debug', async () => {
    const customLogger = { log: jest.fn() };
    const pools = new RmPools({
      logLevel: 'debug',
      logger: customLogger,
      pools: [mockPoolConfig],
    });

    await pools.init();

    const debugLogs = customLogger.log.mock.calls.filter(
      (call: any[]) => call[0] === 'debug'
    );
    expect(debugLogs.length).toBeGreaterThan(0);
  });

  it('should default to info level when no logLevel specified', async () => {
    const customLogger = { log: jest.fn() };
    const pools = new RmPools({
      logger: customLogger,
      pools: [mockPoolConfig],
    });

    await pools.init();

    // Info messages should appear
    const infoLogs = customLogger.log.mock.calls.filter(
      (call: any[]) => call[0] === 'info'
    );
    expect(infoLogs.length).toBeGreaterThan(0);

    // Debug messages should not appear
    const debugLogs = customLogger.log.mock.calls.filter(
      (call: any[]) => call[0] === 'debug'
    );
    expect(debugLogs.length).toBe(0);
  });

  it('should allow per-pool logLevel override', async () => {
    const customLogger = { log: jest.fn() };
    const pools = new RmPools({
      logLevel: 'error',
      logger: customLogger,
      pools: [{
        id: 'verbose-pool',
        PoolOptions: {
          creds: {
            host: 'test-host',
            user: 'test-user',
            password: 'test-password',
          },
          logLevel: 'info',
          initialConnections: {
            size: 1,
          },
        },
      }],
    });

    await pools.init();

    // The pool has logLevel: 'info', so info messages from pool/connections should appear
    // even though the global level is 'error'
    const infoLogs = customLogger.log.mock.calls.filter(
      (call: any[]) => call[0] === 'info' && call[2]?.service !== 'RmPools'
    );
    expect(infoLogs.length).toBeGreaterThan(0);

    // But RmPools-level info messages should be suppressed (global is 'error')
    const poolsInfoLogs = customLogger.log.mock.calls.filter(
      (call: any[]) => call[0] === 'info' && call[2]?.service === 'RmPools'
    );
    expect(poolsInfoLogs.length).toBe(0);
  });
});

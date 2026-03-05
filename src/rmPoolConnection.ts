import RmConnection from './rmConnection';
import { JDBCOptions, DaemonServer } from '@ibm/mapepire-js';
import { PoolConfig, InitCommand, QueryOptions, Logger, LogLevel, RmQueryResult, BackendType } from './types';
import defaultLogger, { RmLogger } from './logger';

class RmPoolConnection {
  poolId: string;
  poolIndex: number | null;
  creds?: DaemonServer;
  logLevel: LogLevel;
  JDBCOptions: JDBCOptions;
  initCommands: InitCommand[];
  available: boolean;
  expiryTimerId: NodeJS.Timeout | null;
  connection!: RmConnection;
  jobName?: string;
  expiry?: number | null;
  keepalive: number | null;
  backend: BackendType;
  logger: Logger;
  rmLogger: RmLogger;

  constructor(pool: PoolConfig, logLevel: LogLevel = 'info', logger?: Logger) {
    this.poolId = pool.id;
    this.poolIndex = null;
    this.creds = pool.PoolOptions.creds;
    this.logLevel = logLevel;
    this.JDBCOptions = pool.PoolOptions?.JDBCOptions || {};
    this.initCommands = pool.PoolOptions?.initCommands || [];
    this.available = false;
    this.expiryTimerId = null;
    this.keepalive = pool.PoolOptions?.healthCheck?.keepalive ?? null;
    this.backend = pool.PoolOptions?.backend || 'auto';
    this.logger = logger || pool.PoolOptions?.logger || defaultLogger;
    this.rmLogger = new RmLogger(this.logger, this.logLevel, 'RmPoolConnection', `Pool: ${this.poolId}`);
  }

  async init(poolIndex: number): Promise<void> {
    this.poolIndex = poolIndex;
    this.rmLogger.setPrefix(`Pool: ${this.poolId} Connection: ${this.poolIndex}`);

    this.connection = new RmConnection({
      creds: this.creds,
      JDBCOptions: this.JDBCOptions,
      initCommands: this.initCommands,
      logLevel: this.logLevel,
      logger: this.logger,
      keepalive: this.keepalive,
      backend: this.backend,
    });

    await this.connection.init(true);

    this.jobName = this.connection.jobName;

    this.rmLogger.info(`Initialized, job name=${this.jobName}`);

    // Output connection details in IBM i joblog
    const projectPrefix = process.env.PROJECT_NAME ? `${process.env.PROJECT_NAME}: ` : '';
    const message = `${projectPrefix}PoolId=${this.poolId}, Connection=${this.poolIndex}`;
    await this.connection.execute(`CALL SYSTOOLS.LPRINTF(?)`, { parameters: [message] });
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<RmQueryResult<any>> {
    this.rmLogger.debug(`Executing query on connection ${this.poolIndex}`);
    const result = await this.connection.execute(sql, opts);
    return result;
  }

  async detach(): Promise<RmPoolConnection> {
    try {
      this.setAvailable(true);
    } catch (error) {
      throw new Error(`RmPoolConnection: failed to detach.`, { cause: error });
    }

    return this;
  }

  async retire(): Promise<boolean> {
    try {
      await this.connection.close();
    } catch (error) {
      throw new Error(`RmPoolConnection: failed to retire.`, { cause: error });
    }

    return true;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.connection.execute('VALUES 1');
      return true;
    } catch (error) {
      this.rmLogger.error(`Health check failed: ${error}`);
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(availability: boolean): void {
    this.available = availability;
  }

  getStatus(): string {
    return this.connection.getStatus();
  }

  getInfo(): object {
    return {
      poolId: this.poolId,
      poolIndex: this.poolIndex,
      jobName: this.jobName,
      available: this.available,
      status: this.connection?.getStatus(),
      hasExpiryTimer: this.expiryTimerId !== null,
      expiry: this.expiry,
    };
  }

  printInfo(): void {
    console.log('Connection Info:', JSON.stringify(this.getInfo(), null, 2));
  }
}

export default RmPoolConnection;

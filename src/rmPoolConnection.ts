import RmConnection from './rmConnection';
import { JDBCOptions, DaemonServer, States } from '@ibm/mapepire-js';
import { PoolConfig, InitCommand, QueryOptions, Logger, RmQueryResult } from './types';
import defaultLogger from './logger';

/**
 * Uses and Extends the Connection class implemented in idb-pconnector.
 */
class RmPoolConnection {
  poolId: string;
  poolIndex: number | null;
  creds: DaemonServer;
  debug: boolean;
  JDBCOptions: JDBCOptions;
  initCommands: InitCommand[];
  available: boolean;
  expiryTimerId: NodeJS.Timeout | null;
  connection!: RmConnection;
  jobName?: string;
  expiry?: number | null;
  logger: Logger;

  /**
   * @description
   * Instantiates a new instance of a RmPoolConnection class.
   * @param {object} pool - Pool configuration.
   */
  constructor(pool: PoolConfig, debug: boolean = false, logger?: Logger) {
    this.poolId = pool.id;
    this.poolIndex = null;
    this.creds = pool.PoolOptions.creds;
    this.debug = pool.PoolOptions?.dbConnectorDebug || false;
    this.JDBCOptions = pool.PoolOptions?.JDBCOptions || {};
    this.initCommands = pool.PoolOptions?.initCommands || [];
    this.available = false;
    this.expiryTimerId = null;
    this.debug = debug || false;
    this.logger = logger || pool.PoolOptions?.logger || defaultLogger;
  }

  /**
   * Initializes an instance of RmPoolConnection.
   */
  async init(poolIndex: number): Promise<void> {
    this.poolIndex = poolIndex;

    this.connection = new RmConnection(this.creds, this.JDBCOptions, this.initCommands, this.debug, this.logger);

    await this.connection.init(true);

    // Grab IBM i job name
    this.jobName = this.connection.jobName;

    this.log(`Initialized, job name=${this.jobName}`, 'info');

    // Output connection details in IBM i joblog
    const projectPrefix = process.env.PROJECT_NAME ? `${process.env.PROJECT_NAME}: ` : '';
    const message = `${projectPrefix}PoolId=${this.poolId}, Connection=${this.poolIndex}`;
    await this.connection.execute(`CALL SYSTOOLS.LPRINTF(?)`, { parameters: [message] });
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<RmQueryResult<any>> {
    this.log(`Executing query on connection ${this.poolIndex}`);
    const result = await this.connection.execute(sql, opts);
    return result;
  }

  /**
   * Close the connection, making it available.
   * @returns {object} The detached connection.
   */
  async detach(): Promise<RmPoolConnection> {
    try {
      this.setAvailable(true);
    } catch (error) {
      throw new Error(`RmPoolConnection: failed to detach.`, { cause: error });
    }

    return this;
  }

  /**
   * Retire the connection, closes the connection.
   * @returns {boolean} True if retired.
   */
  async retire(): Promise<boolean> {
    try {
      await this.connection.close();
    } catch (error) {
      throw new Error(`RmPoolConnection: failed to retire.`, { cause: error });
    }

    return true;
  }

  /**
   * Checks whether the underlying connection is still alive by executing
   * a lightweight query. Returns false if the query fails for any reason.
   * @returns {boolean} true if the connection is healthy.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.connection.execute('VALUES 1');
      return true;
    } catch (error) {
      this.log(`Health check failed: ${error}`, 'error');
      return false;
    }
  }

  /**
   * @returns {boolean} true if the connection is available, false if unavailable.
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * @param {boolean} availability - true or false to set the availability flag of the connection.
   */
  setAvailable(availability: boolean): void {
    this.available = availability;
  }

  /**
   * Retrieves the current status of the job.
   *
   * @returns The current status of the job.
   */
  getStatus(): States.JobStatus {
    return this.connection.getStatus();
  }

  /**
   * Get connection information for debugging
   */
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

  /**
   * Print connection info to console
   */
  printInfo(): void {
    console.log('Connection Info:', JSON.stringify(this.getInfo(), null, 2));
  }

  /**
   * Internal function used to log debug information to the console.
   * @param {string} message - the message to log.
   */
  log(message: string = '', type: string = 'debug'): void {
    if (type !== 'debug' || this.debug) {
      this.logger.log(type, `Pool: ${this.poolId} Connection: ${this.poolIndex} - ${message}`, { service: 'RmPoolConnection' });
    }
  }
}

export default RmPoolConnection;
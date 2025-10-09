import { SQLJob, JDBCOptions, DaemonServer } from '@ibm/mapepire-js';
import { PoolConfig, EnvVar, QueryOptions } from './types';
import logger from './logger';

/**
 * Uses and Extends the Connection class implemented in idb-pconnector.
 */
class rmPoolConnection {
  poolId: string;
  poolIndex: number | null;
  creds: DaemonServer;
  debug: boolean;
  JDBCOptions: JDBCOptions;
  envvars: EnvVar[];
  available: boolean;
  expiryTimerId: NodeJS.Timeout | null;
  connection!: SQLJob;
  jobName?: string;
  expiry?: number | null;

  /**
   * @description
   * Instantiates a new instance of a rmPoolConnection class.
   * @param {object} pool - Pool configuration.
   */
  constructor(pool: PoolConfig) {
    this.poolId = pool.id;
    this.poolIndex = null;
    this.creds = pool.PoolOptions.creds;
    this.debug = pool.PoolOptions?.dbConnectorDebug || false;
    this.JDBCOptions = pool.PoolOptions?.JDBCOptions || {};
    this.envvars = pool.PoolOptions?.envvars || [];
    this.available = false;
    this.expiryTimerId = null;
  }

  /**
   * Initializes an instance of rmPoolConnection.
   */
  async init(poolIndex: number): Promise<void> {
    this.poolIndex = poolIndex;

    this.connection = new SQLJob(this.JDBCOptions);

    if (this.connection.getStatus() === "notStarted") {
      await this.connection.connect(this.creds);
    }

    // Grab IBM i job name
    this.jobName = this.connection.id;

    this.log(`Initialized, job name=${this.jobName}`, 'info');

    this.log(`GOT HERE #1`, 'info');

    // Output connection details in IBM i joblog
    const message = `${process.env.PROJECT_NAME}: PoolId=${this.poolId}, Connection=${this.poolIndex}`;

    this.log(`GOT HERE #2`, 'info');

    const command = `CALL SYSTOOLS.LPRINTF('${message}')`;

    this.log(`GOT HERE #3`, 'info');

    this.log(`Running command: ${command}`);

    await this.connection.execute(command);

    this.log(`Just finished running command: ${command}`);

    // Set connection (IBM i job) environment variables
    for (let i = 0; i < this.envvars.length; i += 1) {
      const { envvar = null, value = null } = this.envvars[i];
      if (envvar !== null && value !== null) {
        await this.connection.execute(`CALL QSYS2.QCMDEXC('ADDENVVAR ENVVAR(${envvar}) VALUE(''${value}'')')`);
      }
    }

    // Initialize IBM i job environment
    // - Uses GB System signon program
    await this.connection.execute(`CALL QSYS2.QCMDEXC('CALL PGM(GBSSIGNWB)')`);
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<any> {
    const result = await this.connection.execute(sql, opts);
    return result;
  }

  /**
   * Close the connection, making it available.
   * @returns {object} The detached connection.
   */
  async detach(): Promise<rmPoolConnection> {
    try {
      this.setAvailable(true);
    } catch (error) {
      const reason = new Error(`rmPoolConnection: failed to detach.`);
      if (error instanceof Error) {
        reason.stack += `\nCaused By:\n ${error.stack}`;
      }
      throw reason;
    }

    return this;
  }

  /**
   * Retire the connection, closes the connection.
   * @returns {boolean} True if retired.
   */
  async retire(): Promise<boolean> {
    try {
      // Note: close() method doesn't exist in your original code
      // You may need to implement this or use connection.close() if available
      // await this.connection.close();
    } catch (error) {
      const reason = new Error(`rmPoolConnection: failed to retire.`);
      if (error instanceof Error) {
        reason.stack += `\nCaused By:\n ${error.stack}`;
      }
      throw reason;
    }

    return true;
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
   * Internal function used to log debug information to the console.
   * @param {string} message - the message to log.
   */
  log(message: string = '', type: string = 'debug'): void {
    if (type === 'debug') {
      if (this.debug) {
        logger.log('debug', `Pool ${this.poolId} connection ${this.poolIndex}: ${message}`, { service: 'rmPoolConnection' });
      }
    } else {
      logger.log(type, `Pool ${this.poolId} connection ${this.poolIndex}: ${message}`, { service: 'rmPoolConnection' });
    }
  }
}

export default rmPoolConnection;
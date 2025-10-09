import rmPoolConnection from './rmPoolConnection';
import { PoolConfig, InitialConnections, IncrementConnections, JDBCOptions } from './types';
import { DaemonServer } from '@ibm/mapepire-js';
import logger from './logger';

class rmPool {
  connections: rmPoolConnection[];
  id: string;
  config: PoolConfig;
  creds: DaemonServer;
  maxSize: number;
  initialConnections: InitialConnections;
  incrementConnections: IncrementConnections;
  dbConnectorDebug: boolean;
  JDBCOptions: JDBCOptions;
  envvars: any[];
  debug: boolean;

  /**
   * Manages a list of rmPoolConnection instances.
   * Constructor to instantiate a new instance of a rmPool class given the `database` and `config`
   * @param {object} config - rmPool config object.
   * @param {boolean} debug - Boolean, display verbose output from the application to the console.
   * @constructor
   */
  constructor(config: { id: string; config: PoolConfig }, debug: boolean = false) {
    this.connections = [];

    // Set pool configuration
    this.id = config.id;
    this.config = config.config;
    const opts = this.config.PoolOptions || {};

    this.creds = opts.creds;
    this.maxSize = opts.maxSize || 20;
    this.initialConnections = opts.initialConnections || {};
    this.initialConnections.size = this.initialConnections.size || 8;
    this.initialConnections.expiry = this.initialConnections.expiry || null;
    this.incrementConnections = opts.incrementConnections || opts.initialConnections || {};
    this.incrementConnections.size = this.incrementConnections.size || 8;
    this.incrementConnections.expiry = this.incrementConnections.expiry || null;
    this.dbConnectorDebug = opts.dbConnectorDebug || false;
    this.JDBCOptions = opts.JDBCOptions || {};
    this.envvars = opts.envvars || [];
    this.debug = debug || false;
  }

  /**
   * Initializes the rmPool instance.
   */
  async init(): Promise<void> {
    for (let i = 0; i < this.initialConnections.size!; i += 1) {
      await this.createConnection(this.initialConnections.expiry);
    }

    this.log(`Connection pool initialized`);
  }

  /**
   * Instantiates a new instance of rmPoolConnection with an `index` and appends it to the pool.
   * Assumes the database of the pool when establishing the connection.
   */
  async createConnection(expiry?: number | null): Promise<rmPoolConnection> {
    const conn = new rmPoolConnection(this.config);

    const poolIndex = this.connections.push(conn);

    await conn.init(poolIndex);
    conn.expiry = expiry;
    this.setExpiryTimer(conn);
    conn.setAvailable(true);

    this.log(`Connection ${poolIndex} created, job ${conn.jobName}`);

    return conn;
  }

  /**
   * Frees all connections in the pool (Sets "Available" back to true for all)
   * closes any statements and gets a new statement.
   * @returns {boolean} - true if all were detached successfully
   */
  async detachAll(): Promise<boolean> {
    for (let i = 0; i < this.connections.length; i += 1) {
      try {
        await this.detach(this.connections[i]);
      } catch (error) {
        const reason = new Error('rmPool: Failed to detachAll()');
        if (error instanceof Error) {
          reason.stack += `\nCaused By:\n ${error.stack}`;
        }
        throw reason;
      }
    }

    return true;
  }

  /**
   * Retires (Removes) all connections from being used again
   * @returns {boolean} - true if all were retired successfully
   */
  async retireAll(): Promise<boolean> {
    try {
      for (let i = 0; i < this.connections.length; i += 1) {
        await this.retire(this.connections[i]);
      }
    } catch (error) {
      const reason = new Error('rmPool: Failed to retireAll()');
      if (error instanceof Error) {
        reason.stack += `\nCaused By:\n ${error.stack}`;
      }
      throw reason;
    }
    return true;
  }

  /**
   * Frees a connection (Returns the connection "Available" back to true)
   * @param {rmPoolConnection} connection
   * @returns {boolean} - true if detached successfully
   */
  async detach(connection: rmPoolConnection): Promise<boolean> {
    const index = connection.poolIndex;
    try {
      await connection.detach();
      this.setExpiryTimer(connection);
    } catch (error) {
      const reason = new Error('rmPool: Failed to detach()');
      if (error instanceof Error) {
        reason.stack += `\nCaused By:\n ${error.stack}`;
      }
      throw reason;
    }
    this.log(`Connection ${index} detached`);
    return true;
  }

  /**
   * Retires a connection from being used and removes it from the pool
   * @param {rmPoolConnection} connection
   */
  async retire(connection: rmPoolConnection): Promise<void> {
    const index = connection.poolIndex;

    try {
      this.cancelExpiryTimer(connection);
      await connection.retire();

      // Find and remove the connection from the pool
      const connectionIndex = this.connections.indexOf(connection);
      if (connectionIndex !== -1) {
        this.connections.splice(connectionIndex, 1);
      }
    } catch (error) {
      console.dir(error, { depth: 5 });
      const reason = new Error(`rmPool: Failed to retire() Connection #${index}`);
      if (error instanceof Error) {
        reason.stack += `\nCaused By:\n ${error.stack}`;
      }
      throw reason;
    }
    this.log(`Connection ${index} retired`);
  }

  /**
   * Finds and returns the first available Connection.
   * @returns {rmPoolConnection} - one connection from the rmPool.
   */
  async attach(): Promise<rmPoolConnection> {
    const size = this.incrementConnections.size!;
    let validConnection = false;
    let connection: rmPoolConnection | undefined;
    let i: number;
    let increasedPoolSize = false;

    this.log('Finding available connection');
    while (!validConnection) {
      for (i = 0; i < this.connections.length; i += 1) {
        if (this.connections[i].isAvailable()) {
          this.cancelExpiryTimer(this.connections[i]);
          this.connections[i].setAvailable(false);
          validConnection = true;

          this.log(`Connection ${this.connections[i].poolIndex} found`);
          return this.connections[i];
        }
      }

      this.log('No available connections found');

      let increasedConnections = 0;
      for (i = 0; i < size; i += 1) {
        if (this.connections.length >= this.maxSize) {
          const msg = `Maximum number of connections (${this.connections.length}) reached`;
          this.log(msg);
          if (increasedPoolSize) {
            break;
          } else {
            throw new Error(msg);
          }
        }

        connection = await this.createConnection(this.incrementConnections.expiry);
        increasedConnections += 1;
        increasedPoolSize = true;
      }

      if (increasedPoolSize) {
        this.log(`Increased connections by ${increasedConnections} to ${this.connections.length} (total)`);
      }
    }

    return connection!;
  }

  /**
   * Starts the expiry timer for the connection.
   */
  setExpiryTimer(conn: rmPoolConnection): void {
    this.cancelExpiryTimer(conn);

    if (conn.expiry && conn.expiry > 0) {
      const milliseconds = conn.expiry * 60 * 1000;
      conn.expiryTimerId = setTimeout(this.setExpired.bind(this), milliseconds, conn);

      this.log(`Connection ${conn.poolIndex} expiry timer set`, 'debug');
    }
  }

  /**
   * Cancels the expiry timer for the connection.
   */
  cancelExpiryTimer(conn: rmPoolConnection): void {
    if (conn.expiryTimerId) {
      clearTimeout(conn.expiryTimerId);
      conn.expiryTimerId = null;

      this.log(`Connection ${conn.poolIndex} expiry timer cancelled`, 'debug');
    }
  }

  /**
   * Flags the connection as expired.
   */
  setExpired(conn: rmPoolConnection): void {
    conn.setAvailable(false);
    this.retire(conn);

    this.log(`Connection ${conn.poolIndex} expired`);
  }

  /**
   * Internal function used to log debug information to the console.
   * @param {string} message - the message to log.
   */
  log(message: string = '', type: string = 'debug'): void {
    if (type === 'debug') {
      if (this.debug) {
        logger.log('debug', `Pool ${this.id}: ${message}`, { service: 'rmPool' });
      }
    } else {
      logger.log(type, `Pool ${this.id}: ${message}`, { service: 'rmPool' });
    }
  }
}

export default rmPool;
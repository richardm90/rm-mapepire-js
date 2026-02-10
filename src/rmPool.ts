import rmPoolConnection from './rmPoolConnection';
import { PoolConfig, InitialConnections, IncrementConnections, JDBCOptions, QueryOptions } from './types';
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
  initCommands: any[];
  debug: boolean;

  /**
   * Manages a list of rmPoolConnection instances.
   * Constructor to instantiate a new instance of a rmPool class given the `database` and `config`
   * @param {object} config - rmPool config object.
   * @param {boolean} debug - Boolean, display verbose output from the application to the console.
   * @constructor
   */
  constructor(config: { id: string; config?: PoolConfig }, debug: boolean = false) {
    this.connections = [];

    // Set pool configuration
    this.id = config.id;
    this.config = config.config || {
      id: config.id,
      PoolOptions: {
        creds: { host: '', user: '', password: '' }
      }
    };
    const opts = this.config.PoolOptions || { creds: { host: '', user: '', password: '' } };

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
    this.initCommands = opts.initCommands || [];
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
    const conn = new rmPoolConnection(this.config, this.debug);

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
      // Retire connections in reverse order, use a while loop
      // to avoid issues with array indices shifting
      while (this.connections.length > 0) {
        await this.retire(this.connections[0]);
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
   * Closes all connections in the pool and stop them being used again
   * - Essentially the same as pool.retireAll()
   * @returns {boolean} - true if the close was successfully
   */
  async close(): Promise<boolean> {
    try {
      // Retire connections in reverse order, use a while loop
      // to avoid issues with array indices shifting
      while (this.connections.length > 0) {
        await this.retire(this.connections[0]);
      }
    } catch (error) {
      const reason = new Error('rmPool: Failed to close()');
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
   * Executes a query using a connection from the pool.
   * Automatically handles attach/query/detach lifecycle.
   * @param {string} sql - SQL statement to execute
   * @param {QueryOptions} opts - Query options to pass to the underlying execute method
   * @returns {Promise<any>} - Query result from the database
   */
  async query(sql: string, opts: QueryOptions = {}): Promise<any> {
    const connection = await this.attach();
    try {
      const result = await connection.query(sql, opts);
      return result;
    } finally {
      await this.detach(connection);
    }
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
   * Flags the connection as expired and retires it.
   */
  async setExpired(conn: rmPoolConnection): Promise<void> {
    conn.setAvailable(false);
    this.log(`Connection ${conn.poolIndex} expired`);

    try {
      await this.retire(conn);
    } catch (error) {
      this.log(`Failed to retire expired connection ${conn.poolIndex}: ${error}`, 'error');
    }
  }

  /**
   * Get pool information for debugging
   */
  getInfo(): object {
    return {
      id: this.id,
      totalConnections: this.connections.length,
      availableConnections: this.connections.filter(c => c.isAvailable()).length,
      busyConnections: this.connections.filter(c => !c.isAvailable()).length,
      maxSize: this.maxSize,
      connections: this.connections.map(c => c.getInfo()),
    };
  }

  /**
   * Get summary statistics
   */
  getStats(): object {
    const available = this.connections.filter(c => c.isAvailable()).length;
    const busy = this.connections.filter(c => !c.isAvailable()).length;
    return {
      id: this.id,
      total: this.connections.length,
      available,
      busy,
      maxSize: this.maxSize,
      utilizationPercent: busy > 0 ? ((this.connections.length / busy) * 100).toFixed(1) : '0.0',
    };
  }

  /**
   * Print pool info to console
   */
  printInfo(): void {
    const info = this.getInfo() as any;
    console.log('\n=== Pool Info ===');
    console.log(`Pool ID: ${info.id}`);
    console.log(`Total Connections: ${info.totalConnections}/${this.maxSize}`);
    console.log(`Available: ${info.availableConnections}`);
    console.log(`Busy: ${info.busyConnections}`);
    console.log('\nConnections:');
    this.connections.forEach((conn, idx) => {
      const connInfo = conn.getInfo() as any;
      console.log(`  [${idx}] Job: ${connInfo.jobName} | Available: ${connInfo.available} | Status: ${connInfo.status}`);
    });
    console.log('=================\n');
  }

  /**
   * Print summary statistics
   */
  printStats(): void {
    const stats = this.getStats() as any;
    console.log(`\n${stats.id}:`);
    console.log(`  Connections: ${stats.busy}/${stats.total} busy (${stats.utilizationPercent}% utilized)`);
    console.log(`  Available: ${stats.available}`);
    console.log(`  Max Size: ${stats.maxSize}`);
  }

  /**
   * Internal function used to log debug information to the console.
   * @param {string} message - the message to log.
   */
  log(message: string = '', type: string = 'debug'): void {
    if (type !== 'debug' || this.debug) {
      logger.log(type, `Pool: ${this.id} - ${message}`, { service: 'rmPool' });
    }
  }
}

export default rmPool;
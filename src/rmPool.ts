import { EventEmitter } from 'events';
import RmPoolConnection from './rmPoolConnection';
import { PoolConfig, InitialConnections, IncrementConnections, JDBCOptions, QueryOptions, Logger } from './types';
import { DaemonServer } from '@ibm/mapepire-js';
import defaultLogger from './logger';

class RmPool extends EventEmitter {
  connections: RmPoolConnection[];
  id: string;
  config: PoolConfig;
  creds: DaemonServer;
  maxSize: number;
  initialConnections: InitialConnections;
  incrementConnections: IncrementConnections;
  dbConnectorDebug: boolean;
  JDBCOptions: JDBCOptions;
  initCommands: any[];
  healthCheckOnAttach: boolean;
  debug: boolean;
  logger: Logger;

  /**
   * Auto-incrementing counter for assigning stable connection IDs.
   * Unlike array position, this never changes after assignment,
   * making it reliable for log tracing and diagnostics.
   */
  private nextConnectionId: number;

  /**
   * Promise-chain mutex that serializes attach() calls.
   * Each attach() chains onto this promise, ensuring only one
   * runs at a time. This prevents two concurrent callers from
   * claiming the same connection or both creating new connections
   * when only one is needed.
   */
  private attachQueue: Promise<any>;

  /**
   * Manages a list of RmPoolConnection instances.
   * Constructor to instantiate a new instance of a RmPool class given the `database` and `config`
   * @param {object} config - RmPool config object.
   * @param {boolean} debug - Boolean, display verbose output from the application to the console.
   * @constructor
   */
  constructor(config: { id: string; config?: PoolConfig }, debug: boolean = false, logger?: Logger) {
    super();
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
    this.healthCheckOnAttach = opts.healthCheck?.onAttach ?? true;
    this.debug = debug || false;
    this.logger = logger || opts.logger || defaultLogger;
    this.attachQueue = Promise.resolve();
    this.nextConnectionId = 0;
  }

  /**
   * Initializes the RmPool instance.
   */
  async init(): Promise<void> {
    for (let i = 0; i < this.initialConnections.size!; i += 1) {
      await this.createConnection(this.initialConnections.expiry);
    }

    this.log(`Connection pool initialized`);
    this.emit('pool:initialized', { poolId: this.id, connections: this.connections.length });
  }

  /**
   * Instantiates a new instance of RmPoolConnection with an `index` and appends it to the pool.
   * Assumes the database of the pool when establishing the connection.
   */
  async createConnection(expiry?: number | null): Promise<RmPoolConnection> {
    const conn = new RmPoolConnection(this.config, this.debug, this.logger);

    this.connections.push(conn);
    const poolIndex = ++this.nextConnectionId;

    await conn.init(poolIndex);
    conn.expiry = expiry;
    this.setExpiryTimer(conn);
    conn.setAvailable(true);

    this.log(`Connection ${poolIndex} created, job ${conn.jobName}`);
    this.emit('connection:created', { poolId: this.id, poolIndex, jobName: conn.jobName });

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
        throw new Error('RmPool: Failed to detachAll()', { cause: error });
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
      throw new Error('RmPool: Failed to retireAll()', { cause: error });
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
      throw new Error('RmPool: Failed to close()', { cause: error });
    }
    return true;
  }

  /**
   * Frees a connection (Returns the connection "Available" back to true)
   * @param {RmPoolConnection} connection
   * @returns {boolean} - true if detached successfully
   */
  async detach(connection: RmPoolConnection): Promise<boolean> {
    const index = connection.poolIndex;
    try {
      await connection.detach();
      this.setExpiryTimer(connection);
    } catch (error) {
      throw new Error('RmPool: Failed to detach()', { cause: error });
    }
    this.log(`Connection ${index} detached`);
    this.emit('connection:detached', { poolId: this.id, poolIndex: index });
    return true;
  }

  /**
   * Retires a connection from being used and removes it from the pool
   * @param {RmPoolConnection} connection
   */
  async retire(connection: RmPoolConnection): Promise<void> {
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
      this.log(`Failed to retire connection ${index}: ${error instanceof Error ? error.message : error}`, 'error');
      throw new Error(`RmPool: Failed to retire() Connection #${index}`, { cause: error });
    }
    this.log(`Connection ${index} retired`);
    this.emit('connection:retired', { poolId: this.id, poolIndex: index });
  }

  /**
   * Finds and returns the first available Connection.
   * Serialized via a promise-chain mutex to prevent concurrent callers
   * from claiming the same connection or creating duplicate connections.
   * @returns {RmPoolConnection} - one connection from the RmPool.
   */
  attach(): Promise<RmPoolConnection> {
    const result = this.attachQueue.then(() => this._attach());
    // Update the queue: whether _attach succeeds or fails, the next
    // caller should be allowed to proceed, so we swallow errors here.
    this.attachQueue = result.catch(() => {});
    return result;
  }

  /**
   * Internal implementation of attach(). Must only be called via
   * the serialized attach() method above.
   */
  private async _attach(): Promise<RmPoolConnection> {
    const size = this.incrementConnections.size!;
    let validConnection = false;
    let connection: RmPoolConnection | undefined;
    let i: number;
    let increasedPoolSize = false;
    let healthCheckRetries = 0;
    const maxHealthCheckRetries = this.maxSize;

    this.log('Finding available connection');
    while (!validConnection) {
      let healthCheckFailed = false;
      for (i = 0; i < this.connections.length; i += 1) {
        if (this.connections[i].isAvailable()) {
          this.cancelExpiryTimer(this.connections[i]);
          this.connections[i].setAvailable(false);

          // Health check: verify the connection is still alive
          if (this.healthCheckOnAttach) {
            const healthy = await this.connections[i].isHealthy();
            if (!healthy) {
              this.log(`Connection ${this.connections[i].poolIndex} failed health check, retiring`);
              this.emit('connection:healthCheckFailed', { poolId: this.id, poolIndex: this.connections[i].poolIndex });
              await this.retire(this.connections[i]);
              healthCheckRetries++;
              if (healthCheckRetries >= maxHealthCheckRetries) {
                throw new Error(`RmPool: All connections failed health check after ${healthCheckRetries} attempts`);
              }
              healthCheckFailed = true;
              break; // Restart search — splice shifted array indices
            } else {
              this.log(`Connection ${this.connections[i].poolIndex} is healthy`);
            }
          }

          validConnection = true;
          this.log(`Connection ${this.connections[i].poolIndex} found`);
          this.emit('connection:attached', { poolId: this.id, poolIndex: this.connections[i].poolIndex });
          return this.connections[i];
        }
      }
      if (healthCheckFailed) continue;

      this.log('No available connections found');

      let increasedConnections = 0;
      for (i = 0; i < size; i += 1) {
        if (this.connections.length >= this.maxSize) {
          const msg = `Maximum number of connections (${this.connections.length}) reached`;
          this.log(msg);
          this.emit('pool:exhausted', { poolId: this.id, maxSize: this.maxSize });
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

    throw new Error('RmPool: Unable to attach a connection');
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
  setExpiryTimer(conn: RmPoolConnection): void {
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
  cancelExpiryTimer(conn: RmPoolConnection): void {
    if (conn.expiryTimerId) {
      clearTimeout(conn.expiryTimerId);
      conn.expiryTimerId = null;

      this.log(`Connection ${conn.poolIndex} expiry timer cancelled`, 'debug');
    }
  }

  /**
   * Flags the connection as expired and retires it.
   */
  async setExpired(conn: RmPoolConnection): Promise<void> {
    conn.setAvailable(false);
    this.log(`Connection ${conn.poolIndex} expired`);
    this.emit('connection:expired', { poolId: this.id, poolIndex: conn.poolIndex });

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
      this.logger.log(type, `Pool: ${this.id} - ${message}`, { service: 'RmPool' });
    }
  }
}

export default RmPool;
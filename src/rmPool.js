const logger = require('../logger');
const rmPoolConnection = require('./rmPoolConnection');
const mapepire = require('@ibm/mapepire-js');

class rmPool {
  /**
   * Manages a list of rmPoolConnection instances.
   * Constructor to instantiate a new instance of a rmPool class given the `database` and `config`
   * @param {object} config - rmPool config object.
   * @param {object} debug - Boolean, display verbose output from the GBWebAPI application to the console.
   * @constructor
   */
  constructor(config, debug) {
    this.connections = [];

    // Set pool configuration
    this.id = config.id;
    this.config = config.config || {};
    let opts = this.config.PoolOptions || {};

    this.creds = opts.creds;
    this.maxSize = opts.maxSize || 20;
    this.initialConnections = opts.initialConnections || {};
    this.initialConnections.size = this.initialConnections.size || 8;
    this.initialConnections.expiry = this.initialConnections.expiry || null;
    this.incrementConnections = opts.incrementConnections || opts.initialConnections || {};
    this.incrementConnections.size = opts.incrementConnections.size || 8;
    this.incrementConnections.expiry = opts.incrementConnections.expiry || null;
    this.dbConnectorDebug = opts.dbConnectorDebug || false;
    this.JDBCOptions = opts.JDBCOptions || [];
    this.envvars = opts.envvars || [];
    this.debug = debug || false;
  }

  /**
   * Initializes the rmPool instance.
   */
  async init() {
    for (let i = 0; i < this.initialConnections.size; i += 1) {
      this.createConnection(this.initialConnections.expiry);
    }

    this.log(`Connection pool initialized`);
  }


  /**
   * Instantiates a new instance of rmPoolConnection with an `index` and appends it to the pool.
   * Assumes the database of the pool when establishing the connection.
   */
  async createConnection(expiry) {
    const conn = new rmPoolConnection(this.config);

    const poolIndex = this.connections.push(conn);

    await conn.init(poolIndex);
    conn.expiry = expiry;
    this.setExpiryTimer(conn);
    conn.setAvailable(true);

    this.log(`Connection ${poolIndex} created, job ${conn.jobName}`);

    return conn;
  }

  async newConnection(expiry) {
    let connection = mapepire.Pool.addJob();


  }

  /**
   * Frees all connections in the pool (Sets "Available" back to true for all)
   * closes any statements and gets a new statement.
   * @returns {boolean} - true if all were detached successfully
   */
  async detachAll() {
    for (let i = 0; i < this.connections.length; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.detach(connections[i]);
      } catch (error) {
        const reason = new Error('rmPool: Failed to detachAll()');
        reason.stack += `\nCaused By:\n ${error.stack}`;
        throw reason;
      }
    }

    return true;
  }

  /**
   * Retires (Removes) all connections from being used again
   * @returns {boolean} - true if all were retired successfully
   */
  async retireAll() {
    try {
      for (let i = 0; i < this.connections.length; i += 1) {
        this.retire(this.connections[i]);
      }
    } catch (error) {
      const reason = new Error('rmPool: Failed to retireAll()');
      reason.stack += `\nCaused By:\n ${error.stack}`;
      throw reason;
    }
    return true;
  }

  /**
   * Frees a connection (Returns the connection "Available" back to true)
   * @param {rmPoolConnection} connection
   * @returns {boolean} - true if detached successfully
   */
  async detach(connection) {
    const index = connection.poolIndex;
    try {
      await connection.detach();
      this.setExpiryTimer(connection);
    } catch (error) {
      const reason = new Error('rmPool: Failed to detach()');
      reason.stack += `\nCaused By:\n ${error.stack}`;
      throw reason;
    }
    this.log(`Connection ${index} detached`);
    return true;
  }

  /**
   * Retires a connection from being used and removes it from the pool
   * @param {rmPoolConnection} connection
   */
  async retire(connection) {
    const index = connection.poolIndex;

    try {
      this.cancelExpiryTimer(connection);
      await connection.retire();

      // Remove the connection from the pool
      this.connections.splice(index, 1);
    } catch (error) {
      console.dir(error,{ depth: 5 });
      const reason = new Error(`rmPool: Failed to retire() Connection #${index}`);
      reason.stack += `\nCaused By:\n ${error.stack}`;
      throw reason;
    }
    this.log(`Connection ${index} retired`);
  }

  /**
   * Finds and returns the first available Connection.
   * @returns {rmPoolConnection} - one connection from the rmPool.
   */
  async attach() {
    const size = this.incrementConnections.size;
    let validConnection = false;
    let connection;
    let i;
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
            throw(new Error(msg));
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

    return connection;
  }




  /**
   * Starts the expiry timer for the connection.
   */
  setExpiryTimer(conn) {
    this.cancelExpiryTimer(conn);

    if (conn.expiry && conn.expiry>0) {
      const milliseconds = conn.expiry*60*1000;
      conn.expiryTimerId = setTimeout(this.setExpired.bind(this), milliseconds, conn);

      this.log(`Connection ${conn.poolIndex} expiry timer set`,'debug');
    }
  }

  /**
   * Cancels the expiry timer for the connection.
   */
  cancelExpiryTimer(conn) {
    if (conn.expiryTimerId) {
      clearInterval(conn.expiryTimerId);
      conn.expiryTimerId = null;

      this.log(`Connection ${conn.poolIndex} expiry timer cancelled`,'debug');
    }
  }

  /**
   * Flags the connection as expired.
   */
  setExpired(conn) {
    conn.setAvailable(false);
    this.retire(conn);

    this.log(`Connection ${conn.poolIndex} expired`);
  }



  /**
   * Internal function used to log debug information to the console.
   * @param {string} message - the message to log.
   */
  log(message = '', type = 'debug') {
    if (type === 'debug') {
      if (this.debug) {
        logger.log('debug', `Pool ${this.id}: ${message}`, { service: 'rmPool' });
      }
    } else {
      logger.log(type, `Pool ${this.id}: ${message}`, { service: 'rmPool' });
    }
  }
}

module.exports = rmPool;

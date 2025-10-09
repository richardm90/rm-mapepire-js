const logger = require('../logger');
const mapepire = require('@ibm/mapepire-js');

/**
 * Uses and Extends the Connection class implemented in idb-pconnector.
 */
class rmPoolConnection {
  /**
   * @description
   * Instantiates a new instance of a rmPoolConnection class.
   * @param {object} pool - rmPool instance.
   */
  constructor(pool) {
    this.poolId = pool.id;
    this.poolIndex = null;
    this.creds = pool.PoolOptions.creds || {};
    this.debug = pool.PoolOptions.dbConnectorDebug || false;
    this.JDBCOptions = pool.PoolOptions.JDBCOptions || [];
    this.envvars = pool.PoolOptions.envvars || [];
    this.available = false;
    this.expiryTimerId = null;
  }

  /**
   * Initializes an instance of rmPoolConnection.
   */
  async init(poolIndex) {
    this.poolIndex = poolIndex;

    this.connection = new mapepire.SQLJob(this.JDBCOptions);

    if (this.connection.getStatus() === "notStarted") {
      await this.connection.connect(this.creds);
    }

    // Grab IBM i job name
    this.jobName = this.connection.id;

    this.log(`Initialized, job name=${this.jobName}`, 'info');

    // Output connection details in IBM i joblog
    let message = `${process.env.PROJECT_NAME}: PoolId=${this.poolId}, Connection=${this.poolIndex}`;
    await this.connection.execute(`CALL SYSTOOLS.LPRINTF('${message}')`);

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

  async query(sql, opts={}) {
    let result = await this.connection.execute(sql, opts);

    return result;
  }

  /**
   * Close the connection, making it available.
   * @returns {object} The detached connection.
   */
  async detach() {
    try {
      this.setAvailable(true);
    } catch (error) {
      const reason = new Error(`rmPoolConnection: failed to detach.`);
      reason.stack += `\nCaused By:\n ${error.stack}`;
      throw reason;
    }

    return this;
  }

  /**
   * Retire the connection, closes the connection.
   * @returns {boolean} True if retired.
   */
  async retire() {
    try {
      await this.close();
    } catch (error) {
      const reason = new Error(`rmPoolConnection: failed to retire.`);
      reason.stack += `\nCaused By:\n ${error.stack}`;
      throw reason;
    }

    return true;
  }

  /**
   * @returns {boolean} true if the connection is available , false if unavailable.
   */
  isAvailable() {
    return this.available;
  }

  /**
   *
   * @param {boolean} availability - true or false to set the availability flag of the connection.
   */
  setAvailable(availability) {
    this.available = availability;
  }

  /**
   * Internal function used to log debug information to the console.
   * @param {string} message - the message to log.
   */
  log(message = '', type = 'debug') {
    if (type === 'debug') {
      if (this.debug) {
        logger.log('debug', `Pool ${this.poolId} connection ${this.poolIndex}: ${message}`, { service: 'rmPoolConnection' });
      }
    } else {
      logger.log(type, `Pool ${this.poolId} connection ${this.poolIndex}: ${message}`, { service: 'rmPoolConnection' });
    }
  }
}

module.exports = rmPoolConnection;
import rmPool from './rmPool';
import rmPoolConnection from './rmPoolConnection';
import { PoolsConfig, PoolConfig, RegisteredPool } from './types';
import logger from './logger';

const MAX_POOLS = 8;

class rmPools {
  config: PoolsConfig;
  activate: boolean;
  debug: boolean;
  pools: RegisteredPool[];

  /**
   * Manages a list of rmPool instances.
   * Constructor to instantiate a new instance of a rmPools class
   * @param {object} config - Object includes `debug`.
   * @constructor
   */
  constructor(config: PoolsConfig = {}) {
    this.config = config;
    this.activate = this.config.activate ?? true;
    this.debug = this.config.debug || false;

    logger.log('info', `this.debug: ${this.debug}`, { service: 'rmPools' });

    this.pools = [];
  }

  /**
   * Initializes the rmPools instance.
   */
  async init(): Promise<void> {
    if (this.config.pools) {
      for (let i = 0; i < this.config.pools.length; i++) {
        await this.register(this.config.pools[i]);
      }
    }
  }

  /**
   * Registers a rmPool configuration.
   * @param {object} pool - The pool configuration to register.
   * @returns {boolean} - Indicates whether the pool was registered.
   */
  async register(poolToReg: PoolConfig): Promise<boolean> {
    const poolsLength = this.pools.length;

    for (let i = 0; i < poolsLength; i += 1) {
      if (this.pools[i].id === poolToReg.id) {
        this.log(`Unable to register pool as ${poolToReg.id} is already registered.`);
        return false;
      }
    }

    if (poolsLength >= MAX_POOLS - 1) {
      this.log(`Unable to register pool ${poolToReg.id} as the maximum number of pools has been reached.`);
      return false;
    }

    const pool: RegisteredPool = {
      id: poolToReg.id,
      config: poolToReg,
      active: false,
    };

    this.pools.push(pool);
    this.log(`Pool ${pool.id} registered`);

    if (this.activate) {
      await this.activatePool(pool);
    }

    return true;
  }

  /**
   * Gets and returns the rmPool instance for the given poolId.
   * - If the poolId is not passed then the first rmPool instance is returned.
   * - if the found pool has not been activated then it will be activated.
   * @param {string} poolId - Pool identifier to find and return
   * @returns {rmPool} - rmPool instance.
   */
  async get(poolId?: string): Promise<rmPool | null> {
    let pool: RegisteredPool;
    let i: number;

    if (this.pools.length < 1) {
      this.log(`No pools registered, pool ${poolId} not found`);
      return null;
    }

    if (!poolId) poolId = this.pools[0].id;

    this.log(`Finding pool ${poolId}`);
    for (i = 0; i < this.pools.length; i += 1) {
      pool = this.pools[i];

      if (pool.id === poolId) {
        this.log(`Pool ${poolId} (index=${i}) found`);
        if (!pool.active) await this.activatePool(pool);
        return pool.rmPool!;
      }
    }

    this.log(`Pool ${poolId} not found`);
    return null;
  }

  /**
   * Sanitize poolId, this method allows easier handling of a null poolId
   * - If the poolId is not passed then the first rmPool instance is returned.
   * @param {string} poolId - Pool identifier
   * @returns {string} poolId - Sanitized pool identifier
   */
  sanitizePoolId(poolId?: string): string | undefined {
    if (!poolId && this.pools.length > 0) {
      return this.pools[0].id;
    }
    return poolId;
  }

  /**
   * Simple wrapper around rmPool.attach() allowing additional debugging info.
   * @param {rmPool} pool - rmPool instance
   * @returns {rmPoolConnection} - rmPool connection instance.
   */
  async attach(pool: rmPool): Promise<rmPoolConnection> {
    const rmPoolConnectionInstance = await pool.attach();
    return rmPoolConnectionInstance;
  }

  /**
   * Simple wrapper for connection diagnostics.
   * @param {string} poolId - Pool identifier
   * @param {rmPoolConnection} dbconnection - rmPoolConnection instance
   * @param {string} sql - SQL statement
   */
  async connectionDiag(poolId: string | undefined, dbconnection: rmPoolConnection, sql: string): Promise<void> {
    this.log(`connectionDiag(): Data source=${this.sanitizePoolId(poolId)} Connection index=${dbconnection.poolIndex} Connection job name=${dbconnection.jobName} Sql=${sql}`);
  }

  /**
   * Internal function to activate a pool
   */
  async activatePool(pool: RegisteredPool): Promise<void> {
    pool.rmPool = new rmPool(pool, this.debug);
    await pool.rmPool.init();
    pool.active = true;
    this.log(`Pool ${pool.id} activated`, 'info');
  }

  /**
   * Internal function used to log debug information to the console.
   * @param {string} message - the message to log.
   */
  log(message: string = '', type: string = 'debug'): void {
    if (type !== 'debug' || this.debug) {
      logger.log(type, `${message}`, { service: 'rmPools' });
    }
  }
}

export { rmPools };
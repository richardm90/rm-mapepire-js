import RmPool from './rmPool';
import RmPoolConnection from './rmPoolConnection';
import { PoolsConfig, PoolConfig, RegisteredPool, Logger, LogLevel } from './types';
import defaultLogger, { RmLogger } from './logger';

const MAX_POOLS = 8;

class RmPools {
  config: PoolsConfig;
  activate: boolean;
  logLevel: LogLevel;
  pools: RegisteredPool[];
  logger: Logger;
  rmLogger: RmLogger;

  /**
   * Manages a list of RmPool instances.
   * Constructor to instantiate a new instance of a RmPools class
   * @param {object} config - Object includes `logLevel`.
   * @constructor
   */
  constructor(config: PoolsConfig = {}) {
    this.config = config;
    this.activate = this.config.activate ?? true;
    this.logLevel = this.config.logLevel || 'info';
    this.logger = this.config.logger || defaultLogger;
    this.rmLogger = new RmLogger(this.logger, this.logLevel, 'RmPools');

    this.pools = [];
  }

  /**
   * Initializes the RmPools instance.
   */
  async init(): Promise<void> {
    if (this.config.pools) {
      for (let i = 0; i < this.config.pools.length; i++) {
        await this.register(this.config.pools[i]);
      }
    }
  }

  /**
   * Registers a RmPool configuration.
   * @param {object} pool - The pool configuration to register.
   * @returns {boolean} - Indicates whether the pool was registered.
   */
  async register(poolToReg: PoolConfig): Promise<boolean> {
    const poolsLength = this.pools.length;

    for (let i = 0; i < poolsLength; i += 1) {
      if (this.pools[i].id === poolToReg.id) {
        this.rmLogger.debug(`Unable to register pool as ${poolToReg.id} is already registered.`);
        return false;
      }
    }

    if (poolsLength >= MAX_POOLS) {
      this.rmLogger.debug(`Unable to register pool ${poolToReg.id} as the maximum number of pools has been reached.`);
      return false;
    }

    const pool: RegisteredPool = {
      id: poolToReg.id,
      config: poolToReg,
      active: false,
    };

    this.pools.push(pool);
    this.rmLogger.debug(`Pool ${pool.id} registered`);

    if (this.activate) {
      await this.activatePool(pool);
    }

    return true;
  }

  /**
   * Gets and returns the RmPool instance for the given poolId.
   * - If the poolId is not passed then the first RmPool instance is returned.
   * - if the found pool has not been activated then it will be activated.
   * @param {string} poolId - Pool identifier to find and return
   * @returns {RmPool} - RmPool instance.
   */
  async get(poolId?: string): Promise<RmPool | null> {
    let pool: RegisteredPool;
    let i: number;

    if (this.pools.length < 1) {
      this.rmLogger.debug(`No pools registered, pool ${poolId} not found`);
      return null;
    }

    if (!poolId) poolId = this.pools[0].id;

    this.rmLogger.debug(`Finding pool ${poolId}`);
    for (i = 0; i < this.pools.length; i += 1) {
      pool = this.pools[i];

      if (pool.id === poolId) {
        this.rmLogger.debug(`Pool ${poolId} (index=${i}) found`);
        if (!pool.active) await this.activatePool(pool);
        return pool.rmPool!;
      }
    }

    this.rmLogger.debug(`Pool ${poolId} not found`);
    return null;
  }

  /**
   * Sanitize poolId, this method allows easier handling of a null poolId
   * - If the poolId is not passed then the first RmPool instance is returned.
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
   * Simple wrapper around RmPool.attach() allowing additional debugging info.
   * @param {RmPool} pool - RmPool instance
   * @returns {RmPoolConnection} - RmPool connection instance.
   */
  async attach(pool: RmPool): Promise<RmPoolConnection> {
    const connection = await pool.attach();
    return connection;
  }

  /**
   * Simple wrapper for connection diagnostics.
   * @param {string} poolId - Pool identifier
   * @param {RmPoolConnection} dbconnection - RmPoolConnection instance
   * @param {string} sql - SQL statement
   */
  async connectionDiag(poolId: string | undefined, dbconnection: RmPoolConnection, sql: string): Promise<void> {
    this.rmLogger.debug(`connectionDiag(): Data source=${this.sanitizePoolId(poolId)} Connection index=${dbconnection.poolIndex} Connection job name=${dbconnection.jobName} Sql=${sql}`);
  }

  /**
   * Get all pools information for debugging
   */
  getInfo(): object {
    return {
      totalPools: this.pools.length,
      activePools: this.pools.filter(p => p.active).length,
      pools: this.pools.map(p => ({
        id: p.id,
        active: p.active,
        ...(p.rmPool ? (p.rmPool.getStats() as object) : {}),
      })),
    };
  }

  /**
   * Print all pools info to console
   */
  printInfo(): void {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║         POOLS OVERVIEW                 ║');
    console.log('╚════════════════════════════════════════╝\n');

    const info = this.getInfo() as any;
    console.log(`Total Pools: ${info.totalPools}`);
    console.log(`Active Pools: ${info.activePools}\n`);

    this.pools.forEach((pool, idx) => {
      console.log(`\n[${idx}] Pool: ${pool.id} (${pool.active ? 'ACTIVE' : 'INACTIVE'})`);
      if (pool.active && pool.rmPool) {
        pool.rmPool.printInfo();
      }
    });
  }

  /**
   * Print summary statistics for all pools
   */
  printStats(): void {
    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│         POOLS STATISTICS                │');
    console.log('└─────────────────────────────────────────┘');

    this.pools.forEach(pool => {
      if (pool.active && pool.rmPool) {
        pool.rmPool.printStats();
      }
    });
    console.log('');
  }

  /**
   * Closes all active pools and marks them as inactive.
   * Each pool's connections are retired (closed on the server).
   * @returns {boolean} - true if all pools were closed successfully.
   */
  async close(): Promise<boolean> {
    for (let i = 0; i < this.pools.length; i++) {
      const pool = this.pools[i];
      if (pool.active && pool.rmPool) {
        await pool.rmPool.close();
        pool.active = false;
        this.rmLogger.info(`Pool ${pool.id} closed`);
      }
    }
    return true;
  }

  /**
   * Internal function to activate a pool
   */
  async activatePool(pool: RegisteredPool): Promise<void> {
    pool.rmPool = new RmPool(pool, this.logLevel, this.logger);
    await pool.rmPool.init();
    pool.active = true;
    this.rmLogger.info(`Pool ${pool.id} activated`);
  }
}

export { RmPools };

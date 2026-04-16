import { JDBCOptions, DaemonServer } from '@ibm/mapepire-js';
import { InitCommand, QueryOptions, Logger, LogLevel, RmQueryResult, BackendType, RmConnectionOptions } from './types';
import defaultLogger, { RmLogger } from './logger';
import { BackendConnection } from './backends/types';
import { MapepireBackend } from './backends/mapepire';

/**
 * Unified DB2 connection supporting mapepire (remote) and idb-pconnector (native) backends.
 */
class RmConnection {
  creds?: DaemonServer;
  logLevel: LogLevel;
  JDBCOptions: JDBCOptions;
  initCommands: InitCommand[];
  available: boolean;
  jobName?: string;
  logger: Logger;
  keepalive: number | null;
  backend: BackendType;
  multiplex: boolean;
  private backendImpl!: BackendConnection;
  private keepaliveTimerId: NodeJS.Timeout | null;
  rmLogger: RmLogger;

  constructor(opts: RmConnectionOptions) {
    this.creds = opts.creds;
    this.JDBCOptions = opts.JDBCOptions || {};
    this.initCommands = opts.initCommands || [];
    this.available = false;
    this.logLevel = opts.logLevel || 'info';
    this.logger = opts.logger || defaultLogger;
    this.keepalive = opts.keepalive ?? null;
    this.backend = opts.backend || 'auto';
    this.multiplex = opts.multiplex ?? false;
    this.keepaliveTimerId = null;
    this.rmLogger = new RmLogger(this.logger, this.logLevel, 'RmConnection');
  }

  private resolveBackend(): 'mapepire' | 'idb' {
    if (this.backend === 'auto') {
      return (process.platform as string) === 'os400' ? 'idb' : 'mapepire';
    }
    return this.backend;
  }

  async init(suppressConnectionMessage: boolean = false): Promise<void> {
    this.backend = this.resolveBackend();

    if (this.multiplex && this.backend === 'idb') {
      throw new Error('RmConnection: multiplex mode is not supported with the idb backend (idb is single-threaded shared-memory IPC; use the mapepire backend for multiplexing)');
    }

    if (this.backend === 'idb') {
      const { IdbBackend } = require('./backends/idb');
      this.backendImpl = new IdbBackend(this.JDBCOptions, this.initCommands, this.rmLogger);
      // Auto-disable keepalive for idb (no WebSocket to keep alive)
      this.keepalive = null;
    } else {
      if (!this.creds) {
        throw new Error('RmConnection: creds are required for the mapepire backend');
      }
      this.backendImpl = new MapepireBackend(this.creds, this.JDBCOptions, this.initCommands, this.rmLogger);
    }

    await this.backendImpl.init(suppressConnectionMessage);

    this.jobName = this.backendImpl.getJobName();
    this.rmLogger.setPrefix(`Job: ${this.jobName}`);

    this.startKeepalive();
  }

  async execute(sql: string, opts: QueryOptions = {}): Promise<RmQueryResult<any>> {
    this.resetKeepalive();
    return this.backendImpl.execute(sql, opts);
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<RmQueryResult<any>> {
    return this.backendImpl.execute(sql, opts);
  }

  async close(): Promise<void> {
    this.stopKeepalive();
    await this.backendImpl.close();
  }

  private startKeepalive(): void {
    if (this.keepalive && this.keepalive > 0) {
      const ms = this.keepalive * 60 * 1000;
      this.keepaliveTimerId = setInterval(() => this.ping(), ms);
      this.rmLogger.debug(`Keepalive started (${this.keepalive} min)`);
    }
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimerId) {
      clearInterval(this.keepaliveTimerId);
      this.keepaliveTimerId = null;
      this.rmLogger.debug(`Keepalive stopped`);
    }
  }

  private resetKeepalive(): void {
    if (this.keepaliveTimerId) {
      this.stopKeepalive();
      this.startKeepalive();
    }
  }

  private async ping(): Promise<void> {
    try {
      await this.backendImpl.execute('VALUES 1');
      this.rmLogger.debug(`Keepalive ping OK`);
    } catch (error) {
      this.rmLogger.error(`Keepalive ping failed: ${error}`);
      this.stopKeepalive();
    }
  }

  getStatus(): string {
    return this.backendImpl.getStatus();
  }

  getInfo(): object {
    return {
      jobName: this.jobName,
      backend: this.backend,
      available: this.available,
      status: this.backendImpl?.getStatus(),
    };
  }

  printInfo(): void {
    console.log('Connection Info:', JSON.stringify(this.getInfo(), null, 2));
  }
}

export default RmConnection;

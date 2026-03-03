import { SQLJob, JDBCOptions, DaemonServer, States } from '@ibm/mapepire-js';
import { InitCommand, QueryOptions, Logger, RmQueryResult } from './types';
import defaultLogger from './logger';

/**
 * Uses and Extends the Connection class implemented in idb-pconnector.
 */
class RmConnection {
  creds: DaemonServer;
  debug: boolean;
  JDBCOptions: JDBCOptions;
  initCommands: InitCommand[];
  available: boolean;
  job!: SQLJob;
  jobName?: string;
  logger: Logger;
  keepalive: number | null;
  private keepaliveTimerId: NodeJS.Timeout | null;

  /**
   * @description
   * Instantiates a new instance of a RmConnection class.
   * @param {object} creds - connection credentials
   * @param {object} JDBCOptions - JDBCOptions
   * @param {object} initCommands - commands to run on connection init
   * @param {boolean} debug - debug
   * @param {Logger} logger - logger
   * @param {number|null} keepalive - interval in minutes to send keepalive pings (null = disabled)
   */
  constructor(creds: DaemonServer, JDBCOptions: JDBCOptions, initCommands: InitCommand[] = [], debug: boolean = false, logger?: Logger, keepalive?: number | null) {
    this.creds = creds || {};
    this.JDBCOptions = JDBCOptions || {};
    this.initCommands = initCommands || [];
    this.available = false;
    this.debug = debug || false;
    this.logger = logger || defaultLogger;
    this.keepalive = keepalive ?? null;
    this.keepaliveTimerId = null;
  }

  /**
   * Initializes an instance of RmConnection.
   */
  async init(suppressConnectionMessage: boolean = false): Promise<void> {
    this.job = new SQLJob(this.JDBCOptions);

    if (this.job.getStatus() === States.JobStatus.NOT_STARTED) {
      await this.job.connect(this.creds);
    }

    // Grab IBM i job name
    this.jobName = this.job.id;

    if (!suppressConnectionMessage)
      this.log(`Connected`, 'info');

    // Execute init commands on the connection (IBM i job)
    for (let i = 0; i < this.initCommands.length; i += 1) {
      const { command, type = 'cl' } = this.initCommands[i];
      if (command) {
        if (type === 'sql') {
          await this.job.execute(command);
        } else {
          await this.job.execute(`CALL QSYS2.QCMDEXC(?)`, { parameters: [command] });
        }
        this.log(`Executed init command (${type}): ${command}`, 'debug');
      }
    }

    this.startKeepalive();
  }

  async execute(sql: string, opts: QueryOptions = {}): Promise<RmQueryResult<any>> {
    this.resetKeepalive();
    const result = await this.job.execute(sql, opts);
    return { ...result, job: this.jobName! };
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<RmQueryResult<any>> {
    const result = await this.job.execute(sql, opts);
    return { ...result, job: this.jobName! };
  }

  /**
   * Retire the connection, closes the connection.
   * @returns {boolean} True if retired.
   */
  async close(): Promise<void> {
    this.stopKeepalive();
    await this.job.close();
  }

  /**
   * Starts the keepalive timer. Sends a lightweight query at regular
   * intervals to prevent idle WebSocket connections from being dropped
   * by firewalls or network intermediaries.
   */
  private startKeepalive(): void {
    if (this.keepalive && this.keepalive > 0) {
      const ms = this.keepalive * 60 * 1000;
      this.keepaliveTimerId = setInterval(() => this.ping(), ms);
      this.log(`Keepalive started (${this.keepalive} min)`, 'debug');
    }
  }

  /**
   * Stops the keepalive timer.
   */
  private stopKeepalive(): void {
    if (this.keepaliveTimerId) {
      clearInterval(this.keepaliveTimerId);
      this.keepaliveTimerId = null;
      this.log(`Keepalive stopped`, 'debug');
    }
  }

  /**
   * Resets the keepalive timer. Called when real traffic is sent,
   * so the next keepalive ping is deferred by a full interval.
   */
  private resetKeepalive(): void {
    if (this.keepaliveTimerId) {
      this.stopKeepalive();
      this.startKeepalive();
    }
  }

  /**
   * Sends a lightweight query to keep the connection alive.
   * If the ping fails, the timer is stopped — the pool's
   * health-check-on-attach will handle retirement.
   */
  private async ping(): Promise<void> {
    try {
      await this.job.execute('VALUES 1');
      this.log(`Keepalive ping OK`, 'debug');
    } catch (error) {
      this.log(`Keepalive ping failed: ${error}`, 'error');
      this.stopKeepalive();
    }
  }

  /**
   * Retrieves the current status of the job.
   *
   * @returns The current status of the job.
   */
  getStatus(): States.JobStatus {
    return this.job.getStatus();
  }

  /**
   * Get connection information for debugging
   */
  getInfo(): object {
    return {
      jobName: this.jobName,
      available: this.available,
      status: this.job?.getStatus(),
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
      this.logger.log(type, `Job: ${this.jobName} - ${message}`, { service: 'RmConnection' });
    }
  }
}

export default RmConnection;
import { SQLJob, JDBCOptions, DaemonServer, States } from '@ibm/mapepire-js';
import { InitCommand, QueryOptions, Logger, LogLevel, RmQueryResult } from './types';
import defaultLogger, { RmLogger } from './logger';

/**
 * Uses and Extends the Connection class implemented in idb-pconnector.
 */
class RmConnection {
  creds: DaemonServer;
  logLevel: LogLevel;
  JDBCOptions: JDBCOptions;
  initCommands: InitCommand[];
  available: boolean;
  job!: SQLJob;
  jobName?: string;
  logger: Logger;
  keepalive: number | null;
  private keepaliveTimerId: NodeJS.Timeout | null;
  rmLogger: RmLogger;

  /**
   * @description
   * Instantiates a new instance of a RmConnection class.
   * @param {object} creds - connection credentials
   * @param {object} JDBCOptions - JDBCOptions
   * @param {object} initCommands - commands to run on connection init
   * @param {LogLevel} logLevel - log level
   * @param {Logger} logger - logger
   * @param {number|null} keepalive - interval in minutes to send keepalive pings (null = disabled)
   */
  constructor(creds: DaemonServer, JDBCOptions: JDBCOptions, initCommands: InitCommand[] = [], logLevel: LogLevel = 'info', logger?: Logger, keepalive?: number | null) {
    this.creds = creds || {};
    this.JDBCOptions = JDBCOptions || {};
    this.initCommands = initCommands || [];
    this.available = false;
    this.logLevel = logLevel;
    this.logger = logger || defaultLogger;
    this.keepalive = keepalive ?? null;
    this.keepaliveTimerId = null;
    this.rmLogger = new RmLogger(this.logger, this.logLevel, 'RmConnection');
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
    this.rmLogger.setPrefix(`Job: ${this.jobName}`);

    if (!suppressConnectionMessage)
      this.rmLogger.info(`Connected`);

    // Execute init commands on the connection (IBM i job)
    for (let i = 0; i < this.initCommands.length; i += 1) {
      const { command, type = 'cl' } = this.initCommands[i];
      if (command) {
        if (type === 'sql') {
          await this.job.execute(command);
        } else {
          await this.job.execute(`CALL QSYS2.QCMDEXC(?)`, { parameters: [command] });
        }
        this.rmLogger.debug(`Executed init command (${type}): ${command}`);
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
      this.rmLogger.debug(`Keepalive started (${this.keepalive} min)`);
    }
  }

  /**
   * Stops the keepalive timer.
   */
  private stopKeepalive(): void {
    if (this.keepaliveTimerId) {
      clearInterval(this.keepaliveTimerId);
      this.keepaliveTimerId = null;
      this.rmLogger.debug(`Keepalive stopped`);
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
      this.rmLogger.debug(`Keepalive ping OK`);
    } catch (error) {
      this.rmLogger.error(`Keepalive ping failed: ${error}`);
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
}

export default RmConnection;

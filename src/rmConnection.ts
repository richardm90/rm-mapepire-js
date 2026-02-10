import { SQLJob, JDBCOptions, DaemonServer, States } from '@ibm/mapepire-js';
import { InitCommand, QueryOptions, Logger } from './types';
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

  /**
   * @description
   * Instantiates a new instance of a RmConnection class.
   * @param {object} creds - connection credentials
   * @param {object} JDBCOptions - JDBCOptions
   * @param {object} initCommands - commands to run on connection init
   * @param {object} debug - debug
   */
  constructor(creds: DaemonServer, JDBCOptions: JDBCOptions, initCommands: InitCommand[] = [], debug: boolean = false, logger?: Logger) {
    this.creds = creds || {};
    this.JDBCOptions = JDBCOptions || {};
    this.initCommands = initCommands || [];
    this.available = false;
    this.debug = debug || false;
    this.logger = logger || defaultLogger;
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
  }

  async execute(sql: string, opts: QueryOptions = {}): Promise<any> {
    const result = await this.job.execute(sql, opts);
    return result;
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<any> {
    const result = await this.job.execute(sql, opts);
    return result;
  }

  /**
   * Retire the connection, closes the connection.
   * @returns {boolean} True if retired.
   */
  async close(): Promise<void> {
    await this.job.close();
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
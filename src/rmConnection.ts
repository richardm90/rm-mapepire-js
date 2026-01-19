import { SQLJob, JDBCOptions, DaemonServer, States } from '@ibm/mapepire-js';
import { PoolConfig, EnvVar, QueryOptions } from './types';
import logger from './logger';

/**
 * Uses and Extends the Connection class implemented in idb-pconnector.
 */
class rmConnection {
  creds: DaemonServer;
  debug: boolean;
  JDBCOptions: JDBCOptions;
  envvars: EnvVar[];
  available: boolean;
  job!: SQLJob;
  jobName?: string;

  /**
   * @description
   * Instantiates a new instance of a rmConnection class.
   * @param {object} cred - connection credentials
   * @param {object} JDBCOptions - JDBCOptions
   * @param {object} envvars - envvars
   * @param {object} debug - debug
   */
  constructor(creds: DaemonServer, JDBCOptions: JDBCOptions, envvars: EnvVar[] = [], debug: boolean = false) {
    this.creds = creds || {};
    this.JDBCOptions = JDBCOptions || {};
    this.envvars = envvars || [];
    this.available = false;
    this.debug = debug || false;
  }

  /**
   * Initializes an instance of rmConnection.
   */
  async init(): Promise<void> {
    this.job = new SQLJob(this.JDBCOptions);

    if (this.job.getStatus() === States.JobStatus.NOT_STARTED) {
      await this.job.connect(this.creds);
    }

    // Grab IBM i job name
    this.jobName = this.job.id;

    this.log(`Connected, job name=${this.jobName}`, 'info');

    // Set connection (IBM i job) environment variables
    for (let i = 0; i < this.envvars.length; i += 1) {
      const { envvar = null, value = null } = this.envvars[i];
      if (envvar !== null && value !== null) {
        await this.job.execute(`CALL QSYS2.QCMDEXC('ADDENVVAR ENVVAR(${envvar}) VALUE(''${value}'')')`);
        this.log(`Set environment variable: ${envvar}=${value}`, 'debug');
      }
    }

    // Initialize IBM i job environment
    // - Uses GB System signon program
    // TODO: sort out initial program and library list
    // TODO: await this.connection.execute(`CALL QSYS2.QCMDEXC('CALL PGM(GBSSIGNWB)')`);
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
      logger.log(type, `Job: ${this.jobName} - ${message}`, { service: 'rmConnection' });
    }
  }
}

export default rmConnection;
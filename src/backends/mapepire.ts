import { SQLJob, JDBCOptions, DaemonServer, States } from '@ibm/mapepire-js';
import { BackendConnection } from './types';
import { InitCommand, QueryOptions, RmQueryResult } from '../types';
import { RmLogger } from '../logger';

export class MapepireBackend implements BackendConnection {
  private job!: SQLJob;
  private jobName?: string;
  private creds: DaemonServer;
  private JDBCOptions: JDBCOptions;
  private initCommands: InitCommand[];
  private rmLogger: RmLogger;

  constructor(creds: DaemonServer, JDBCOptions: JDBCOptions, initCommands: InitCommand[], rmLogger: RmLogger) {
    this.creds = creds;
    this.JDBCOptions = JDBCOptions;
    this.initCommands = initCommands;
    this.rmLogger = rmLogger;
  }

  async init(suppressConnectionMessage: boolean = false): Promise<void> {
    // Caller-wins-default-fills: inject ISO-leaning format defaults when the
    // caller hasn't set them, so both backends return consistently formatted
    // date/time values. Spread order ensures caller values always win.
    const FORMAT_DEFAULTS: Partial<JDBCOptions> = {
      'date format': 'iso',
      'date separator': '/',
      'time format': 'iso',
      'time separator': ':',
    };
    const effectiveOptions: JDBCOptions = { ...FORMAT_DEFAULTS, ...this.JDBCOptions };
    for (const key of Object.keys(FORMAT_DEFAULTS) as (keyof JDBCOptions)[]) {
      const fromCaller = (this.JDBCOptions as any)[key] !== undefined;
      this.rmLogger.debug(`Set ${key}: ${(effectiveOptions as any)[key]}${fromCaller ? '' : ' (default)'}`);
    }
    this.job = new SQLJob(effectiveOptions);

    if (this.job.getStatus() === States.JobStatus.NOT_STARTED) {
      await this.job.connect(this.creds);
    }

    this.jobName = this.job.id;

    if (!suppressConnectionMessage)
      this.rmLogger.info(`Connected (mapepire-js)`);

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
  }

  async execute(sql: string, opts: QueryOptions = {}): Promise<RmQueryResult<any>> {
    const result = await this.job.execute(sql, opts);
    return { ...result, job: this.jobName! };
  }

  async close(): Promise<void> {
    await this.job.close();
  }

  getJobName(): string | undefined {
    return this.jobName;
  }

  getStatus(): string {
    return this.job.getStatus();
  }
}

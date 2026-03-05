import { BackendConnection } from './types';
import { InitCommand, QueryOptions, RmQueryResult } from '../types';
import { RmLogger } from '../logger';

// idb-pconnector types (loaded dynamically)
interface IdbConnection {
  dbconn: {
    setConnAttr(attr: number, value: number): void;
  };
  getStatement(): IdbStatement;
  disconn(): void;
  close(): void;
}

interface IdbStatement {
  exec(sql: string): Promise<any[]>;
  prepare(sql: string): Promise<void>;
  bindParameters(params: any[]): Promise<void>;
  execute(): Promise<void>;
  fetchAll(): Promise<any[]>;
  enableNumericTypeConversion(enable: boolean): void;
  numRows(): number;
  numFields(): number;
  fieldName(index: number): string;
  fieldType(index: number): number;
  close(): void;
}

// SQL_ATTR_COMMIT constants
const SQL_ATTR_COMMIT = 0;
const SQL_TXN_NO_COMMIT = 0;

export class IdbBackend implements BackendConnection {
  private conn!: IdbConnection;
  private jobName?: string;
  private initCommands: InitCommand[];
  private JDBCOptions: Record<string, any>;
  private rmLogger: RmLogger;
  private status: string = 'notStarted';
  private queryCounter: number = 0;
  private IdbModule: any;

  constructor(JDBCOptions: Record<string, any>, initCommands: InitCommand[], rmLogger: RmLogger) {
    this.JDBCOptions = JDBCOptions;
    this.initCommands = initCommands;
    this.rmLogger = rmLogger;
  }

  async init(suppressConnectionMessage: boolean = false): Promise<void> {
    // Dynamically load idb-pconnector
    try {
      this.IdbModule = require('idb-pconnector');
    } catch (e) {
      throw new Error(
        'idb-pconnector is not available. This backend only works on IBM i. ' +
        'Use backend: "mapepire" for remote connections.'
      );
    }

    const { Connection } = this.IdbModule;
    this.conn = new Connection({ url: '*LOCAL' });
    this.status = 'connecting';

    // Must set commit mode before any statement creation
    this.conn.dbconn.setConnAttr(SQL_ATTR_COMMIT, SQL_TXN_NO_COMMIT);

    this.status = 'ready';

    if (!suppressConnectionMessage)
      this.rmLogger.info(`Connected (idb-pconnector)`);

    // Handle JDBCOptions mappings
    await this.applyJDBCOptions();

    // Execute init commands
    for (let i = 0; i < this.initCommands.length; i += 1) {
      const { command, type = 'cl' } = this.initCommands[i];
      if (command) {
        if (type === 'sql') {
          await this.execSimple(command);
        } else {
          await this.execParameterized(`CALL QSYS2.QCMDEXC(?)`, [command]);
        }
        this.rmLogger.debug(`Executed init command (${type}): ${command}`);
      }
    }

    // Get job name
    const result = await this.execSimple('VALUES QSYS2.JOB_NAME');
    if (result.length > 0) {
      const row = result[0];
      this.jobName = row[Object.keys(row)[0]];
    }
  }

  async execute(sql: string, opts: QueryOptions = {}): Promise<RmQueryResult<any>> {
    const startTime = performance.now();
    let data: any[];
    let updateCount = 0;

    try {
      if (opts.parameters && opts.parameters.length > 0) {
        data = await this.execParameterized(sql, opts.parameters);
      } else {
        data = await this.execSimple(sql);
      }

      // Trim string values to match mapepire behaviour
      data = data.map(row => {
        const trimmed: Record<string, any> = {};
        for (const key of Object.keys(row)) {
          trimmed[key] = typeof row[key] === 'string' ? row[key].trim() : row[key];
        }
        return trimmed;
      });

      const executionTime = performance.now() - startTime;
      this.queryCounter++;

      return {
        success: true,
        data,
        has_results: data.length > 0,
        is_done: true,
        update_count: updateCount,
        sql_rc: 0,
        sql_state: '00000',
        execution_time: executionTime,
        id: String(this.queryCounter),
        job: this.jobName!,
        metadata: null as any,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.queryCounter++;
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      this.conn.disconn();
      this.conn.close();
    } catch (e) {
      // Ignore close errors
    }
    this.status = 'ended';
  }

  getJobName(): string | undefined {
    return this.jobName;
  }

  getStatus(): string {
    return this.status;
  }

  private async execSimple(sql: string): Promise<any[]> {
    const stmt = this.conn.getStatement();
    try {
      stmt.enableNumericTypeConversion(true);
      const result = await stmt.exec(sql);
      return result;
    } finally {
      stmt.close();
    }
  }

  private async execParameterized(sql: string, params: any[]): Promise<any[]> {
    const stmt = this.conn.getStatement();
    try {
      stmt.enableNumericTypeConversion(true);
      await stmt.prepare(sql);
      await stmt.bindParameters(params);
      await stmt.execute();
      const result = await stmt.fetchAll();
      return result;
    } finally {
      stmt.close();
    }
  }

  private async applyJDBCOptions(): Promise<void> {
    const opts = this.JDBCOptions as any;

    if (opts.libraries) {
      const libs = Array.isArray(opts.libraries) ? opts.libraries : [opts.libraries];
      if (libs.length > 0) {
        const pathList = ['SYSTEM PATH', ...libs].join(', ');
        await this.execSimple(`SET PATH = ${pathList}`);
        this.rmLogger.debug(`Set library path: ${pathList}`);
      }
    }

    if (opts.naming) {
      const naming = opts.naming === 'system' ? '*SYS' : '*SQL';
      await this.execSimple(`SET OPTION NAMING = ${naming}`);
      this.rmLogger.debug(`Set naming: ${naming}`);
    }

    // Log warnings for other JDBC options that don't map to idb
    const mappedKeys = ['libraries', 'naming'];
    for (const key of Object.keys(opts)) {
      if (!mappedKeys.includes(key)) {
        this.rmLogger.debug(`JDBCOption '${key}' is not supported by idb backend, ignoring`);
      }
    }
  }
}

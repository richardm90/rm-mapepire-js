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

// SQL_ATTR_COMMIT and SQL_TXN_NO_COMMIT are loaded dynamically from
// idb-pconnector (re-exported from idb-connector) to avoid hardcoding values.

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

    const { Connection, SQL_ATTR_COMMIT, SQL_TXN_NO_COMMIT } = this.IdbModule;
    this.conn = new Connection({ url: '*LOCAL' });
    this.status = 'connecting';

    // Disable commitment control before any statement creation
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
    let outputParms: any[] | null = null;
    let updateCount = 0;

    try {
      if (opts.parameters && opts.parameters.length > 0) {
        const result = await this.execParameterized(sql, opts.parameters);
        data = result.data;
        outputParms = result.outputParms;
      } else {
        data = await this.execSimple(sql);
      }

      // Trim string values to match mapepire behaviour
      data = data.map(row => {
        const trimmed: Record<string, any> = {};
        for (const key of Object.keys(row)) {
          trimmed[key] = typeof row[key] === 'string' ? row[key].trimEnd() : row[key];
        }
        return trimmed;
      });

      const executionTime = performance.now() - startTime;
      this.queryCounter++;

      const result: RmQueryResult<any> = {
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

      // Include output parameters if returned (e.g. from stored procedures)
      if (outputParms) {
        (result as any).output_parms = outputParms.map((value, i) => ({
          index: i + 1,
          value: typeof value === 'string' ? value.trimEnd() : value,
        }));
      }

      return result;
    } catch (error) {
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

  private async execParameterized(sql: string, params: any[]): Promise<{ data: any[]; outputParms: any[] | null }> {
    const stmt = this.conn.getStatement();
    try {
      stmt.enableNumericTypeConversion(true);
      await stmt.prepare(sql);
      await stmt.bindParameters(params);
      // execute() returns output parameters as an array at runtime, but is typed as void
      const outputParms = (await stmt.execute() as any) || null;
      let data: any[];
      try {
        data = await stmt.fetchAll();
      } catch (e: any) {
        // Statements like CALL QSYS2.QCMDEXC(?) don't produce a result set
        if (e?.message?.includes('no result set') || e?.sqlcode === 8014) {
          data = [];
        } else {
          throw e;
        }
      }
      return { data, outputParms };
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
        // Use prepare/execute path for SET statements (stmt.exec rejects some SET variants)
        await this.execParameterized(`SET PATH = ${pathList}`, []);
        this.rmLogger.debug(`Set library path: ${pathList}`);
      }
    }

    if (opts.naming) {
      // SET OPTION NAMING is not allowed via exec() or prepare()/execute() in idb-pconnector.
      // Use setConnAttr with SQL_ATTR_DBC_SYS_NAMING instead.
      const SQL_ATTR_DBC_SYS_NAMING = this.IdbModule.SQL_ATTR_DBC_SYS_NAMING ?? 0x10012;
      const value = opts.naming === 'system' ? 1 : 0;
      this.conn.dbconn.setConnAttr(SQL_ATTR_DBC_SYS_NAMING, value);
      this.rmLogger.debug(`Set naming: ${opts.naming === 'system' ? '*SYS' : '*SQL'}`);
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

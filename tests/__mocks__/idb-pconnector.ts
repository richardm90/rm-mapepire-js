// Manual mock for idb-pconnector

class MockStatement {
  private numericConversion = false;

  async exec(sql: string): Promise<any[]> {
    if (sql === 'VALUES QSYS2.JOB_NAME') {
      return [{ '00001': '123456/QUSER/QZDASOINIT' }];
    }
    return [];
  }

  async prepare(_sql: string): Promise<void> {}
  async bindParameters(_params: any[]): Promise<void> {}
  async execute(): Promise<void> {}
  async fetchAll(): Promise<any[]> { return []; }
  enableNumericTypeConversion(enable: boolean): void { this.numericConversion = enable; }
  numRows(): number { return 0; }
  numFields(): number { return 0; }
  fieldName(_index: number): string { return ''; }
  fieldType(_index: number): number { return 0; }
  close(): void {}
}

export class Connection {
  constructor(_opts?: any) {}

  setConnAttr(_attr: number, _value: number): void {}
  connect(_url?: string, _username?: string, _password?: string): any { return this; }
  getStatement(): MockStatement { return new MockStatement(); }
  disconn(): void {}
  close(): void {}
}

// ODBC constants (matching idb-connector values)
export const SQL_ATTR_COMMIT = 0;
export const SQL_TXN_NO_COMMIT = 0;
export const SQL_TXN_READ_UNCOMMITTED = 1;
export const SQL_TXN_READ_COMMITTED = 2;
export const SQL_TXN_REPEATABLE_READ = 4;
export const SQL_TXN_SERIALIZABLE = 8;
export const SQL_ATTR_AUTOCOMMIT = 10003;
export const SQL_TRUE = 1;
export const SQL_FALSE = 0;
export const SQL_ATTR_DBC_SYS_NAMING = 0x10012;

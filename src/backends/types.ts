import { QueryOptions, RmQueryResult } from '../types';

export interface BackendConnection {
  init(suppressConnectionMessage?: boolean): Promise<void>;
  execute(sql: string, opts?: QueryOptions): Promise<RmQueryResult<any>>;
  close(): Promise<void>;
  getJobName(): string | undefined;
  getStatus(): string;
}

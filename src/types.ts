import { JDBCOptions, DaemonServer } from '@ibm/mapepire-js';
import type RmPool from './rmPool';

export { JDBCOptions, DaemonServer };

export interface InitCommand {
  command: string;
  type?: 'cl' | 'sql';
}

export interface InitialConnections {
  size?: number;
  expiry?: number | null;
}

export interface IncrementConnections {
  size?: number;
  expiry?: number | null;
}

export interface HealthCheckConfig {
  onAttach?: boolean;  // Verify connection is alive before returning from attach() (default: true)
}

export interface PoolOptions {
  creds: DaemonServer;
  maxSize?: number;
  initialConnections?: InitialConnections;
  incrementConnections?: IncrementConnections;
  dbConnectorDebug?: boolean;
  JDBCOptions?: JDBCOptions;
  initCommands?: InitCommand[];
  healthCheck?: HealthCheckConfig;
  logger?: Logger;
}

export interface PoolConfig {
  id: string;
  PoolOptions: PoolOptions;
}

export interface RegisteredPool {
  id: string;
  config: PoolConfig;
  active: boolean;
  rmPool?: RmPool;
}

export interface PoolsConfig {
  activate?: boolean;
  debug?: boolean;
  pools?: PoolConfig[];
  logger?: Logger;
}

export interface QueryOptions {
  [key: string]: any;
}

export interface Logger {
  log(level: string, message: string, meta?: any): void;
}
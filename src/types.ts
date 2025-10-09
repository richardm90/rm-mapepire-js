import { JDBCOptions, DaemonServer } from '@ibm/mapepire-js';

export interface EnvVar {
  envvar: string | null;
  value: string | null;
}

export interface InitialConnections {
  size?: number;
  expiry?: number | null;
}

export interface IncrementConnections {
  size?: number;
  expiry?: number | null;
}

export interface PoolOptions {
  creds: DaemonServer;
  maxSize?: number;
  initialConnections?: InitialConnections;
  incrementConnections?: IncrementConnections;
  dbConnectorDebug?: boolean;
  jdbcOptions?: JDBCOptions;
  envvars?: EnvVar[];
}

export interface PoolConfig {
  id: string;
  PoolOptions: PoolOptions;
}

export interface RegisteredPool {
  id: string;
  config: PoolConfig;
  active: boolean;
  rmPool?: any; // Will be typed as rmPool once imported
}

export interface PoolsConfig {
  activate?: boolean;
  debug?: boolean;
  pools?: PoolConfig[];
}

export interface QueryOptions {
  [key: string]: any;
}

export interface Logger {
  log(level: string, message: string, meta?: any): void;
}
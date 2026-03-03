import { Logger, LogLevel } from './types';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  none: 0,
  error: 1,
  info: 2,
  debug: 3,
};

export class RmLogger {
  private logger: Logger;
  private logLevel: LogLevel;
  private service: string;
  private prefix: string;

  constructor(logger: Logger, logLevel: LogLevel, service: string, prefix: string = '') {
    this.logger = logger;
    this.logLevel = logLevel;
    this.service = service;
    this.prefix = prefix;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.logLevel];
  }

  private format(message: string): string {
    return this.prefix ? `${this.prefix} - ${message}` : message;
  }

  info(message: string): void {
    if (this.shouldLog('info')) {
      this.logger.log('info', this.format(message), { service: this.service });
    }
  }

  debug(message: string): void {
    if (this.shouldLog('debug')) {
      this.logger.log('debug', this.format(message), { service: this.service });
    }
  }

  error(message: string): void {
    if (this.shouldLog('error')) {
      this.logger.log('error', this.format(message), { service: this.service });
    }
  }
}

// Simple console logger implementation
// Replace this with your actual logger (winston, pino, etc.)
const logger: Logger = {
  log(level: string, message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`);
  }
};

export default logger;

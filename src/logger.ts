import { Logger } from './types';

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
/**
 * Logger Utility
 * Provides logging functionality for the CLI
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export class Logger {
  private static level: LogLevel = LogLevel.INFO;

  static setLevel(level: LogLevel): void {
    this.level = level;
  }

  static debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`[${LogLevel.DEBUG}]`, message, ...args);
    }
  }

  static info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`[${LogLevel.INFO}]`, message, ...args);
    }
  }

  static warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`[${LogLevel.WARN}]`, message, ...args);
    }
  }

  static error(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`[${LogLevel.ERROR}]`, message, ...args);
    }
  }

  private static shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentIndex = levels.indexOf(this.level);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }
}

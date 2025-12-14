/**
 * Logger interface for dependency injection
 * Provides structured logging across all packages
 */
export interface ILogger {
  /**
   * Log debug message (verbose, development-time info)
   */
  debug(message: string, context?: Record<string, any>): void;

  /**
   * Log informational message (routine application events)
   */
  info(message: string, context?: Record<string, any>): void;

  /**
   * Log warning message (unexpected but recoverable situations)
   */
  warn(message: string, context?: Record<string, any>): void;

  /**
   * Log error message (failures, exceptions)
   */
  error(message: string, error?: Error, context?: Record<string, any>): void;
}

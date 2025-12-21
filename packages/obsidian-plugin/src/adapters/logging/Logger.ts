/* eslint-disable no-console */
import type { ILogger, ErrorLogOptions } from "./ILogger";
import { ErrorMessages } from "./ErrorCodes";

/**
 * Environment-aware logger that sanitizes stack traces in production.
 *
 * In production mode:
 * - Shows user-friendly error messages with error codes
 * - Hides stack traces to prevent information leakage
 *
 * In development mode:
 * - Shows full error details including stack traces
 * - Shows additional context for debugging
 */
export class Logger implements ILogger {
  private static isDevelopment: boolean | undefined = undefined;

  constructor(private context: string) {}

  /**
   * Determines if we're in development mode.
   * Uses process.env.NODE_ENV if available, falls back to checking for common dev indicators.
   */
  private static checkIsDevelopment(): boolean {
    if (Logger.isDevelopment !== undefined) {
      return Logger.isDevelopment;
    }

    // Check NODE_ENV if available
    if (typeof process !== "undefined" && process.env?.NODE_ENV) {
      Logger.isDevelopment = process.env.NODE_ENV === "development";
      return Logger.isDevelopment;
    }

    // Fallback: check for localhost or common dev indicators
    // In Obsidian, we can't rely on process.env, so we use a reasonable default
    // This can be overridden via setDevelopmentMode()
    Logger.isDevelopment = false;
    return Logger.isDevelopment;
  }

  /**
   * Allows explicitly setting development mode.
   * Useful for testing or when environment detection doesn't work.
   */
  static setDevelopmentMode(isDev: boolean): void {
    Logger.isDevelopment = isDev;
  }

  /**
   * Gets the current development mode setting.
   */
  static isDevelopmentMode(): boolean {
    return Logger.checkIsDevelopment();
  }

  debug(message: string, ...args: unknown[]): void {
    console.debug(`[${this.context}] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[${this.context}] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[${this.context}] ${message}`, ...args);
  }

  error(message: string, errorOrOptions?: Error | unknown | ErrorLogOptions): void {
    const isDev = Logger.checkIsDevelopment();

    // Handle the different call signatures
    if (this.isErrorLogOptions(errorOrOptions)) {
      this.logWithOptions(message, errorOrOptions, isDev);
    } else {
      this.logSimpleError(message, errorOrOptions, isDev);
    }
  }

  /**
   * Type guard to check if the argument is ErrorLogOptions
   */
  private isErrorLogOptions(arg: unknown): arg is ErrorLogOptions {
    return (
      typeof arg === "object" &&
      arg !== null &&
      !this.isError(arg) &&
      ("errorCode" in arg || "error" in arg || "context" in arg)
    );
  }

  /**
   * Type guard for Error objects
   */
  private isError(arg: unknown): arg is Error {
    return arg instanceof Error;
  }

  /**
   * Log error with ErrorLogOptions for structured logging
   * Note: In production builds, console calls are dropped by esbuild.
   * To avoid "expression has no effect" warnings, we consolidate
   * conditional logging into single console.error calls.
   */
  private logWithOptions(message: string, options: ErrorLogOptions, isDev: boolean): void {
    const { errorCode, error, context } = options;
    const errorCodeStr = errorCode ? ` [${errorCode}]` : "";

    if (isDev) {
      // Development: show full details in single console calls
      console.error(`[${this.context}]${errorCodeStr} ${message}`);
      this.logErrorDetails(error);
      this.logContext(context);
    } else {
      // Production: sanitized output
      const userMessage = errorCode ? ErrorMessages[errorCode] || message : message;
      console.error(`[${this.context}]${errorCodeStr} ${userMessage}`);
      this.logProductionError(error);
    }
  }

  /**
   * Log error details in development mode
   */
  private logErrorDetails(error: unknown): void {
    if (!error) return;
    if (this.isError(error)) {
      // Combine message and stack into single log to avoid orphaned expressions
      const stackInfo = error.stack ? `\n  Stack trace:\n${error.stack}` : "";
      console.error(`  Error: ${error.message}${stackInfo}`);
    } else {
      console.error(`  Error:`, error);
    }
  }

  /**
   * Log context in development mode
   */
  private logContext(context: Record<string, unknown> | undefined): void {
    if (context && Object.keys(context).length > 0) {
      console.error(`  Context:`, context);
    }
  }

  /**
   * Log error in production mode (message only, no stack)
   */
  private logProductionError(error: unknown): void {
    if (error && this.isError(error)) {
      console.error(`  Details: ${error.message}`);
    }
  }

  /**
   * Log simple error (backward compatible with existing code)
   * Note: Uses helper methods to avoid orphaned expressions after console drops.
   */
  private logSimpleError(message: string, error: unknown, isDev: boolean): void {
    console.error(`[${this.context}] ${message}`);

    if (isDev) {
      // Development: show full details
      this.logErrorDetails(error);
    } else {
      // Production: sanitized output
      this.logProductionError(error);
    }
  }
}

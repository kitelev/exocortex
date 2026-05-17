/* eslint-disable no-console */
import type { ILogger, ErrorLogOptions } from "./ILogger";
import { ErrorMessages } from "./ErrorCodes";
import type { LogChannelsSettings, LogLevel } from "@plugin/domain/settings/ExocortexSettings";
import type { FileLogChannel } from "./FileLogChannel";

/**
 * Callback type for showing Obsidian Notice UI notifications.
 */
export type NoticeCallback = (message: string) => void;

/**
 * Environment-aware logger with configurable channel routing.
 *
 * Each log level can independently route to three channels:
 * - Console (developer tools)
 * - Notice (Obsidian UI notification)
 * - File (exocortex-logs.txt inside the plugin's data folder, rotated at 1 MB)
 */
export class Logger implements ILogger {
  private static isDevelopment: boolean | undefined = undefined;
  private static channelConfig: LogChannelsSettings | null = null;
  private static fileChannel: FileLogChannel | null = null;
  private static noticeCallback: NoticeCallback | null = null;

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

  /**
   * Configure channel routing for all Logger instances.
   * Called once during plugin initialization and whenever settings change.
   */
  static configure(options: {
    channels: LogChannelsSettings;
    fileChannel?: FileLogChannel | null;
    noticeCallback?: NoticeCallback | null;
  }): void {
    Logger.channelConfig = options.channels;
    Logger.fileChannel = options.fileChannel ?? null;
    Logger.noticeCallback = options.noticeCallback ?? null;
  }

  /**
   * Reset channel configuration (used in tests and plugin unload).
   */
  static resetChannels(): void {
    Logger.channelConfig = null;
    Logger.fileChannel = null;
    Logger.noticeCallback = null;
  }

  private isChannelEnabled(level: LogLevel, channel: "console" | "notice" | "file"): boolean {
    if (!Logger.channelConfig) return channel === "console";
    return Logger.channelConfig[level][channel];
  }

  private emitNotice(level: LogLevel, message: string): void {
    if (!this.isChannelEnabled(level, "notice") || !Logger.noticeCallback) return;
    const prefix = level === "error" ? "✗ " : level === "warn" ? "⚠ " : "";
    Logger.noticeCallback(`${prefix}${message}`);
  }

  private emitFile(level: LogLevel, message: string): void {
    if (!this.isChannelEnabled(level, "file") || !Logger.fileChannel) return;
    Logger.fileChannel.append(level, this.context, message);
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.isChannelEnabled("debug", "console")) {
      console.debug(`[${this.context}] ${message}`, ...args);
    }
    this.emitNotice("debug", message);
    this.emitFile("debug", message);
  }

  info(message: string, ...args: unknown[]): void {
    if (this.isChannelEnabled("info", "console")) {
      console.info(`[${this.context}] ${message}`, ...args);
    }
    this.emitNotice("info", message);
    this.emitFile("info", message);
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.isChannelEnabled("warn", "console")) {
      console.warn(`[${this.context}] ${message}`, ...args);
    }
    this.emitNotice("warn", message);
    this.emitFile("warn", message);
  }

  error(message: string, errorOrOptions?: Error | unknown | ErrorLogOptions): void {
    const isDev = Logger.checkIsDevelopment();

    // Handle the different call signatures
    if (this.isErrorLogOptions(errorOrOptions)) {
      this.logWithOptions(message, errorOrOptions, isDev);
    } else {
      this.logSimpleError(message, errorOrOptions, isDev);
    }

    // Notice and file channels always get the top-level message
    this.emitNotice("error", message);
    this.emitFile("error", message);
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
    if (!this.isChannelEnabled("error", "console")) return;

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
    if (!this.isChannelEnabled("error", "console")) return;

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

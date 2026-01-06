/**
 * Log levels for E2E test output.
 * Higher values include all lower levels.
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * ANSI color codes for terminal output.
 */
const Colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
};

/**
 * Structured logger for E2E tests with hierarchical log levels,
 * color-coded output, and phase/step markers.
 *
 * Log levels can be controlled via E2E_LOG_LEVEL environment variable:
 * - 0: ERROR only
 * - 1: ERROR + WARN
 * - 2: ERROR + WARN + INFO (default)
 * - 3: All messages including DEBUG
 *
 * @example
 * ```ts
 * const logger = new TestLogger("ObsidianLauncher");
 *
 * logger.phase("Setup");
 * logger.info("Starting Obsidian...");
 * logger.debug("CDP port: 9222");
 * logger.phaseEnd("Setup", true);
 *
 * // Output:
 * // ─── Setup ───────────────────────────────
 * // [ObsidianLauncher] INFO: Starting Obsidian...
 * // ✓ Setup completed
 * ```
 */
export class TestLogger {
  private level: LogLevel;
  private prefix: string;

  /**
   * Creates a new TestLogger instance.
   * @param prefix - Prefix shown in log messages (e.g., "ObsidianLauncher")
   * @param level - Minimum log level to display. Defaults to INFO or E2E_LOG_LEVEL env var.
   */
  constructor(prefix: string, level?: LogLevel) {
    this.prefix = prefix;
    this.level =
      level ??
      (process.env.E2E_LOG_LEVEL !== undefined
        ? parseInt(process.env.E2E_LOG_LEVEL, 10)
        : LogLevel.INFO);
  }

  /**
   * Logs an ERROR message (always visible).
   * Displayed in red for immediate visibility.
   */
  error(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.ERROR) {
      const formatted = this.formatArgs(args);
      console.error(
        `${Colors.red}[${this.prefix}] ERROR: ${message}${formatted}${Colors.reset}`,
      );
    }
  }

  /**
   * Logs a WARNING message.
   * Displayed in yellow for visibility.
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.WARN) {
      const formatted = this.formatArgs(args);
      console.warn(
        `${Colors.yellow}[${this.prefix}] WARN: ${message}${formatted}${Colors.reset}`,
      );
    }
  }

  /**
   * Logs an INFO message.
   * Standard output color.
   */
  info(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.INFO) {
      const formatted = this.formatArgs(args);
      console.log(`[${this.prefix}] INFO: ${message}${formatted}`);
    }
  }

  /**
   * Logs a DEBUG message.
   * Displayed in gray and only shown when E2E_LOG_LEVEL=3.
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      const formatted = this.formatArgs(args);
      console.log(
        `${Colors.gray}[${this.prefix}] DEBUG: ${message}${formatted}${Colors.reset}`,
      );
    }
  }

  /**
   * Marks the start of a test phase with a visual separator.
   * @param name - Phase name (e.g., "Setup", "Execution", "Teardown")
   */
  phase(name: string): void {
    if (this.level >= LogLevel.INFO) {
      const separator = "─".repeat(40 - name.length - 2);
      console.log(`${Colors.cyan}─── ${name} ${separator}${Colors.reset}`);
    }
  }

  /**
   * Marks the end of a test phase with success/failure indicator.
   * @param name - Phase name
   * @param success - Whether the phase completed successfully
   */
  phaseEnd(name: string, success: boolean): void {
    if (this.level >= LogLevel.INFO) {
      const icon = success
        ? `${Colors.green}✓${Colors.reset}`
        : `${Colors.red}✗${Colors.reset}`;
      console.log(`${icon} ${name} ${success ? "completed" : "failed"}`);
    }
  }

  /**
   * Logs a step within a phase with an arrow indicator.
   * @param description - Step description
   */
  step(description: string): void {
    if (this.level >= LogLevel.INFO) {
      console.log(`  ${Colors.cyan}→${Colors.reset} ${description}`);
    }
  }

  /**
   * Formats additional arguments for log output.
   */
  private formatArgs(args: unknown[]): string {
    if (args.length === 0) return "";
    return (
      " " +
      args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg) : String(arg),
        )
        .join(" ")
    );
  }
}

/**
 * Global logger instance for ObsidianLauncher.
 * Can be imported directly for convenience.
 */
export const launcherLogger = new TestLogger("ObsidianLauncher");

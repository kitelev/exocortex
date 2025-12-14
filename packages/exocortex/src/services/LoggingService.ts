/**
 * Centralized logging service with environment-aware stack trace handling.
 *
 * In production mode:
 * - Shows user-friendly error messages
 * - Hides stack traces to prevent information leakage
 *
 * In development mode:
 * - Shows full error details including stack traces
 */
export class LoggingService {
  private static isVerbose = false;
  private static isDevelopment: boolean | undefined = undefined;

  static setVerbose(verbose: boolean): void {
    this.isVerbose = verbose;
  }

  /**
   * Set development mode explicitly.
   * When true, stack traces will be logged; when false, they will be hidden.
   */
  static setDevelopmentMode(isDev: boolean): void {
    this.isDevelopment = isDev;
  }

  /**
   * Check if we're in development mode.
   */
  private static checkIsDevelopment(): boolean {
    if (this.isDevelopment !== undefined) {
      return this.isDevelopment;
    }

    // Check NODE_ENV if available
    if (typeof process !== "undefined" && process.env?.NODE_ENV) {
      this.isDevelopment = process.env.NODE_ENV === "development";
      return this.isDevelopment;
    }

    // Default to production (safe) mode
    this.isDevelopment = false;
    return this.isDevelopment;
  }

  static debug(message: string, context?: unknown): void {
    if (this.isVerbose) {
      console.debug(`[Exocortex] ${message}`, context ?? "");
    }
  }

  static info(message: string, context?: unknown): void {
    // eslint-disable-next-line no-console
    console.log(`[Exocortex] ${message}`, context ?? "");
  }

  static warn(message: string, context?: unknown): void {
    console.warn(`[Exocortex] ${message}`, context ?? "");
  }

  /**
   * Log an error with environment-aware stack trace handling.
   *
   * @param message - User-friendly error message
   * @param error - Optional error object
   * @param errorCode - Optional error code for debugging
   */
  static error(message: string, error?: Error, errorCode?: string): void {
    const isDev = this.checkIsDevelopment();
    const errorCodeStr = errorCode ? ` [${errorCode}]` : "";

    if (isDev) {
      // Development: show full details
      console.error(`[Exocortex ERROR]${errorCodeStr} ${message}`, error ?? "");
      if (error?.stack) {
        console.error(`  Stack trace:\n${error.stack}`);
      }
    } else {
      // Production: sanitized output (no stack trace)
      console.error(`[Exocortex ERROR]${errorCodeStr} ${message}`);
      if (error?.message) {
        console.error(`  Details: ${error.message}`);
      }
    }
  }
}

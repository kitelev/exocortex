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

  /**
   * Log debug message.
   * Note: These methods intentionally have empty bodies in production builds
   * when console calls are dropped by esbuild. The function signature remains
   * for API compatibility, but the bodies are no-ops.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static debug(_message: string, _context?: unknown): void {
    // Verbose check with console.debug inside keeps the method usable
    // When console is dropped, the entire body becomes a no-op
    if (this.isVerbose) {
      console.debug(`[Exocortex] ${_message}`, _context ?? "");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static info(_message: string, _context?: unknown): void {
    // eslint-disable-next-line no-console
    console.log(`[Exocortex] ${_message}`, _context ?? "");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static warn(_message: string, _context?: unknown): void {
    console.warn(`[Exocortex] ${_message}`, _context ?? "");
  }

  /**
   * Log an error with environment-aware stack trace handling.
   * Note: In production builds, console calls may be dropped by esbuild.
   * Stack trace is included in single console.error call to avoid orphaned expressions.
   *
   * @param message - User-friendly error message
   * @param error - Optional error object
   * @param errorCode - Optional error code for debugging
   */
  static error(message: string, error?: Error, errorCode?: string): void {
    const isDev = this.checkIsDevelopment();
    const errorCodeStr = errorCode ? ` [${errorCode}]` : "";

    if (isDev) {
      // Development: show full details (stack included in single log)
      const stackInfo = error?.stack ? `\n  Stack trace:\n${error.stack}` : "";
      console.error(
        `[Exocortex ERROR]${errorCodeStr} ${message}${stackInfo}`,
        error ?? "",
      );
    } else {
      // Production: sanitized output (no stack trace)
      const details = error?.message ? `\n  Details: ${error.message}` : "";
      console.error(`[Exocortex ERROR]${errorCodeStr} ${message}${details}`);
    }
  }
}

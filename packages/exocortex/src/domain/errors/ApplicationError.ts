import { ErrorCode } from "./ErrorCode";

/**
 * Base class for all application errors with structured metadata
 *
 * Provides:
 * - Standardized error codes for error categorization
 * - Context object for debugging information
 * - Retry hint for transient errors
 * - User guidance for actionable error messages
 * - Proper stack trace capture
 */
export abstract class ApplicationError extends Error {
  /**
   * Standardized error code for error categorization
   */
  abstract readonly code: ErrorCode;

  /**
   * Whether this error is retriable (transient failure)
   */
  abstract readonly retriable: boolean;

  /**
   * User-friendly guidance on how to fix the error
   */
  abstract readonly guidance: string;

  /**
   * Additional context for debugging
   */
  readonly context?: Record<string, unknown>;

  /**
   * Timestamp when error occurred
   */
  readonly timestamp: Date;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.timestamp = new Date();

    // Capture stack trace (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Formats error for display with guidance and context
   */
  format(): string {
    let output = `❌ ${this.name}: ${this.message}`;

    if (this.guidance) {
      output += `\n\n💡 ${this.guidance}`;
    }

    if (this.context && Object.keys(this.context).length > 0) {
      output += `\n\n📋 Context:`;
      for (const [key, value] of Object.entries(this.context)) {
        output += `\n  ${key}: ${JSON.stringify(value)}`;
      }
    }

    return output;
  }

  /**
   * Converts error to JSON for logging/telemetry
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retriable: this.retriable,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }
}

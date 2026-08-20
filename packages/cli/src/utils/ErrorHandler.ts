import { ExitCodes } from "./ExitCodes.js";
import { CLIError } from "./errors/CLIError.js";
import {
  ErrorCode,
  ResponseBuilder,
  type StructuredErrorResponse,
} from "../responses/index.js";

/**
 * Output format for error handling
 */
export type OutputFormat = "text" | "json";

/**
 * Handles errors in CLI commands with appropriate exit codes
 *
 * Provides centralized error handling with:
 * - User-friendly messages (text mode)
 * - Structured JSON responses for MCP tools (json mode)
 * - Proper Unix exit codes for scripting integration
 */
/**
 * Optional context describing WHERE an error came from.
 *
 * ⛔ Five ExoSync call sites passed `{ command }` for months while
 * `handle(error: Error)` took one argument, so it was silently discarded and a
 * failed 24-repo sync round did not name the command that produced it. The code
 * stated an intent it did not deliver — worse than no context, because the five
 * sites read as working plumbing and invited a sixth. Issue #4075, defect 3.
 */
export interface ErrorContext {
  /** The CLI command that was running, e.g. "exosync push". */
  command?: string;
}

export class ErrorHandler {
  private static outputFormat: OutputFormat = "text";

  /**
   * Attach the command to a structured response without touching what is
   * already there. Consumers parse this object, so existing fields keep their
   * names and shapes; only a new optional one appears.
   */
  private static withCommand(
    response: StructuredErrorResponse,
    command: string | undefined
  ): StructuredErrorResponse | (StructuredErrorResponse & { command: string }) {
    return command ? { ...response, command } : response;
  }

  /**
   * Sets the output format for error messages
   */
  static setFormat(format: OutputFormat): void {
    ErrorHandler.outputFormat = format;
  }

  /**
   * Gets the current output format
   */
  static getFormat(): OutputFormat {
    return ErrorHandler.outputFormat;
  }

  /**
   * Checks if debug mode is enabled
   */
  private static isDebugMode(): boolean {
    return !!(process.env.DEBUG || process.env.NODE_ENV === "development");
  }

  /**
   * Handles an error by printing a message and exiting with appropriate code
   *
   * @param error - The error to handle
   * @returns never (process exits)
   *
   * @example
   * try {
   *   // ... command logic
   * } catch (error) {
   *   ErrorHandler.handle(error as Error);
   * }
   */
  static handle(error: Error, context?: ErrorContext): never {
    const command = context?.command;

    // Handle typed CLI errors with full structured information
    if (error instanceof CLIError) {
      if (ErrorHandler.outputFormat === "json") {
        const response = error.toStructuredResponse(ErrorHandler.isDebugMode());
        console.log(
          JSON.stringify(ErrorHandler.withCommand(response, command), null, 2)
        );
      } else {
        // The command is ADDED to the structured formatting, not substituted for
        // it — CLIError.format() carries hint/fix text the caller still needs.
        if (command) {
          console.error(`❌ Command failed: ${command}`);
        }
        console.error(error.format());

        // Show stack trace in development for debugging
        if (ErrorHandler.isDebugMode()) {
          console.error("\n📍 Stack trace:");
          console.error(error.stack);
        }
      }

      process.exit(error.exitCode);
    }

    // Backward compatibility: Handle plain Error instances with string matching
    const { exitCode, errorCode } = ErrorHandler.classifyError(error);

    if (ErrorHandler.outputFormat === "json") {
      const response = ErrorHandler.buildErrorResponse(
        errorCode,
        error.message,
        exitCode,
        ErrorHandler.isDebugMode() ? error.stack : undefined,
      );
      console.log(
        JSON.stringify(ErrorHandler.withCommand(response, command), null, 2)
      );
    } else {
      // ⛤ Prefix rather than interpolation: the message line stays byte-identical
      // to what ~40 context-less call sites already print, so their output does
      // not move and log greps keyed on it keep working.
      if (command) {
        console.error(`❌ Command failed: ${command}`);
      }
      console.error(`❌ Error: ${error.message}`);

      // Show stack trace in development for debugging
      if (ErrorHandler.isDebugMode()) {
        console.error(error.stack);
      }
    }

    process.exit(exitCode);
  }

  /**
   * Handles an error with a custom message
   *
   * @param message - Custom error message to display
   * @param exitCode - Exit code to use (defaults to GENERAL_ERROR)
   * @param errorCode - Error code for JSON output (defaults to INTERNAL_UNKNOWN)
   * @returns never (process exits)
   */
  static handleWithMessage(
    message: string,
    exitCode: ExitCodes = ExitCodes.GENERAL_ERROR,
    errorCode: ErrorCode = ErrorCode.INTERNAL_UNKNOWN,
  ): never {
    if (ErrorHandler.outputFormat === "json") {
      const response = ErrorHandler.buildErrorResponse(
        errorCode,
        message,
        exitCode,
      );
      console.log(JSON.stringify(response, null, 2));
    } else {
      console.error(`❌ Error: ${message}`);
    }
    process.exit(exitCode);
  }

  /**
   * Classifies a plain Error into appropriate exit code and error code
   */
  private static classifyError(error: Error): {
    exitCode: ExitCodes;
    errorCode: ErrorCode;
  } {
    return classifyMessage(error.message);
  }

  /**
   * Builds a structured error response for JSON output
   */
  private static buildErrorResponse(
    errorCode: ErrorCode,
    message: string,
    exitCode: ExitCodes,
    stack?: string,
  ): StructuredErrorResponse {
    return ResponseBuilder.error(errorCode, message, exitCode, {
      recovery: ErrorHandler.getRecoveryHint(errorCode),
      stack,
    });
  }

  /**
   * Gets recovery hint for an error code
   */
  private static getRecoveryHint(errorCode: ErrorCode): {
    message: string;
    suggestion?: string;
  } {
    switch (errorCode) {
      case ErrorCode.VALIDATION_FILE_NOT_FOUND:
        return {
          message: "Verify the file path is correct and the file exists",
          suggestion:
            "Check file path spelling and ensure the file is in the vault",
        };

      case ErrorCode.VALIDATION_VAULT_NOT_FOUND:
        return {
          message: "Verify the vault path is correct",
          suggestion: "Check --vault option or current directory",
        };

      case ErrorCode.VALIDATION_INVALID_ARGUMENTS:
        return {
          message: "Check command syntax and argument format",
          suggestion: "Use --help for usage information",
        };

      case ErrorCode.STATE_INVALID_TRANSITION:
        return {
          message: "The requested state transition is not allowed",
          suggestion: "Check the current asset state and valid transitions",
        };

      case ErrorCode.STATE_CONCURRENT_MODIFICATION:
        return {
          message: "File was modified by another process",
          suggestion: "Wait and retry the command",
        };

      case ErrorCode.PERMISSION_DENIED:
        return {
          message: "Check file permissions",
          suggestion: "Ensure you have write access to the vault",
        };

      case ErrorCode.INTERNAL_TRANSACTION_FAILED:
        return {
          message: "Transaction could not complete",
          suggestion: "Check for locked files and retry",
        };

      default:
        return {
          message: "An unexpected error occurred",
          suggestion: "Check the error details and retry",
        };
    }
  }
}

/**
 * Classify an error MESSAGE into its exit code / error code.
 *
 * ⛤ Exported as a PURE function so a caller can ask "what exit code will this
 * message produce?" without constructing an Error and without the process-exiting
 * side effects of {@link ErrorHandler.handle}. `ErrorHandler.classifyError`
 * delegates here, so there is ONE implementation, not a copy.
 *
 * This matters because classification is by SUBSTRING: a message worded for
 * readability silently re-routes the exit code a scripted consumer branches on.
 * The `set-property` / `remove-property` guard sentences are asserted against THIS
 * function in `tests/unit/guardedRoutes.test.ts` — testing the real mechanism on
 * the FULL rendered message, rather than a hand-maintained copy of the trigger
 * list checked against a fragment. A copy can drift; this cannot.
 */
export function classifyMessage(raw: string): {
  exitCode: ExitCodes;
  errorCode: ErrorCode;
} {
  const message = raw.toLowerCase();

  // State transition errors (check before "Invalid")
  if (message.includes("transition")) {
    return {
      exitCode: ExitCodes.INVALID_STATE_TRANSITION,
      errorCode: ErrorCode.STATE_INVALID_TRANSITION,
    };
  }

  // Transaction errors (check before generic errors)
  if (message.includes("transaction")) {
    return {
      exitCode: ExitCodes.TRANSACTION_FAILED,
      errorCode: ErrorCode.INTERNAL_TRANSACTION_FAILED,
    };
  }

  // Concurrent modification
  if (message.includes("concurrent") || message.includes("modified")) {
    return {
      exitCode: ExitCodes.CONCURRENT_MODIFICATION,
      errorCode: ErrorCode.STATE_CONCURRENT_MODIFICATION,
    };
  }

  // File not found errors
  if (raw.includes("not found") || raw.includes("ENOENT")) {
    return {
      exitCode: ExitCodes.FILE_NOT_FOUND,
      errorCode: ErrorCode.VALIDATION_FILE_NOT_FOUND,
    };
  }

  // Permission errors
  if (raw.includes("EACCES") || raw.includes("permission denied")) {
    return {
      exitCode: ExitCodes.PERMISSION_DENIED,
      errorCode: ErrorCode.PERMISSION_DENIED,
    };
  }

  // Invalid arguments (validation errors) - check last as "Invalid" is broad
  if (
    raw.includes("Invalid") ||
    raw.includes("outside vault") ||
    raw.includes("Not a")
  ) {
    return {
      exitCode: ExitCodes.INVALID_ARGUMENTS,
      errorCode: ErrorCode.VALIDATION_INVALID_ARGUMENTS,
    };
  }

  // Generic error (catch-all)
  return {
    exitCode: ExitCodes.GENERAL_ERROR,
    errorCode: ErrorCode.INTERNAL_UNKNOWN,
  };
}

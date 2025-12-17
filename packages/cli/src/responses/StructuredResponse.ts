/**
 * Structured response types for MCP-compatible CLI output
 *
 * Provides machine-parseable JSON responses for:
 * - Success responses with data
 * - Error responses with categorization
 * - Recovery hints for common issues
 *
 * @see https://github.com/kitelev/exocortex/issues/529
 */

import type { ExitCodes } from "../utils/ExitCodes.js";

/**
 * Error categories for programmatic handling
 *
 * MCP tools can switch on these categories to:
 * - Retry transient errors
 * - Abort on validation errors
 * - Prompt for user action on permission errors
 */
export enum ErrorCategory {
  /** Input validation failed (user error) */
  VALIDATION = "validation",

  /** Permission denied (access control issue) */
  PERMISSION = "permission",

  /** Invalid state transition (business logic) */
  STATE = "state",

  /** Internal error (unexpected condition) */
  INTERNAL = "internal",
}

/**
 * Specific error codes for fine-grained error handling
 *
 * Format: CATEGORY_SPECIFIC_ERROR
 * Examples: VALIDATION_FILE_NOT_FOUND, STATE_INVALID_TRANSITION
 */
export enum ErrorCode {
  // Validation errors (1xx)
  VALIDATION_FILE_NOT_FOUND = "VALIDATION_FILE_NOT_FOUND",
  VALIDATION_INVALID_PATH = "VALIDATION_INVALID_PATH",
  VALIDATION_INVALID_ARGUMENTS = "VALIDATION_INVALID_ARGUMENTS",
  VALIDATION_MISSING_REQUIRED = "VALIDATION_MISSING_REQUIRED",
  VALIDATION_INVALID_FORMAT = "VALIDATION_INVALID_FORMAT",
  VALIDATION_VAULT_NOT_FOUND = "VALIDATION_VAULT_NOT_FOUND",

  // Permission errors (2xx)
  PERMISSION_DENIED = "PERMISSION_DENIED",
  PERMISSION_READ_ONLY = "PERMISSION_READ_ONLY",

  // State errors (3xx)
  STATE_INVALID_TRANSITION = "STATE_INVALID_TRANSITION",
  STATE_CONCURRENT_MODIFICATION = "STATE_CONCURRENT_MODIFICATION",
  STATE_ASSET_NOT_TASK = "STATE_ASSET_NOT_TASK",
  STATE_ALREADY_EXISTS = "STATE_ALREADY_EXISTS",

  // Internal errors (4xx)
  INTERNAL_TRANSACTION_FAILED = "INTERNAL_TRANSACTION_FAILED",
  INTERNAL_OPERATION_FAILED = "INTERNAL_OPERATION_FAILED",
  INTERNAL_UNKNOWN = "INTERNAL_UNKNOWN",
}

/**
 * Maps error codes to their categories
 */
export function getErrorCategory(code: ErrorCode): ErrorCategory {
  if (code.startsWith("VALIDATION_")) return ErrorCategory.VALIDATION;
  if (code.startsWith("PERMISSION_")) return ErrorCategory.PERMISSION;
  if (code.startsWith("STATE_")) return ErrorCategory.STATE;
  return ErrorCategory.INTERNAL;
}

/**
 * Recovery hint for common errors
 */
export interface RecoveryHint {
  /** Short description of the fix */
  message: string;
  /** Suggested command or action */
  suggestion?: string;
  /** Documentation link */
  docUrl?: string;
}

/**
 * Structured error response for JSON output
 */
export interface StructuredErrorResponse {
  /** Always false for errors */
  success: false;
  /** Error information */
  error: {
    /** Error code for programmatic handling */
    code: ErrorCode;
    /** Error category for broad classification */
    category: ErrorCategory;
    /** Human-readable error message */
    message: string;
    /** Recovery hint if available */
    recovery?: RecoveryHint;
    /** Additional context for debugging */
    context?: Record<string, unknown>;
    /** Exit code that would be used in non-JSON mode */
    exitCode: ExitCodes;
    /** Stack trace (only in debug mode) */
    stack?: string;
  };
}

/**
 * Structured success response for JSON output
 */
export interface StructuredSuccessResponse<T = unknown> {
  /** Always true for success */
  success: true;
  /** Result data */
  data: T;
  /** Optional metadata */
  meta?: {
    /** Execution time in milliseconds */
    durationMs?: number;
    /** Number of items affected */
    itemCount?: number;
    /** Additional metadata */
    [key: string]: unknown;
  };
}

/**
 * Union type for all structured responses
 */
export type StructuredResponse<T = unknown> =
  | StructuredSuccessResponse<T>
  | StructuredErrorResponse;

/**
 * Commonly used response data types
 */
export interface CommandResult {
  /** Command that was executed */
  command: string;
  /** Path to the affected file */
  filepath: string;
  /** Description of what was done */
  action: string;
  /** New values (if applicable) */
  changes?: Record<string, unknown>;
}

export interface QueryResult {
  /** Query that was executed */
  query: string;
  /** Number of results */
  count: number;
  /** Result bindings */
  bindings: Record<string, unknown>[];
}

export interface ConstructResult {
  /** CONSTRUCT query that was executed */
  query: string;
  /** Number of triples generated */
  count: number;
  /** Generated RDF triples */
  triples: Array<{
    subject: { type: string; value: string };
    predicate: { type: string; value: string };
    object: { type: string; value: string; datatype?: string; language?: string };
  }>;
}

export interface ResolveResult {
  /** UUID extracted from filename */
  uuid: string;
  /** Relative path within vault */
  path: string;
  /** Absolute filesystem path */
  absolutePath: string;
  /** Obsidian URI (obsidian://vault/...) */
  uri: string;
}

/**
 * Builder for structured responses
 */
export class ResponseBuilder {
  /**
   * Creates a success response
   */
  static success<T>(
    data: T,
    meta?: StructuredSuccessResponse<T>["meta"],
  ): StructuredSuccessResponse<T> {
    return {
      success: true,
      data,
      ...(meta && { meta }),
    };
  }

  /**
   * Creates an error response
   */
  static error(
    code: ErrorCode,
    message: string,
    exitCode: ExitCodes,
    options?: {
      recovery?: RecoveryHint;
      context?: Record<string, unknown>;
      stack?: string;
    },
  ): StructuredErrorResponse {
    return {
      success: false,
      error: {
        code,
        category: getErrorCategory(code),
        message,
        exitCode,
        ...(options?.recovery && { recovery: options.recovery }),
        ...(options?.context && { context: options.context }),
        ...(options?.stack && { stack: options.stack }),
      },
    };
  }
}

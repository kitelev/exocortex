/**
 * Exit codes for CLI commands following Unix conventions
 *
 * @see https://tldp.org/LDP/abs/html/exitcodes.html
 */
export enum ExitCodes {
  /** Command completed successfully */
  SUCCESS = 0,

  /** General error (catch-all for non-specific errors) */
  GENERAL_ERROR = 1,

  /** Invalid command-line arguments or options */
  INVALID_ARGUMENTS = 2,

  /** File or directory not found */
  FILE_NOT_FOUND = 3,

  /** Permission denied (file system access) */
  PERMISSION_DENIED = 4,

  /** Command execution failed (business logic error) */
  OPERATION_FAILED = 5,

  /** Invalid asset state transition (e.g., status change not allowed) */
  INVALID_STATE_TRANSITION = 6,

  /** Transaction failed (atomic operation could not complete) */
  TRANSACTION_FAILED = 7,

  /** Concurrent modification detected (file changed during operation) */
  CONCURRENT_MODIFICATION = 8,

  /** Validation failed (SHACL or other validation errors) */
  VALIDATION_ERROR = 9,
}

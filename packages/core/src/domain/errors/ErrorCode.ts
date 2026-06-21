/**
 * Standardized error codes for the entire application
 *
 * Error code ranges:
 * - 1000-1999: Validation errors
 * - 2000-2999: Network/IO errors
 * - 3000-3999: State/Logic errors
 * - 4000-4999: Permission/Access errors
 * - 5000-5999: Resource errors
 * - 9000-9999: System/Unknown errors
 */
export enum ErrorCode {
  // Validation Errors (1000-1999)
  INVALID_INPUT = 1000,
  INVALID_FORMAT = 1001,
  MISSING_REQUIRED_FIELD = 1002,
  INVALID_SCHEMA = 1003,

  // Network/IO Errors (2000-2999)
  NETWORK_ERROR = 2000,
  REQUEST_TIMEOUT = 2001,
  CONNECTION_FAILED = 2002,
  FILE_READ_ERROR = 2003,
  FILE_WRITE_ERROR = 2004,

  // State/Logic Errors (3000-3999)
  INVALID_STATE = 3000,
  INVALID_TRANSITION = 3001,
  OPERATION_FAILED = 3002,
  CONCURRENT_MODIFICATION = 3003,

  // Permission/Access Errors (4000-4999)
  PERMISSION_DENIED = 4000,
  UNAUTHORIZED = 4001,
  FORBIDDEN = 4003,

  // Resource Errors (5000-5999)
  NOT_FOUND = 5000,
  RESOURCE_EXHAUSTED = 5001,
  ALREADY_EXISTS = 5002,

  // System/Unknown Errors (9000-9999)
  UNKNOWN_ERROR = 9000,
  INTERNAL_ERROR = 9001,
}

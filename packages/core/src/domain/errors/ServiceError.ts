import { ApplicationError } from "./ApplicationError";
import { ErrorCode } from "./ErrorCode";

/**
 * Error thrown when service operations fail
 *
 * Examples:
 * - Service initialization failure
 * - Service method execution error
 * - Internal service state corruption
 * - Dependency injection failure
 */
export class ServiceError extends ApplicationError {
  readonly code = ErrorCode.INTERNAL_ERROR;
  readonly retriable = false; // Service errors typically require code fixes
  readonly guidance =
    `This is an internal service error.
To resolve:
  • Check service initialization parameters
  • Verify all required dependencies are available
  • Review service logs for detailed error information
  • Contact support if the issue persists`;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

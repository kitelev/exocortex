import { ApplicationError } from "./ApplicationError";
import { ErrorCode } from "./ErrorCode";

/**
 * Error thrown when network/IO operations fail
 *
 * Examples:
 * - Network request timeout
 * - Connection failed
 * - File read/write error
 * - External service unavailable
 */
export class NetworkError extends ApplicationError {
  readonly code = ErrorCode.NETWORK_ERROR;
  readonly retriable = true; // Transient network issues may resolve
  readonly guidance =
    `This is typically a transient network issue.
To resolve:
  • Check your internet connection
  • Retry the operation
  • Verify external services are available
  • Check firewall/proxy settings`;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

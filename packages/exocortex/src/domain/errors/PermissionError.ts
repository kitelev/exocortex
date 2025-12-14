import { ApplicationError } from "./ApplicationError";
import { ErrorCode } from "./ErrorCode";

/**
 * Error thrown when permission/authorization check fails
 *
 * Examples:
 * - File permission denied (EACCES)
 * - User not authorized for action
 * - Invalid credentials
 * - Insufficient privileges
 */
export class PermissionError extends ApplicationError {
  readonly code = ErrorCode.PERMISSION_DENIED;
  readonly retriable = false; // User must fix permissions
  readonly guidance =
    `You don't have permission to perform this operation.
To resolve:
  • Check file/directory permissions
  • Verify you're authenticated
  • Ensure you have sufficient privileges
  • Contact administrator if access is needed`;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

import { ApplicationError } from "./ApplicationError";
import { ErrorCode } from "./ErrorCode";

/**
 * Error thrown when requested resource doesn't exist
 *
 * Examples:
 * - File not found (ENOENT)
 * - Note doesn't exist in vault
 * - Resource ID not in database
 * - API endpoint returns 404
 */
export class NotFoundError extends ApplicationError {
  readonly code = ErrorCode.NOT_FOUND;
  readonly retriable = false; // Resource must exist
  readonly guidance =
    `The requested resource could not be found.
To resolve:
  • Verify the resource path/ID is correct
  • Check the resource exists
  • Ensure proper file extension (.md for notes)
  • Verify resource hasn't been deleted`;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

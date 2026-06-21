import { ApplicationError } from "./ApplicationError";
import { ErrorCode } from "./ErrorCode";

/**
 * Error thrown when input validation fails
 *
 * Examples:
 * - Invalid frontmatter format
 * - Missing required property
 * - Invalid property value
 * - Schema validation failure
 */
export class ValidationError extends ApplicationError {
  readonly code = ErrorCode.INVALID_INPUT;
  readonly retriable = false; // User must fix input
  readonly guidance =
    `Check the input data for correctness.
Common issues:
  • Missing required fields
  • Invalid data format or type
  • Values outside allowed range
  • Schema validation failed`;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

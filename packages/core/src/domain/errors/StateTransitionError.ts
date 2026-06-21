import { ApplicationError } from "./ApplicationError";
import { ErrorCode } from "./ErrorCode";

/**
 * Error thrown when invalid state transition is attempted
 *
 * Examples:
 * - Transitioning task from "Finished" to "Todo"
 * - Invalid lifecycle state change
 * - Operation not allowed in current state
 * - Concurrent modification detected
 */
export class StateTransitionError extends ApplicationError {
  readonly code = ErrorCode.INVALID_TRANSITION;
  readonly retriable = false; // Invalid transitions require user action
  readonly guidance =
    `The requested state transition is not allowed.
To fix:
  • Check the current state of the resource
  • Verify the transition is valid for this workflow
  • Review state machine documentation
  • Ensure no concurrent modifications occurred`;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

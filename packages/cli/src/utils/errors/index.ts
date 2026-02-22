/**
 * Typed error classes for CLI commands
 *
 * Provides structured errors with:
 * - Specific exit codes for shell integration
 * - Error codes for MCP tool handling
 * - Actionable guidance for users
 * - Context information for debugging
 * - JSON-formatted output for programmatic consumption
 */

export { CLIError } from "./CLIError.js";
export { FileNotFoundError } from "./FileNotFoundError.js";
export { InvalidArgumentsError } from "./InvalidArgumentsError.js";
export { ConcurrentModificationError } from "./ConcurrentModificationError.js";
export { VaultNotFoundError } from "./VaultNotFoundError.js";
export { InvalidStateTransitionError } from "./InvalidStateTransitionError.js";
export { OperationFailedError } from "./OperationFailedError.js";
export { PermissionDeniedError } from "./PermissionDeniedError.js";
export { QueryTimeoutError } from "./QueryTimeoutError.js";

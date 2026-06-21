/**
 * Centralized error handling for the application
 *
 * This module provides:
 * - Standardized error codes
 * - Base ApplicationError class with structured metadata
 * - Typed error classes for common failure scenarios
 * - User-friendly error messages with actionable guidance
 */

export { ErrorCode } from "./ErrorCode";
export { ApplicationError } from "./ApplicationError";
export { ValidationError } from "./ValidationError";
export { NetworkError } from "./NetworkError";
export { StateTransitionError } from "./StateTransitionError";
export { PermissionError } from "./PermissionError";
export { NotFoundError } from "./NotFoundError";
export { ResourceExhaustedError } from "./ResourceExhaustedError";
export { ServiceError } from "./ServiceError";

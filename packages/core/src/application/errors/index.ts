/**
 * Application-level error handling services
 *
 * Provides:
 * - ApplicationErrorHandler with retry logic
 * - Error telemetry hooks for monitoring
 * - Retry configuration
 */

export {
  ApplicationErrorHandler,
  type ErrorTelemetryHook,
  type RetryConfig,
} from "./ApplicationErrorHandler";

import type { ILogger } from "../../interfaces/ILogger";
import type { INotificationService } from "../../interfaces/INotificationService";
import { ApplicationError } from "../../domain/errors/ApplicationError";
import { ErrorCode } from "../../domain/errors/ErrorCode";

/**
 * Telemetry hook for monitoring errors
 */
export interface ErrorTelemetryHook {
  onError?(error: ApplicationError, context?: Record<string, unknown>): void;
  onRetry?(error: ApplicationError, attempt: number, delay: number): void;
  onRetryExhausted?(error: ApplicationError, totalAttempts: number): void;
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

/**
 * Centralized error handler with retry logic and telemetry
 *
 * Provides:
 * - Error formatting and user notifications
 * - Automatic retry with exponential backoff
 * - Telemetry hooks for monitoring
 */
export class ApplicationErrorHandler {
  private telemetryHooks: Set<ErrorTelemetryHook> = new Set();
  private readonly retryConfig: Required<RetryConfig>;

  constructor(
    retryConfig: RetryConfig = {},
    private logger?: ILogger,
    private notifier?: INotificationService,
  ) {
    this.retryConfig = {
      maxRetries: retryConfig.maxRetries ?? 3,
      initialDelayMs: retryConfig.initialDelayMs ?? 1000,
      backoffMultiplier: retryConfig.backoffMultiplier ?? 2,
      maxDelayMs: retryConfig.maxDelayMs ?? 10000,
    };
  }

  /**
   * Format error for display and logging
   */
  handle(error: Error, context?: Record<string, unknown>): string {
    const appError = this.ensureApplicationError(error, context);

    if (this.notifier) {
      this.notifier.error(appError.message);
    }

    this.callTelemetryHooks("onError", appError, context);

    return this.formatError(appError);
  }

  /**
   * Execute operation with automatic retry for recoverable errors
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    let lastError: ApplicationError | undefined;
    let attempt = 0;

    while (attempt <= this.retryConfig.maxRetries) {
      try {
        return await operation();
      } catch (error) {
        lastError = this.ensureApplicationError(error as Error, context);

        if (!lastError.retriable || attempt >= this.retryConfig.maxRetries) {
          this.callTelemetryHooks("onError", lastError, context);
          if (attempt >= this.retryConfig.maxRetries && lastError.retriable) {
            this.callTelemetryHooks(
              "onRetryExhausted",
              lastError,
              attempt + 1,
            );
          }
          throw lastError;
        }

        const delay = this.calculateDelay(attempt);
        this.callTelemetryHooks("onRetry", lastError, attempt + 1, delay);

        this.logger?.debug(
          `Retrying after ${delay}ms (attempt ${attempt + 1}/${this.retryConfig.maxRetries})`,
        );

        await this.sleep(delay);
        attempt++;
      }
    }

    throw lastError!;
  }

  /**
   * Register telemetry hook for error monitoring
   */
  registerTelemetryHook(hook: ErrorTelemetryHook): void {
    this.telemetryHooks.add(hook);
  }

  /**
   * Unregister telemetry hook
   */
  unregisterTelemetryHook(hook: ErrorTelemetryHook): void {
    this.telemetryHooks.delete(hook);
  }

  private ensureApplicationError(
    error: Error,
    context?: Record<string, unknown>,
  ): ApplicationError {
    if (error instanceof ApplicationError) {
      if (context) {
        // Create new instance with merged context since context is readonly
        const originalError = error; // Capture typed reference for closure
        const mergedContext = { ...error.context, ...context };
        const wrappedError = new (class extends ApplicationError {
          readonly code = originalError.code;
          readonly retriable = originalError.retriable;
          readonly guidance = originalError.guidance;
        })(error.message, mergedContext);
        return wrappedError;
      }
      return error;
    }

    const wrappedError = new (class UnknownError extends ApplicationError {
      readonly code = ErrorCode.UNKNOWN_ERROR;
      readonly retriable = false;
      readonly guidance = "An unexpected error occurred";

      constructor(message: string, originalError: Error) {
        super(message, {
          originalError: originalError.name,
          ...context,
        });
      }
    })(error.message, error);

    return wrappedError;
  }

  private formatError(error: ApplicationError): string {
    const lines: string[] = [];

    lines.push(`❌ ${error.name}: ${error.message}`);

    if (error.guidance) {
      lines.push(`💡 ${error.guidance}`);
    }

    if (error.context && Object.keys(error.context).length > 0) {
      lines.push(`Context: ${JSON.stringify(error.context, null, 2)}`);
    }

    return lines.join("\n");
  }

  private calculateDelay(attempt: number): number {
    const delay =
      this.retryConfig.initialDelayMs *
      Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private callTelemetryHooks(
    method: keyof ErrorTelemetryHook,
    ...args: unknown[]
  ): void {
    for (const hook of this.telemetryHooks) {
      try {
        const hookMethod = hook[method] as (...args: unknown[]) => void;
        if (hookMethod) {
          hookMethod.apply(hook, args);
        }
      } catch (error) {
        console.error("Error in telemetry hook:", error);
      }
    }
  }
}

import React, { Component, ReactNode, ErrorInfo } from "react";
import { ApplicationError, ApplicationErrorHandler } from "exocortex";

/**
 * Props for ErrorBoundary component
 */
export interface ErrorBoundaryProps {
  /**
   * Child components to render
   */
  children: ReactNode;

  /**
   * Optional custom fallback UI component
   */
  fallback?: (error: Error, errorInfo: ErrorInfo, retry: () => void) => ReactNode;

  /**
   * Optional error handler for telemetry/logging
   */
  errorHandler?: ApplicationErrorHandler;

  /**
   * Optional callback when error occurs
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

/**
 * State for ErrorBoundary component
 */
export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React Error Boundary component for catching and handling UI errors
 *
 * Features:
 * - Catches errors in React component tree
 * - Displays user-friendly error UI
 * - Integrates with ApplicationErrorHandler for telemetry
 * - Provides retry mechanism
 * - Logs errors with stack traces
 *
 * @example
 * ```tsx
 * <ErrorBoundary errorHandler={myErrorHandler}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * Static method called when an error is thrown in a child component
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Lifecycle method called after an error is caught
   */
  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Store error info in state
    this.setState({ errorInfo });

    // Log error to console in development
    if (process.env.NODE_ENV === "development") {
      console.error("ErrorBoundary caught error:", error);
      console.error("Component stack:", errorInfo.componentStack);
    }

    // Call error handler if provided
    if (this.props.errorHandler) {
      this.props.errorHandler.handle(error, {
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
      });
    }

    // Call onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  /**
   * Resets the error boundary state to retry rendering
   */
  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  /**
   * Default fallback UI when an error occurs
   */
  renderDefaultFallback(): ReactNode {
    const { error, errorInfo } = this.state;

    if (!error) return null;

    // Check if error is ApplicationError for better formatting
    const isApplicationError = error instanceof ApplicationError;
    const errorMessage = isApplicationError
      ? (error as ApplicationError).format()
      : error.message;

    return (
      <div
        style={{
          padding: "20px",
          margin: "10px",
          border: "2px solid var(--background-modifier-error)",
          borderRadius: "8px",
          backgroundColor: "var(--background-secondary)",
        }}
      >
        <h3 style={{ color: "var(--text-error)", marginTop: 0 }}>
          ❌ Something went wrong
        </h3>

        <div
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-monospace)",
            fontSize: "0.9em",
            padding: "10px",
            backgroundColor: "var(--background-primary)",
            borderRadius: "4px",
            marginBottom: "15px",
          }}
        >
          {errorMessage}
        </div>

        <button
          onClick={this.handleRetry}
          style={{
            padding: "8px 16px",
            backgroundColor: "var(--interactive-accent)",
            color: "var(--text-on-accent)",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          🔄 Try Again
        </button>

        {process.env.NODE_ENV === "development" && errorInfo && (
          <details style={{ marginTop: "15px" }}>
            <summary
              style={{
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: "0.9em",
              }}
            >
              📍 Component Stack (Development)
            </summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontSize: "0.8em",
                color: "var(--text-muted)",
                marginTop: "10px",
              }}
            >
              {errorInfo.componentStack}
            </pre>
          </details>
        )}
      </div>
    );
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided, otherwise use default
      if (this.props.fallback && this.state.error && this.state.errorInfo) {
        return this.props.fallback(
          this.state.error,
          this.state.errorInfo,
          this.handleRetry,
        );
      }

      return this.renderDefaultFallback();
    }

    return this.props.children;
  }
}

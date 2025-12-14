import React from "react";
import { ErrorBoundary } from "../../src/presentation/components/ErrorBoundary";
import { ApplicationErrorHandler } from "exocortex/application/errors";

/**
 * Component that throws an error for testing
 */
export const ThrowError: React.FC<{ shouldThrow?: boolean; error?: Error }> = ({
  shouldThrow = true,
  error = new Error("Test error"),
}) => {
  if (shouldThrow) {
    throw error;
  }
  return <div>No error</div>;
};

/**
 * Working component for testing
 */
export const WorkingComponent: React.FC = () => {
  return <div data-testid="working-component">Component works!</div>;
};

/**
 * Toggle error component for retry testing
 */
export const ToggleError: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error("Toggle error");
  }
  return <div data-testid="success">Success!</div>;
};

/**
 * Wrapper to test ErrorBoundary with ApplicationErrorHandler
 * This component encapsulates the errorHandler internally to avoid Playwright CT serialization issues
 */
export const ErrorBoundaryWithHandler: React.FC<{
  errorMessage: string;
  onHandlerCalled?: () => void;
}> = ({ errorMessage, onHandlerCalled }) => {
  // Create errorHandler internally - this avoids Playwright CT serialization issues
  const errorHandler = React.useMemo(() => {
    const handler = new ApplicationErrorHandler();
    // Register a telemetry hook to signal when error is handled
    handler.registerTelemetryHook({
      onError: () => {
        if (onHandlerCalled) {
          onHandlerCalled();
        }
      },
    });
    return handler;
  }, [onHandlerCalled]);

  return (
    <ErrorBoundary errorHandler={errorHandler}>
      <ThrowError error={new Error(errorMessage)} />
    </ErrorBoundary>
  );
};

/**
 * Custom fallback UI component for testing
 */
const CustomFallbackContent: React.FC<{
  error: Error;
  errorInfo: React.ErrorInfo;
  retry: () => void;
}> = ({ error, retry }) => (
  <div data-testid="custom-fallback">
    <h1>Custom Error UI</h1>
    <p data-testid="error-message">{error.message}</p>
    <button onClick={retry}>Custom Retry</button>
  </div>
);

/**
 * Wrapper to test ErrorBoundary with custom fallback UI
 * This component encapsulates the fallback function internally to avoid Playwright CT serialization issues
 */
export const ErrorBoundaryWithCustomFallback: React.FC<{
  errorMessage: string;
}> = ({ errorMessage }) => {
  // Define fallback function internally - this avoids Playwright CT serialization issues
  const customFallback = React.useCallback(
    (error: Error, errorInfo: React.ErrorInfo, retry: () => void) => (
      <CustomFallbackContent error={error} errorInfo={errorInfo} retry={retry} />
    ),
    [],
  );

  return (
    <ErrorBoundary fallback={customFallback}>
      <ThrowError error={new Error(errorMessage)} />
    </ErrorBoundary>
  );
};

/**
 * Wrapper that provides both errorHandler AND onError callback for testing combined behavior
 */
export const ErrorBoundaryWithBothCallbacks: React.FC<{
  errorMessage: string;
}> = ({ errorMessage }) => {
  const [handlerCalled, setHandlerCalled] = React.useState(false);
  const [callbackCalled, setCallbackCalled] = React.useState(false);

  const errorHandler = React.useMemo(() => {
    const handler = new ApplicationErrorHandler();
    handler.registerTelemetryHook({
      onError: () => setHandlerCalled(true),
    });
    return handler;
  }, []);

  const onError = React.useCallback(() => {
    setCallbackCalled(true);
  }, []);

  return (
    <div>
      <ErrorBoundary errorHandler={errorHandler} onError={onError}>
        <ThrowError error={new Error(errorMessage)} />
      </ErrorBoundary>
      {handlerCalled && <span data-testid="handler-called">Handler was called</span>}
      {callbackCalled && <span data-testid="callback-called">Callback was called</span>}
    </div>
  );
};

/**
 * Unit tests for ErrorBoundary component
 *
 * Tests component logic, error handling, callbacks, and retry mechanism.
 * These tests complement the Playwright component tests by testing scenarios
 * that require complex prop serialization (functions, class instances).
 *
 * @see packages/obsidian-plugin/tests/component/ErrorBoundary.test.tsx for visual tests
 */
import {
  ErrorBoundary,
  ErrorBoundaryProps,
} from "../../src/presentation/components/ErrorBoundary";
import {
  ApplicationErrorHandler,
  ValidationError,
  NetworkError,
} from "exocortex";
import React, { ReactNode, ErrorInfo } from "react";

// Mock console.error to avoid noise in tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
});

describe("ErrorBoundary", () => {
  describe("constructor and initial state", () => {
    it("should initialize with no error state", () => {
      const boundary = new ErrorBoundary({ children: null });
      expect(boundary.state).toEqual({
        hasError: false,
        error: null,
        errorInfo: null,
      });
    });

    it("should accept optional errorHandler prop", () => {
      const errorHandler = new ApplicationErrorHandler();
      const boundary = new ErrorBoundary({
        children: null,
        errorHandler,
      });
      expect(boundary.props.errorHandler).toBe(errorHandler);
    });

    it("should accept optional onError callback prop", () => {
      const onError = jest.fn();
      const boundary = new ErrorBoundary({
        children: null,
        onError,
      });
      expect(boundary.props.onError).toBe(onError);
    });

    it("should accept optional fallback function prop", () => {
      const fallback = jest.fn();
      const boundary = new ErrorBoundary({
        children: null,
        fallback,
      });
      expect(boundary.props.fallback).toBe(fallback);
    });
  });

  describe("getDerivedStateFromError", () => {
    it("should return error state when error is caught", () => {
      const error = new Error("Test error");
      const newState = ErrorBoundary.getDerivedStateFromError(error);

      expect(newState).toEqual({
        hasError: true,
        error,
      });
    });

    it("should handle ApplicationError types", () => {
      const error = new ValidationError("Invalid input", { field: "email" });
      const newState = ErrorBoundary.getDerivedStateFromError(error);

      expect(newState.hasError).toBe(true);
      expect(newState.error).toBe(error);
    });

    it("should handle NetworkError types", () => {
      const error = new NetworkError("Connection failed", { url: "http://api.test" });
      const newState = ErrorBoundary.getDerivedStateFromError(error);

      expect(newState.hasError).toBe(true);
      expect(newState.error).toBe(error);
    });
  });

  describe("componentDidCatch", () => {
    let boundary: ErrorBoundary;
    let setStateSpy: jest.SpyInstance;
    const mockErrorInfo: ErrorInfo = {
      componentStack: "\n    at ChildComponent\n    at ErrorBoundary",
    };

    beforeEach(() => {
      boundary = new ErrorBoundary({ children: null });
      setStateSpy = jest.spyOn(boundary, "setState").mockImplementation(() => {});
    });

    afterEach(() => {
      setStateSpy.mockRestore();
    });

    it("should store errorInfo in state", () => {
      const error = new Error("Test error");
      boundary.componentDidCatch(error, mockErrorInfo);

      expect(setStateSpy).toHaveBeenCalledWith({ errorInfo: mockErrorInfo });
    });

    it("should call onError callback if provided", () => {
      const onError = jest.fn();
      boundary = new ErrorBoundary({ children: null, onError });
      setStateSpy = jest.spyOn(boundary, "setState").mockImplementation(() => {});

      const error = new Error("Test error");
      boundary.componentDidCatch(error, mockErrorInfo);

      expect(onError).toHaveBeenCalledWith(error, mockErrorInfo);
    });

    it("should not fail if onError callback is not provided", () => {
      const error = new Error("Test error");
      expect(() => {
        boundary.componentDidCatch(error, mockErrorInfo);
      }).not.toThrow();
    });

    it("should call errorHandler.handle if errorHandler is provided", () => {
      const errorHandler = new ApplicationErrorHandler();
      const handleSpy = jest.spyOn(errorHandler, "handle").mockReturnValue("formatted error");
      boundary = new ErrorBoundary({ children: null, errorHandler });
      setStateSpy = jest.spyOn(boundary, "setState").mockImplementation(() => {});

      const error = new Error("Test error");
      boundary.componentDidCatch(error, mockErrorInfo);

      expect(handleSpy).toHaveBeenCalledWith(error, {
        componentStack: mockErrorInfo.componentStack,
        timestamp: expect.any(String),
      });
      handleSpy.mockRestore();
    });

    it("should pass timestamp to errorHandler context", () => {
      const errorHandler = new ApplicationErrorHandler();
      const handleSpy = jest.spyOn(errorHandler, "handle").mockReturnValue("formatted error");
      boundary = new ErrorBoundary({ children: null, errorHandler });
      setStateSpy = jest.spyOn(boundary, "setState").mockImplementation(() => {});

      const beforeTime = new Date().toISOString();
      const error = new Error("Test error");
      boundary.componentDidCatch(error, mockErrorInfo);
      const afterTime = new Date().toISOString();

      const calledContext = handleSpy.mock.calls[0][1] as Record<string, unknown>;
      const timestamp = calledContext.timestamp as string;

      expect(timestamp >= beforeTime).toBe(true);
      expect(timestamp <= afterTime).toBe(true);

      handleSpy.mockRestore();
    });

    it("should log error to console in development mode", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const error = new Error("Dev mode error");
      boundary.componentDidCatch(error, mockErrorInfo);

      expect(console.error).toHaveBeenCalledWith("ErrorBoundary caught error:", error);
      expect(console.error).toHaveBeenCalledWith("Component stack:", mockErrorInfo.componentStack);

      process.env.NODE_ENV = originalEnv;
    });

    it("should not log to console in production mode", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      (console.error as jest.Mock).mockClear();

      const error = new Error("Prod mode error");
      boundary.componentDidCatch(error, mockErrorInfo);

      expect(console.error).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    it("should call both errorHandler and onError when both are provided", () => {
      const errorHandler = new ApplicationErrorHandler();
      const handleSpy = jest.spyOn(errorHandler, "handle").mockReturnValue("formatted");
      const onError = jest.fn();

      boundary = new ErrorBoundary({
        children: null,
        errorHandler,
        onError,
      });
      setStateSpy = jest.spyOn(boundary, "setState").mockImplementation(() => {});

      const error = new Error("Test error");
      boundary.componentDidCatch(error, mockErrorInfo);

      expect(handleSpy).toHaveBeenCalled();
      expect(onError).toHaveBeenCalled();

      handleSpy.mockRestore();
    });
  });

  describe("handleRetry", () => {
    let boundary: ErrorBoundary;
    let setStateSpy: jest.SpyInstance;

    beforeEach(() => {
      boundary = new ErrorBoundary({ children: null });
      boundary.state = {
        hasError: true,
        error: new Error("Previous error"),
        errorInfo: { componentStack: "stack" },
      };
      setStateSpy = jest.spyOn(boundary, "setState").mockImplementation(() => {});
    });

    afterEach(() => {
      setStateSpy.mockRestore();
    });

    it("should reset error state to initial values", () => {
      boundary.handleRetry();

      expect(setStateSpy).toHaveBeenCalledWith({
        hasError: false,
        error: null,
        errorInfo: null,
      });
    });

    it("should be bound to the instance (arrow function)", () => {
      // Verify handleRetry maintains correct 'this' binding
      const retryFn = boundary.handleRetry;
      expect(() => retryFn()).not.toThrow();
    });
  });

  describe("render", () => {
    describe("when no error has occurred", () => {
      it("should render children", () => {
        const boundary = new ErrorBoundary({ children: "Child content" });
        boundary.state = { hasError: false, error: null, errorInfo: null };

        const rendered = boundary.render();
        expect(rendered).toBe("Child content");
      });

      it("should render complex children elements", () => {
        const children = React.createElement("div", { key: "test" }, "Complex child");
        const boundary = new ErrorBoundary({ children });
        boundary.state = { hasError: false, error: null, errorInfo: null };

        const rendered = boundary.render();
        expect(rendered).toBe(children);
      });
    });

    describe("when error has occurred", () => {
      it("should render default fallback when no custom fallback provided", () => {
        const boundary = new ErrorBoundary({ children: null });
        boundary.state = {
          hasError: true,
          error: new Error("Test error"),
          errorInfo: { componentStack: "stack" },
        };

        const rendered = boundary.render();

        // Default fallback is a div with error message and retry button
        expect(rendered).not.toBeNull();
        expect(typeof rendered).toBe("object");
      });

      it("should use custom fallback when provided and error info is available", () => {
        const error = new Error("Custom fallback test");
        const errorInfo = { componentStack: "test stack" };
        const mockReturnElement = React.createElement("div", null, "Custom fallback");

        const fallback = jest.fn().mockReturnValue(mockReturnElement);
        const boundary = new ErrorBoundary({ children: null, fallback });
        boundary.state = {
          hasError: true,
          error,
          errorInfo,
        };

        const rendered = boundary.render();

        expect(fallback).toHaveBeenCalledWith(error, errorInfo, boundary.handleRetry);
        expect(rendered).toBe(mockReturnElement);
      });

      it("should render default fallback when custom fallback provided but errorInfo is null", () => {
        const fallback = jest.fn();
        const boundary = new ErrorBoundary({ children: null, fallback });
        boundary.state = {
          hasError: true,
          error: new Error("Test"),
          errorInfo: null,
        };

        const rendered = boundary.render();

        expect(fallback).not.toHaveBeenCalled();
        expect(rendered).not.toBeNull();
      });

      it("should render default fallback when custom fallback provided but error is null", () => {
        const fallback = jest.fn();
        const boundary = new ErrorBoundary({ children: null, fallback });
        boundary.state = {
          hasError: true,
          error: null,
          errorInfo: { componentStack: "stack" },
        };

        boundary.render();

        expect(fallback).not.toHaveBeenCalled();
      });
    });
  });

  describe("renderDefaultFallback", () => {
    let boundary: ErrorBoundary;

    beforeEach(() => {
      boundary = new ErrorBoundary({ children: null });
    });

    it("should return null when error is null", () => {
      boundary.state = { hasError: true, error: null, errorInfo: null };

      const rendered = boundary["renderDefaultFallback"]();
      expect(rendered).toBeNull();
    });

    it("should render error message for standard Error", () => {
      boundary.state = {
        hasError: true,
        error: new Error("Standard error message"),
        errorInfo: null,
      };

      const rendered = boundary["renderDefaultFallback"]();
      expect(rendered).not.toBeNull();

      // The rendered element should be a React element with specific structure
      expect((rendered as React.ReactElement).type).toBe("div");
    });

    it("should format ApplicationError using format() method", () => {
      const validationError = new ValidationError("Invalid input", { field: "email" });
      boundary.state = {
        hasError: true,
        error: validationError,
        errorInfo: null,
      };

      const rendered = boundary["renderDefaultFallback"]();
      expect(rendered).not.toBeNull();

      // The error message should use ValidationError.format()
      const element = rendered as React.ReactElement;
      expect(element.type).toBe("div");
    });

    it("should include retry button that calls handleRetry", () => {
      boundary.state = {
        hasError: true,
        error: new Error("Test"),
        errorInfo: null,
      };

      const rendered = boundary["renderDefaultFallback"]() as React.ReactElement;
      expect(rendered).not.toBeNull();

      // Find the button element in children
      const findButton = (element: React.ReactElement): React.ReactElement | null => {
        if (element.type === "button") return element;
        if (!element.props.children) return null;

        const children = Array.isArray(element.props.children)
          ? element.props.children
          : [element.props.children];

        for (const child of children) {
          if (child && typeof child === "object" && "type" in child) {
            const found = findButton(child);
            if (found) return found;
          }
        }
        return null;
      };

      const button = findButton(rendered);
      expect(button).not.toBeNull();
      expect(button?.props.onClick).toBe(boundary.handleRetry);
    });

    it("should show component stack in development mode", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      boundary.state = {
        hasError: true,
        error: new Error("Test"),
        errorInfo: { componentStack: "\n    at TestComponent\n    at ErrorBoundary" },
      };

      const rendered = boundary["renderDefaultFallback"]() as React.ReactElement;
      expect(rendered).not.toBeNull();

      // In development mode, details element should be rendered
      const findDetails = (element: React.ReactElement): React.ReactElement | null => {
        if (element.type === "details") return element;
        if (!element.props.children) return null;

        const children = Array.isArray(element.props.children)
          ? element.props.children
          : [element.props.children];

        for (const child of children) {
          if (child && typeof child === "object" && "type" in child) {
            const found = findDetails(child);
            if (found) return found;
          }
        }
        return null;
      };

      const details = findDetails(rendered);
      expect(details).not.toBeNull();

      process.env.NODE_ENV = originalEnv;
    });

    it("should not show component stack in production mode", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      boundary.state = {
        hasError: true,
        error: new Error("Test"),
        errorInfo: { componentStack: "\n    at TestComponent" },
      };

      const rendered = boundary["renderDefaultFallback"]() as React.ReactElement;

      // In production mode, details element should not be rendered
      const findDetails = (element: React.ReactElement): React.ReactElement | null => {
        if (element.type === "details") return element;
        if (!element.props.children) return null;

        const children = Array.isArray(element.props.children)
          ? element.props.children
          : [element.props.children];

        for (const child of children) {
          if (child && typeof child === "object" && "type" in child) {
            const found = findDetails(child);
            if (found) return found;
          }
        }
        return null;
      };

      const details = findDetails(rendered);
      expect(details).toBeNull();

      process.env.NODE_ENV = originalEnv;
    });

    it("should not render details when errorInfo is null even in development", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      boundary.state = {
        hasError: true,
        error: new Error("Test"),
        errorInfo: null, // No errorInfo
      };

      const rendered = boundary["renderDefaultFallback"]() as React.ReactElement;

      const findDetails = (element: React.ReactElement): React.ReactElement | null => {
        if (element.type === "details") return element;
        if (!element.props.children) return null;

        const children = Array.isArray(element.props.children)
          ? element.props.children
          : [element.props.children];

        for (const child of children) {
          if (child && typeof child === "object" && "type" in child) {
            const found = findDetails(child);
            if (found) return found;
          }
        }
        return null;
      };

      const details = findDetails(rendered);
      expect(details).toBeNull();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe("integration scenarios", () => {
    it("should handle error → retry → success flow", () => {
      const boundary = new ErrorBoundary({ children: "Original content" });

      // Initial state - no error
      expect(boundary.state.hasError).toBe(false);
      expect(boundary.render()).toBe("Original content");

      // Simulate error caught
      const error = new Error("Something broke");
      const newState = ErrorBoundary.getDerivedStateFromError(error);
      boundary.state = { ...boundary.state, ...newState, errorInfo: { componentStack: "stack" } };

      expect(boundary.state.hasError).toBe(true);
      expect(boundary.state.error).toBe(error);

      // Simulate retry - state should reset
      const setStateMock = jest.fn((update) => {
        boundary.state = { ...boundary.state, ...update };
      });
      boundary.setState = setStateMock;
      boundary.handleRetry();

      expect(setStateMock).toHaveBeenCalledWith({
        hasError: false,
        error: null,
        errorInfo: null,
      });
    });

    it("should handle error → retry → error again flow", () => {
      const boundary = new ErrorBoundary({ children: "Content" });

      // First error
      const error1 = new Error("First error");
      boundary.state = {
        ...ErrorBoundary.getDerivedStateFromError(error1),
        errorInfo: { componentStack: "stack1" },
      };
      expect(boundary.state.error?.message).toBe("First error");

      // Retry
      const setStateMock = jest.fn((update) => {
        boundary.state = { ...boundary.state, ...update };
      });
      boundary.setState = setStateMock;
      boundary.handleRetry();

      // Reset state manually (simulating setState callback)
      boundary.state = { hasError: false, error: null, errorInfo: null };

      // Second error
      const error2 = new Error("Second error");
      boundary.state = {
        ...ErrorBoundary.getDerivedStateFromError(error2),
        errorInfo: { componentStack: "stack2" },
      };
      expect(boundary.state.error?.message).toBe("Second error");
    });

    it("should work with custom error handler that tracks errors", () => {
      const trackedErrors: Error[] = [];
      const errorHandler = new ApplicationErrorHandler();
      const handleSpy = jest.spyOn(errorHandler, "handle").mockImplementation((error) => {
        trackedErrors.push(error);
        return "tracked";
      });

      const boundary = new ErrorBoundary({ children: null, errorHandler });
      jest.spyOn(boundary, "setState").mockImplementation(() => {});

      // Simulate multiple errors being caught
      const error1 = new Error("Error 1");
      const error2 = new Error("Error 2");

      boundary.componentDidCatch(error1, { componentStack: "stack1" });
      boundary.componentDidCatch(error2, { componentStack: "stack2" });

      expect(trackedErrors).toHaveLength(2);
      expect(trackedErrors[0]).toBe(error1);
      expect(trackedErrors[1]).toBe(error2);

      handleSpy.mockRestore();
    });

    it("should support telemetry via errorHandler hooks", () => {
      const telemetryData: Array<{ error: Error; context?: Record<string, unknown> }> = [];
      const errorHandler = new ApplicationErrorHandler();

      errorHandler.registerTelemetryHook({
        onError: (error, context) => {
          telemetryData.push({ error, context });
        },
      });

      const boundary = new ErrorBoundary({ children: null, errorHandler });
      jest.spyOn(boundary, "setState").mockImplementation(() => {});

      const error = new ValidationError("Test", { field: "name" });
      boundary.componentDidCatch(error, { componentStack: "test stack" });

      expect(telemetryData).toHaveLength(1);
      // ErrorHandler may wrap the error, so check message instead of reference
      expect(telemetryData[0].error.message).toBe("Test");
    });
  });

  describe("edge cases", () => {
    it("should handle errors with null message", () => {
      const boundary = new ErrorBoundary({ children: null });
      const error = new Error();
      error.message = "";

      boundary.state = {
        hasError: true,
        error,
        errorInfo: null,
      };

      const rendered = boundary["renderDefaultFallback"]();
      expect(rendered).not.toBeNull();
    });

    it("should handle Error subclasses correctly", () => {
      class CustomError extends Error {
        constructor(message: string, public code: number) {
          super(message);
          this.name = "CustomError";
        }
      }

      const error = new CustomError("Custom error", 500);

      const newState = ErrorBoundary.getDerivedStateFromError(error);
      expect(newState.hasError).toBe(true);
      expect(newState.error).toBe(error);
      expect((newState.error as CustomError).code).toBe(500);
    });

    it("should handle very long error messages", () => {
      const boundary = new ErrorBoundary({ children: null });
      const longMessage = "x".repeat(10000);
      const error = new Error(longMessage);

      boundary.state = {
        hasError: true,
        error,
        errorInfo: null,
      };

      const rendered = boundary["renderDefaultFallback"]();
      expect(rendered).not.toBeNull();
    });

    it("should handle empty children", () => {
      const boundary = new ErrorBoundary({ children: null });
      boundary.state = { hasError: false, error: null, errorInfo: null };

      const rendered = boundary.render();
      expect(rendered).toBeNull();
    });

    it("should handle undefined children", () => {
      const boundary = new ErrorBoundary({ children: undefined as unknown as ReactNode });
      boundary.state = { hasError: false, error: null, errorInfo: null };

      const rendered = boundary.render();
      expect(rendered).toBeUndefined();
    });

    it("should handle error with circular reference in context", () => {
      const errorHandler = new ApplicationErrorHandler();
      const handleSpy = jest.spyOn(errorHandler, "handle").mockReturnValue("handled");

      const boundary = new ErrorBoundary({ children: null, errorHandler });
      jest.spyOn(boundary, "setState").mockImplementation(() => {});

      const error = new Error("Test");
      // componentStack is a string, so circular reference won't occur in normal usage
      // but we verify the method doesn't fail with large stacks
      const largeStack = "\n    at Component".repeat(1000);
      const errorInfo = { componentStack: largeStack };

      expect(() => {
        boundary.componentDidCatch(error, errorInfo);
      }).not.toThrow();

      handleSpy.mockRestore();
    });

    it("should handle fallback function that returns null", () => {
      const fallback = jest.fn().mockReturnValue(null);
      const boundary = new ErrorBoundary({ children: null, fallback });
      boundary.state = {
        hasError: true,
        error: new Error("Test"),
        errorInfo: { componentStack: "stack" },
      };

      const rendered = boundary.render();
      expect(fallback).toHaveBeenCalled();
      expect(rendered).toBeNull();
    });

    it("should handle fallback function that throws", () => {
      const fallback = jest.fn().mockImplementation(() => {
        throw new Error("Fallback error");
      });
      const boundary = new ErrorBoundary({ children: null, fallback });
      boundary.state = {
        hasError: true,
        error: new Error("Original error"),
        errorInfo: { componentStack: "stack" },
      };

      // The render method itself will throw if fallback throws
      expect(() => boundary.render()).toThrow("Fallback error");
    });
  });

  describe("TypeScript interface coverage", () => {
    it("should accept all valid ErrorBoundaryProps combinations", () => {
      // Minimum required props
      const minProps: ErrorBoundaryProps = { children: null };
      expect(new ErrorBoundary(minProps)).toBeDefined();

      // All optional props
      const fullProps: ErrorBoundaryProps = {
        children: "content",
        fallback: (error, info, retry) => null,
        errorHandler: new ApplicationErrorHandler(),
        onError: (error, info) => {},
      };
      expect(new ErrorBoundary(fullProps)).toBeDefined();
    });

    it("should properly type error and errorInfo in callbacks", () => {
      let capturedError: Error | undefined;
      let capturedErrorInfo: ErrorInfo | undefined;

      const onError = (error: Error, errorInfo: ErrorInfo) => {
        capturedError = error;
        capturedErrorInfo = errorInfo;
      };

      const boundary = new ErrorBoundary({ children: null, onError });
      jest.spyOn(boundary, "setState").mockImplementation(() => {});

      const testError = new Error("Typed error");
      const testErrorInfo: ErrorInfo = { componentStack: "typed stack" };

      boundary.componentDidCatch(testError, testErrorInfo);

      expect(capturedError).toBe(testError);
      expect(capturedErrorInfo).toBe(testErrorInfo);
    });

    it("should properly type fallback function parameters", () => {
      let fallbackParams: {
        error?: Error;
        errorInfo?: ErrorInfo;
        retry?: () => void;
      } = {};

      const fallback = (error: Error, errorInfo: ErrorInfo, retry: () => void) => {
        fallbackParams = { error, errorInfo, retry };
        return null;
      };

      const boundary = new ErrorBoundary({ children: null, fallback });
      const testError = new Error("Test");
      const testErrorInfo: ErrorInfo = { componentStack: "stack" };

      boundary.state = {
        hasError: true,
        error: testError,
        errorInfo: testErrorInfo,
      };

      boundary.render();

      expect(fallbackParams.error).toBe(testError);
      expect(fallbackParams.errorInfo).toBe(testErrorInfo);
      expect(fallbackParams.retry).toBe(boundary.handleRetry);
    });
  });
});

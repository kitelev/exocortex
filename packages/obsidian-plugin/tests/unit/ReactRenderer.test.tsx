import React, { ErrorInfo } from "react";
import { ReactRenderer } from "../../src/presentation/utils/ReactRenderer";
import { createRoot, Root } from "react-dom/client";
import { ErrorBoundary } from "../../src/presentation/components/ErrorBoundary";
import { LayoutErrorFallback } from "../../src/presentation/components/LayoutErrorFallback";

// Mock react-dom/client
jest.mock("react-dom/client", () => ({
  createRoot: jest.fn(),
}));

// Mock ErrorBoundary and LayoutErrorFallback
jest.mock("../../src/presentation/components/ErrorBoundary", () => ({
  ErrorBoundary: jest.fn(({ children }) => children),
}));

jest.mock("../../src/presentation/components/LayoutErrorFallback", () => ({
  LayoutErrorFallback: jest.fn(() => null),
}));

describe("ReactRenderer", () => {
  let renderer: ReactRenderer;
  let mockRoot: jest.Mocked<Root>;
  let mockElement: HTMLElement;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock root
    mockRoot = {
      render: jest.fn(),
      unmount: jest.fn(),
    } as unknown as jest.Mocked<Root>;

    // Mock createRoot to return our mock root
    (createRoot as jest.Mock).mockReturnValue(mockRoot);

    // Create mock HTML element
    mockElement = document.createElement("div");

    // Create renderer instance
    renderer = new ReactRenderer();
  });

  describe("constructor", () => {
    it("should initialize with empty roots map", () => {
      const newRenderer = new ReactRenderer();
      // Test that cleanup doesn't throw when no roots exist
      expect(() => newRenderer.cleanup()).not.toThrow();
    });
  });

  describe("render", () => {
    it("should create a new root and render component", () => {
      const component = <div>Test Component</div>;

      renderer.render(mockElement, component);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalledWith(component);
    });

    it("should unmount existing root before rendering new one", () => {
      const component1 = <div>Component 1</div>;
      const component2 = <div>Component 2</div>;

      // First render
      renderer.render(mockElement, component1);

      // Second render on same element
      renderer.render(mockElement, component2);

      // Should unmount first root
      expect(mockRoot.unmount).toHaveBeenCalledTimes(1);
      // Should create 2 roots total
      expect(createRoot).toHaveBeenCalledTimes(2);
      // Should render twice (once per component)
      expect(mockRoot.render).toHaveBeenCalledTimes(2);
    });

    it("should handle complex React components", () => {
      const ComplexComponent = () => (
        <div>
          <h1>Title</h1>
          <p>Content</p>
          <button onClick={() => {}}>Click me</button>
        </div>
      );

      renderer.render(mockElement, <ComplexComponent />);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalled();
    });

    it("should handle components with props", () => {
      interface TestProps {
        title: string;
        count: number;
        onClick: () => void;
      }

      const TestComponent: React.FC<TestProps> = ({ title, count, onClick }) => (
        <div onClick={onClick}>
          {title}: {count}
        </div>
      );

      const props = {
        title: "Test",
        count: 42,
        onClick: jest.fn(),
      };

      renderer.render(mockElement, <TestComponent {...props} />);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalled();
    });

    it("should render to multiple elements independently", () => {
      const element1 = document.createElement("div");
      const element2 = document.createElement("span");
      const component1 = <div>Component 1</div>;
      const component2 = <span>Component 2</span>;

      renderer.render(element1, component1);
      renderer.render(element2, component2);

      expect(createRoot).toHaveBeenCalledTimes(2);
      expect(createRoot).toHaveBeenCalledWith(element1);
      expect(createRoot).toHaveBeenCalledWith(element2);
      expect(mockRoot.render).toHaveBeenCalledTimes(2);
    });

    it("should handle null/undefined components gracefully", () => {
      renderer.render(mockElement, null as any);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalledWith(null);
    });

    it("should handle fragments", () => {
      const fragment = (
        <>
          <div>First</div>
          <div>Second</div>
        </>
      );

      renderer.render(mockElement, fragment);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalledWith(fragment);
    });

    it("should handle React.memo components", () => {
      const MemoComponent = React.memo(() => <div>Memoized</div>);

      renderer.render(mockElement, <MemoComponent />);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalled();
    });

    it("should handle React.lazy components", () => {
      const LazyComponent = React.lazy(() =>
        Promise.resolve({ default: () => <div>Lazy</div> })
      );

      renderer.render(mockElement, <LazyComponent />);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalled();
    });

    it("should maintain separate roots for different elements", () => {
      const element1 = document.createElement("div");
      const element2 = document.createElement("span");
      const mockRoot1 = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as jest.Mocked<Root>;
      const mockRoot2 = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as jest.Mocked<Root>;

      (createRoot as jest.Mock)
        .mockReturnValueOnce(mockRoot1)
        .mockReturnValueOnce(mockRoot2);

      renderer.render(element1, <div>Component 1</div>);
      renderer.render(element2, <div>Component 2</div>);

      // Unmount first element
      renderer.unmount(element1);

      expect(mockRoot1.unmount).toHaveBeenCalled();
      expect(mockRoot2.unmount).not.toHaveBeenCalled();
    });
  });

  describe("unmount", () => {
    it("should unmount root for given element", () => {
      const component = <div>Test</div>;

      renderer.render(mockElement, component);
      renderer.unmount(mockElement);

      expect(mockRoot.unmount).toHaveBeenCalled();
    });

    it("should handle unmounting non-existent element gracefully", () => {
      const nonExistentElement = document.createElement("div");

      expect(() => renderer.unmount(nonExistentElement)).not.toThrow();
    });

    it("should remove root from internal map after unmounting", () => {
      const component = <div>Test</div>;

      renderer.render(mockElement, component);
      renderer.unmount(mockElement);

      // Rendering again should create new root
      renderer.render(mockElement, component);

      expect(createRoot).toHaveBeenCalledTimes(2);
    });

    it("should handle multiple unmounts on same element", () => {
      const component = <div>Test</div>;

      renderer.render(mockElement, component);
      renderer.unmount(mockElement);
      renderer.unmount(mockElement); // Second unmount

      expect(mockRoot.unmount).toHaveBeenCalledTimes(1);
    });

    it("should unmount specific elements independently", () => {
      const element1 = document.createElement("div");
      const element2 = document.createElement("span");
      const mockRoot1 = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as jest.Mocked<Root>;
      const mockRoot2 = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as jest.Mocked<Root>;

      (createRoot as jest.Mock)
        .mockReturnValueOnce(mockRoot1)
        .mockReturnValueOnce(mockRoot2);

      renderer.render(element1, <div>Component 1</div>);
      renderer.render(element2, <div>Component 2</div>);

      renderer.unmount(element1);

      expect(mockRoot1.unmount).toHaveBeenCalled();
      expect(mockRoot2.unmount).not.toHaveBeenCalled();
    });

    it("should allow re-rendering after unmount", () => {
      const component1 = <div>Component 1</div>;
      const component2 = <div>Component 2</div>;

      renderer.render(mockElement, component1);
      renderer.unmount(mockElement);
      renderer.render(mockElement, component2);

      expect(createRoot).toHaveBeenCalledTimes(2);
      expect(mockRoot.render).toHaveBeenCalledTimes(2);
      expect(mockRoot.unmount).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanup", () => {
    it("should unmount all roots", () => {
      const element1 = document.createElement("div");
      const element2 = document.createElement("span");
      const element3 = document.createElement("p");

      const mockRoot1 = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as jest.Mocked<Root>;
      const mockRoot2 = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as jest.Mocked<Root>;
      const mockRoot3 = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as jest.Mocked<Root>;

      (createRoot as jest.Mock)
        .mockReturnValueOnce(mockRoot1)
        .mockReturnValueOnce(mockRoot2)
        .mockReturnValueOnce(mockRoot3);

      renderer.render(element1, <div>Component 1</div>);
      renderer.render(element2, <div>Component 2</div>);
      renderer.render(element3, <div>Component 3</div>);

      renderer.cleanup();

      expect(mockRoot1.unmount).toHaveBeenCalled();
      expect(mockRoot2.unmount).toHaveBeenCalled();
      expect(mockRoot3.unmount).toHaveBeenCalled();
    });

    it("should clear internal roots map", () => {
      const component = <div>Test</div>;

      renderer.render(mockElement, component);
      renderer.cleanup();

      // Rendering again should create new root
      renderer.render(mockElement, component);

      expect(createRoot).toHaveBeenCalledTimes(2);
    });

    it("should handle cleanup when no roots exist", () => {
      expect(() => renderer.cleanup()).not.toThrow();
    });

    it("should handle multiple cleanup calls", () => {
      const component = <div>Test</div>;

      renderer.render(mockElement, component);

      renderer.cleanup();
      renderer.cleanup(); // Second cleanup

      expect(mockRoot.unmount).toHaveBeenCalledTimes(1);
    });

    it("should allow rendering after cleanup", () => {
      const component1 = <div>Component 1</div>;
      const component2 = <div>Component 2</div>;

      renderer.render(mockElement, component1);
      renderer.cleanup();
      renderer.render(mockElement, component2);

      expect(createRoot).toHaveBeenCalledTimes(2);
      expect(mockRoot.render).toHaveBeenCalledTimes(2);
    });

    it("should handle errors during unmount gracefully", () => {
      const errorRoot = {
        render: jest.fn(),
        unmount: jest.fn().mockImplementation(() => {
          throw new Error("Unmount failed");
        }),
      } as unknown as jest.Mocked<Root>;

      (createRoot as jest.Mock).mockReturnValue(errorRoot);

      renderer.render(mockElement, <div>Test</div>);

      expect(() => renderer.cleanup()).toThrow("Unmount failed");
    });
  });

  describe("edge cases", () => {
    it("should handle rendering to same element multiple times rapidly", () => {
      const components = [
        <div key="1">Component 1</div>,
        <div key="2">Component 2</div>,
        <div key="3">Component 3</div>,
        <div key="4">Component 4</div>,
        <div key="5">Component 5</div>,
      ];

      components.forEach(component => {
        renderer.render(mockElement, component);
      });

      // Should unmount 4 times (all except the last)
      expect(mockRoot.unmount).toHaveBeenCalledTimes(4);
      // Should create 5 roots
      expect(createRoot).toHaveBeenCalledTimes(5);
      // Should render 5 times
      expect(mockRoot.render).toHaveBeenCalledTimes(5);
    });

    it("should handle large number of elements", () => {
      const elements: HTMLElement[] = [];
      const roots: jest.Mocked<Root>[] = [];

      for (let i = 0; i < 100; i++) {
        elements.push(document.createElement("div"));
        const mockRoot = {
          render: jest.fn(),
          unmount: jest.fn(),
        } as unknown as jest.Mocked<Root>;
        roots.push(mockRoot);
        (createRoot as jest.Mock).mockReturnValueOnce(mockRoot);
      }

      elements.forEach((element, i) => {
        renderer.render(element, <div>Component {i}</div>);
      });

      renderer.cleanup();

      roots.forEach(root => {
        expect(root.unmount).toHaveBeenCalled();
      });
    });

    it("should handle rendering React context providers", () => {
      const ThemeContext = React.createContext("light");

      const component = (
        <ThemeContext.Provider value="dark">
          <div>Themed component</div>
        </ThemeContext.Provider>
      );

      renderer.render(mockElement, component);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalledWith(component);
    });

    it("should handle rendering error boundaries", () => {
      class ErrorBoundary extends React.Component {
        componentDidCatch() {}
        render() {
          return this.props.children;
        }
      }

      const component = (
        <ErrorBoundary>
          <div>Protected component</div>
        </ErrorBoundary>
      );

      renderer.render(mockElement, component);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalledWith(component);
    });

    it("should handle rendering portals", () => {
      const portalTarget = document.createElement("div");
      const ReactDOM = require("react-dom");

      const component = (
        <div>
          {ReactDOM.createPortal(
            <div>Portal content</div>,
            portalTarget
          )}
        </div>
      );

      renderer.render(mockElement, component);

      expect(createRoot).toHaveBeenCalledWith(mockElement);
      expect(mockRoot.render).toHaveBeenCalledWith(component);
    });

    it("should maintain correct state after sequence of operations", () => {
      const element1 = document.createElement("div");
      const element2 = document.createElement("span");
      const element3 = document.createElement("p");

      // Render to three elements
      renderer.render(element1, <div>1</div>);
      renderer.render(element2, <div>2</div>);
      renderer.render(element3, <div>3</div>);

      // Unmount one
      renderer.unmount(element2);

      // Re-render to unmounted element
      renderer.render(element2, <div>2 Updated</div>);

      // Cleanup
      renderer.cleanup();

      // All operations should complete without errors
      expect(createRoot).toHaveBeenCalledTimes(4);
    });
  });

  describe("memory management", () => {
    it("should not leak references after unmount", () => {
      const component = <div>Test</div>;

      renderer.render(mockElement, component);
      renderer.unmount(mockElement);

      // After unmount, rendering to same element should create new root
      renderer.render(mockElement, component);

      expect(createRoot).toHaveBeenCalledTimes(2);
    });

    it("should not leak references after cleanup", () => {
      const elements = Array.from({ length: 10 }, () =>
        document.createElement("div")
      );

      elements.forEach((element, i) => {
        renderer.render(element, <div>Component {i}</div>);
      });

      renderer.cleanup();

      // After cleanup, all roots should be gone
      elements.forEach((element, i) => {
        renderer.render(element, <div>New Component {i}</div>);
      });

      // Should have created 20 roots total (10 before + 10 after cleanup)
      expect(createRoot).toHaveBeenCalledTimes(20);
    });
  });

  describe("ErrorBoundary integration", () => {
    let mockElement: HTMLElement;
    let mockRoot: jest.Mocked<Root>;

    beforeEach(() => {
      jest.clearAllMocks();
      mockRoot = {
        render: jest.fn(),
        unmount: jest.fn(),
      } as unknown as jest.Mocked<Root>;
      (createRoot as jest.Mock).mockReturnValue(mockRoot);
      mockElement = document.createElement("div");
    });

    describe("constructor config", () => {
      it("should accept empty config", () => {
        const renderer = new ReactRenderer();
        expect(renderer).toBeDefined();
      });

      it("should accept config with useErrorBoundary", () => {
        const renderer = new ReactRenderer({ useErrorBoundary: true });
        expect(renderer).toBeDefined();
      });

      it("should accept config with onError callback", () => {
        const onError = jest.fn();
        const renderer = new ReactRenderer({
          useErrorBoundary: true,
          onError,
        });
        expect(renderer).toBeDefined();
      });
    });

    describe("render with useErrorBoundary: false (default)", () => {
      it("should render component without ErrorBoundary wrapper", () => {
        const renderer = new ReactRenderer({ useErrorBoundary: false });
        const component = <div>Test</div>;

        renderer.render(mockElement, component);

        expect(mockRoot.render).toHaveBeenCalledWith(component);
        expect(ErrorBoundary).not.toHaveBeenCalled();
      });
    });

    describe("render with useErrorBoundary: true", () => {
      it("should wrap component with ErrorBoundary", () => {
        const renderer = new ReactRenderer({ useErrorBoundary: true });
        const component = <div>Test Component</div>;

        renderer.render(mockElement, component);

        expect(ErrorBoundary).toHaveBeenCalled();
        expect(createRoot).toHaveBeenCalledWith(mockElement);
        expect(mockRoot.render).toHaveBeenCalled();
      });

      it("should pass onError callback to ErrorBoundary", () => {
        const onError = jest.fn();
        const renderer = new ReactRenderer({
          useErrorBoundary: true,
          onError,
        });
        const component = <div>Test</div>;

        renderer.render(mockElement, component);

        // Verify ErrorBoundary was called with onError prop
        expect(ErrorBoundary).toHaveBeenCalled();
        const errorBoundaryCall = (ErrorBoundary as jest.Mock).mock.calls[0][0];
        expect(errorBoundaryCall.onError).toBe(onError);
      });

      it("should pass fallback function to ErrorBoundary", () => {
        const renderer = new ReactRenderer({ useErrorBoundary: true });
        const component = <div>Test</div>;

        renderer.render(mockElement, component);

        expect(ErrorBoundary).toHaveBeenCalled();
        const errorBoundaryCall = (ErrorBoundary as jest.Mock).mock.calls[0][0];
        expect(typeof errorBoundaryCall.fallback).toBe("function");
      });

      it("should create LayoutErrorFallback when fallback is called", () => {
        const renderer = new ReactRenderer({ useErrorBoundary: true });
        const component = <div>Test</div>;

        renderer.render(mockElement, component);

        const errorBoundaryCall = (ErrorBoundary as jest.Mock).mock.calls[0][0];
        const fallbackFn = errorBoundaryCall.fallback;

        const error = new Error("Test error");
        const errorInfo: ErrorInfo = { componentStack: "test stack" };
        const retry = jest.fn();

        fallbackFn(error, errorInfo, retry);

        expect(LayoutErrorFallback).toHaveBeenCalledWith(
          expect.objectContaining({
            error,
            errorInfo,
            onRetry: retry,
          }),
          expect.anything()
        );
      });

      it("should wrap multiple renders with ErrorBoundary", () => {
        const renderer = new ReactRenderer({ useErrorBoundary: true });
        const element1 = document.createElement("div");
        const element2 = document.createElement("div");

        renderer.render(element1, <div>Component 1</div>);
        renderer.render(element2, <div>Component 2</div>);

        expect(ErrorBoundary).toHaveBeenCalledTimes(2);
      });

      it("should unmount before re-rendering with ErrorBoundary", () => {
        const renderer = new ReactRenderer({ useErrorBoundary: true });

        renderer.render(mockElement, <div>First</div>);
        renderer.render(mockElement, <div>Second</div>);

        expect(mockRoot.unmount).toHaveBeenCalledTimes(1);
        expect(ErrorBoundary).toHaveBeenCalledTimes(2);
      });
    });

    describe("renderWithErrorBoundary method", () => {
      it("should wrap component with ErrorBoundary", () => {
        const renderer = new ReactRenderer();
        const component = <div>Test</div>;

        renderer.renderWithErrorBoundary(mockElement, component);

        expect(ErrorBoundary).toHaveBeenCalled();
        expect(createRoot).toHaveBeenCalledWith(mockElement);
        expect(mockRoot.render).toHaveBeenCalled();
      });

      it("should pass onError from options to ErrorBoundary", () => {
        const renderer = new ReactRenderer();
        const onError = jest.fn();
        const component = <div>Test</div>;

        renderer.renderWithErrorBoundary(mockElement, component, { onError });

        expect(ErrorBoundary).toHaveBeenCalled();
        const errorBoundaryCall = (ErrorBoundary as jest.Mock).mock.calls[0][0];
        expect(errorBoundaryCall.onError).toBe(onError);
      });

      it("should unmount existing root before rendering", () => {
        const renderer = new ReactRenderer();

        renderer.renderWithErrorBoundary(mockElement, <div>First</div>);
        renderer.renderWithErrorBoundary(mockElement, <div>Second</div>);

        expect(mockRoot.unmount).toHaveBeenCalledTimes(1);
      });
    });
  });
});
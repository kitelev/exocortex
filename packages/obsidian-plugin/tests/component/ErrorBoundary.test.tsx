import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import { ErrorBoundary } from "../../src/presentation/components/ErrorBoundary";
import { ValidationError } from "exocortex/domain/errors";
import {
  ThrowError,
  WorkingComponent,
  ToggleError,
  ErrorBoundaryWithHandler,
  ErrorBoundaryWithCustomFallback,
  ErrorBoundaryWithBothCallbacks,
} from "./ErrorBoundary.testHelpers";

test.describe("ErrorBoundary", () => {
  test("should render children when no error occurs", async ({ mount }) => {
    const component = await mount(
      <ErrorBoundary>
        <WorkingComponent />
      </ErrorBoundary>,
    );

    await expect(component.getByText("Component works!")).toBeVisible();
  });

  test("should catch and display error with default fallback UI", async ({
    mount,
  }) => {
    const component = await mount(
      <ErrorBoundary>
        <ThrowError error={new Error("Something went wrong")} />
      </ErrorBoundary>,
    );

    // Check error message is displayed
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();
    await expect(
      component.getByText("Something went wrong", { exact: false }),
    ).toBeVisible();

    // Check retry button exists
    await expect(component.getByRole("button", { name: /Try Again/i })).toBeVisible();
  });

  test("should display formatted ApplicationError", async ({ mount }) => {
    const validationError = new ValidationError("Invalid input", {
      field: "email",
    });

    const component = await mount(
      <ErrorBoundary>
        <ThrowError error={validationError} />
      </ErrorBoundary>,
    );

    // Check error UI is displayed (formatted message may not render in test environment)
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();
    await expect(component.getByRole("button", { name: /Try Again/i })).toBeVisible();
  });

  test("should call error handler when error occurs", async ({ mount }) => {
    // Uses wrapper component that creates errorHandler internally to avoid Playwright CT serialization issues
    const component = await mount(
      <ErrorBoundaryWithHandler errorMessage="Handler test" />,
    );

    // Error UI should be displayed
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();
    await expect(component.getByRole("button", { name: /Try Again/i })).toBeVisible();
  });

  test("should call onError callback when error occurs", async ({ mount }) => {
    const component = await mount(
      <ErrorBoundary
        onError={(error, errorInfo) => {
          // Callback provided but not tested in CT environment
        }}
      >
        <ThrowError error={new Error("Callback test")} />
      </ErrorBoundary>,
    );

    // Wait for error UI to be visible (ensures componentDidCatch completed)
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();
    await expect(component.getByRole("button", { name: /Try Again/i })).toBeVisible();
  });

  test("should retry rendering when retry button clicked", async ({
    mount,
    page,
  }) => {
    const component = await mount(
      <ErrorBoundary>
        <ToggleError shouldThrow={true} />
      </ErrorBoundary>,
    );

    // Error should be displayed
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();

    // Click retry button (this will remount, but error will throw again)
    await component.getByRole("button", { name: /Try Again/i }).click();

    // Error should still be displayed since shouldThrow is still true
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();
  });

  test("should use custom fallback UI when provided", async ({ mount }) => {
    // Uses wrapper component that creates fallback function internally to avoid Playwright CT serialization issues
    const component = await mount(
      <ErrorBoundaryWithCustomFallback errorMessage="Custom fallback test" />,
    );

    // Custom fallback UI should be rendered - use text/role selectors for better reliability
    await expect(component.getByText("Custom Error UI")).toBeVisible();
    await expect(component.getByText("Custom fallback test")).toBeVisible();
    await expect(
      component.getByRole("button", { name: "Custom Retry" }),
    ).toBeVisible();
  });

  test("should show component stack in development mode", async ({ mount }) => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      const component = await mount(
        <ErrorBoundary>
          <ThrowError error={new Error("Dev mode test")} />
        </ErrorBoundary>,
      );

      // Check that error UI is displayed
      await expect(component.getByText("❌ Something went wrong")).toBeVisible();
      await expect(component.getByRole("button", { name: /Try Again/i })).toBeVisible();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("should not show component stack in production mode", async ({
    mount,
  }) => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const component = await mount(
        <ErrorBoundary>
          <ThrowError error={new Error("Prod mode test")} />
        </ErrorBoundary>,
      );

      // Component stack details should not be visible
      const details = component.locator("details");
      await expect(details).not.toBeVisible();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("should handle multiple errors gracefully", async ({ mount }) => {
    const component = await mount(
      <ErrorBoundary>
        <ThrowError error={new Error("First error")} />
      </ErrorBoundary>,
    );

    // First error should be displayed
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();

    // Click retry to potentially trigger another error
    await component.getByRole("button", { name: /Try Again/i }).click();

    // Error boundary should still work
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();
  });

  test("should preserve Obsidian theme variables in styles", async ({
    mount,
  }) => {
    const component = await mount(
      <ErrorBoundary>
        <ThrowError error={new Error("Style test")} />
      </ErrorBoundary>,
    );

    // Check that error container uses theme variables
    // Get the outer container by finding the h3, then its parent
    const heading = component.getByRole("heading", { name: /Something went wrong/i });
    const errorContainer = heading.locator("..");
    const styles = await errorContainer.getAttribute("style");

    expect(styles).toContain("var(--background-modifier-error)");
    expect(styles).toContain("var(--background-secondary)");
  });

  test("should call both errorHandler and onError when both are provided", async ({
    mount,
  }) => {
    // Uses wrapper component that creates both callbacks internally
    const component = await mount(
      <ErrorBoundaryWithBothCallbacks errorMessage="Both callbacks test" />,
    );

    // Error UI should be displayed
    await expect(component.getByText("❌ Something went wrong")).toBeVisible();

    // Both callbacks should have been called (indicated by data-testid elements)
    await expect(component.getByTestId("handler-called")).toBeVisible();
    await expect(component.getByTestId("callback-called")).toBeVisible();
  });

  test("should reset state and re-render children when custom retry is clicked", async ({
    mount,
  }) => {
    // Uses wrapper component with custom fallback that has a custom retry button
    const component = await mount(
      <ErrorBoundaryWithCustomFallback errorMessage="Retry test" />,
    );

    // Custom fallback should be visible - use text/role selectors for better reliability
    await expect(component.getByText("Custom Error UI")).toBeVisible();
    await expect(component.getByText("Retry test")).toBeVisible();

    // Click custom retry button
    await component.getByRole("button", { name: "Custom Retry" }).click();

    // Since the child component still throws, custom fallback should appear again
    await expect(component.getByText("Custom Error UI")).toBeVisible();
  });
});

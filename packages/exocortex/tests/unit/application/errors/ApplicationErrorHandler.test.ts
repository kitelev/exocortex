import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  ApplicationErrorHandler,
  type ErrorTelemetryHook,
} from "../../../../src/application/errors/index.js";
import {
  NetworkError,
  ValidationError,
  ApplicationError,
} from "../../../../src/domain/errors/index.js";

describe("ApplicationErrorHandler", () => {
  let handler: ApplicationErrorHandler;

  beforeEach(() => {
    handler = new ApplicationErrorHandler();
  });

  describe("handle()", () => {
    it("should format ApplicationError", () => {
      const error = new ValidationError("Invalid input", { field: "email" });
      const result = handler.handle(error);

      expect(result).toContain("❌ ValidationError:");
      expect(result).toContain("Invalid input");
      expect(result).toContain("💡");
      expect(result).toContain("field");
    });

    it("should handle plain Error by converting to ApplicationError", () => {
      const error = new Error("Something went wrong");
      const result = handler.handle(error);

      expect(result).toContain("❌ UnknownError:");
      expect(result).toContain("Something went wrong");
    });

    it("should merge context for ApplicationError", () => {
      const error = new ValidationError("Test", { field: "name" });
      const result = handler.handle(error, { userId: 123 });

      expect(result).toContain("field");
      expect(result).toContain("userId");
    });

    it("should call telemetry hooks on error", () => {
      const mockHook: ErrorTelemetryHook = {
        onError: jest.fn(),
      };
      handler.registerTelemetryHook(mockHook);

      const error = new ValidationError("Test");
      handler.handle(error);

      expect(mockHook.onError).toHaveBeenCalledWith(
        error,
        undefined,
      );
    });
  });

  describe("executeWithRetry()", () => {
    it("should return result on first success", async () => {
      const operation = jest.fn().mockResolvedValue("success");

      const result = await handler.executeWithRetry(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry retriable errors", async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new NetworkError("Connection failed"))
        .mockRejectedValueOnce(new NetworkError("Timeout"))
        .mockResolvedValue("success");

      const result = await handler.executeWithRetry(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should not retry non-retriable errors", async () => {
      const operation = jest
        .fn()
        .mockRejectedValue(new ValidationError("Invalid input"));

      await expect(handler.executeWithRetry(operation)).rejects.toThrow(
        ValidationError,
      );
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should throw after max retries exhausted", async () => {
      const handler = new ApplicationErrorHandler({ maxRetries: 2 });
      const operation = jest
        .fn()
        .mockRejectedValue(new NetworkError("Connection failed"));

      await expect(handler.executeWithRetry(operation)).rejects.toThrow(
        NetworkError,
      );
      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should use exponential backoff", async () => {
      const handler = new ApplicationErrorHandler({
        maxRetries: 3,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        maxDelayMs: 10000,
      });

      const delays: number[] = [];
      const operation = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((_, reject) =>
              setTimeout(() => reject(new NetworkError("Failed")), 10),
            ),
        );

      const startTime = Date.now();
      try {
        await handler.executeWithRetry(operation);
      } catch {
        // Expected to fail
      }
      const totalTime = Date.now() - startTime;

      // Delays should be: 100ms, 200ms, 400ms = 700ms total minimum
      expect(totalTime).toBeGreaterThanOrEqual(700);
      expect(totalTime).toBeLessThan(1500); // Allow some overhead
    });

    it("should respect maxDelayMs cap", async () => {
      const handler = new ApplicationErrorHandler({
        maxRetries: 10,
        initialDelayMs: 1000,
        backoffMultiplier: 10,
        maxDelayMs: 2000, // Cap at 2 seconds
      });

      const operation = jest
        .fn()
        .mockRejectedValue(new NetworkError("Failed"));

      const startTime = Date.now();
      try {
        await handler.executeWithRetry(operation);
      } catch {
        // Expected to fail
      }
      const totalTime = Date.now() - startTime;

      // Even with 10x multiplier, delays should be capped at 2000ms
      // Total should be less than 10 * 2000ms = 20 seconds
      expect(totalTime).toBeLessThan(20000);
    });

    it("should call telemetry hooks on retry", async () => {
      const mockHook: ErrorTelemetryHook = {
        onError: jest.fn(),
        onRetry: jest.fn(),
      };
      handler.registerTelemetryHook(mockHook);

      const error = new NetworkError("Failed");
      const operation = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue("success");

      await handler.executeWithRetry(operation);

      expect(mockHook.onRetry).toHaveBeenCalledWith(error, 1, 1000);
    });

    it("should call telemetry hooks when retries exhausted", async () => {
      const mockHook: ErrorTelemetryHook = {
        onError: jest.fn(),
        onRetryExhausted: jest.fn(),
      };

      const handler = new ApplicationErrorHandler({ maxRetries: 2 });
      handler.registerTelemetryHook(mockHook);

      const error = new NetworkError("Failed");
      const operation = jest.fn().mockRejectedValue(error);

      try {
        await handler.executeWithRetry(operation);
      } catch {
        // Expected
      }

      expect(mockHook.onRetryExhausted).toHaveBeenCalledWith(error, 3);
    });

    it("should handle hook errors gracefully", async () => {
      const badHook: ErrorTelemetryHook = {
        onError: jest.fn().mockImplementation(() => {
          throw new Error("Hook failed");
        }),
      };
      handler.registerTelemetryHook(badHook);

      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const error = new ValidationError("Test");
      const result = handler.handle(error);

      expect(result).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error in telemetry hook:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it("should merge context from executeWithRetry", async () => {
      const mockHook: ErrorTelemetryHook = {
        onError: jest.fn(),
      };
      handler.registerTelemetryHook(mockHook);

      const error = new ValidationError("Test", { field: "email" });
      const operation = jest.fn().mockRejectedValue(error);

      try {
        await handler.executeWithRetry(operation, { userId: 123 });
      } catch {
        // Expected
      }

      expect(mockHook.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            field: "email",
            userId: 123,
          }),
        }),
        { userId: 123 },
      );
    });
  });

  describe("Telemetry hook management", () => {
    it("should register telemetry hook", () => {
      const mockHook: ErrorTelemetryHook = {
        onError: jest.fn(),
      };
      handler.registerTelemetryHook(mockHook);

      const error = new ValidationError("Test");
      handler.handle(error);

      expect(mockHook.onError).toHaveBeenCalled();
    });

    it("should unregister telemetry hook", () => {
      const mockHook: ErrorTelemetryHook = {
        onError: jest.fn(),
      };
      handler.registerTelemetryHook(mockHook);
      handler.unregisterTelemetryHook(mockHook);

      const error = new ValidationError("Test");
      handler.handle(error);

      expect(mockHook.onError).not.toHaveBeenCalled();
    });

    it("should support multiple telemetry hooks", () => {
      const hook1: ErrorTelemetryHook = { onError: jest.fn() };
      const hook2: ErrorTelemetryHook = { onError: jest.fn() };

      handler.registerTelemetryHook(hook1);
      handler.registerTelemetryHook(hook2);

      const error = new ValidationError("Test");
      handler.handle(error);

      expect(hook1.onError).toHaveBeenCalled();
      expect(hook2.onError).toHaveBeenCalled();
    });
  });

  describe("Retry configuration", () => {
    it("should use default configuration", async () => {
      const operation = jest
        .fn()
        .mockRejectedValue(new NetworkError("Failed"));

      try {
        await handler.executeWithRetry(operation);
      } catch {
        // Expected
      }

      // Default: maxRetries = 3, so 4 total attempts
      expect(operation).toHaveBeenCalledTimes(4);
    });

    it("should override retry configuration", async () => {
      const handler = new ApplicationErrorHandler({
        maxRetries: 1,
        initialDelayMs: 50,
      });

      const operation = jest
        .fn()
        .mockRejectedValue(new NetworkError("Failed"));

      try {
        await handler.executeWithRetry(operation);
      } catch {
        // Expected
      }

      // maxRetries = 1, so 2 total attempts
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should handle zero retries", async () => {
      const handler = new ApplicationErrorHandler({ maxRetries: 0 });

      const operation = jest
        .fn()
        .mockRejectedValue(new NetworkError("Failed"));

      try {
        await handler.executeWithRetry(operation);
      } catch {
        // Expected
      }

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe("Plain Error handling", () => {
    it("should wrap plain Error as UnknownError", () => {
      const error = new Error("Generic error");
      const result = handler.handle(error);

      expect(result).toContain("UnknownError");
      expect(result).toContain("Generic error");
      expect(result).toContain("💡");
    });

    it("should not retry plain errors by default", async () => {
      const operation = jest.fn().mockRejectedValue(new Error("Failed"));

      try {
        await handler.executeWithRetry(operation);
      } catch {
        // Expected
      }

      expect(operation).toHaveBeenCalledTimes(1); // No retries
    });

    it("should include originalError in context", () => {
      const error = new Error("Test error");
      error.name = "CustomError";
      const result = handler.handle(error);

      expect(result).toContain("originalError");
      expect(result).toContain("CustomError");
    });
  });
});

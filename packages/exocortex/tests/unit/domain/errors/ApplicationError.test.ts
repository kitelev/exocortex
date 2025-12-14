import { describe, it, expect } from "@jest/globals";
import {
  ApplicationError,
  ErrorCode,
  ValidationError,
  NetworkError,
  StateTransitionError,
  PermissionError,
  NotFoundError,
  ResourceExhaustedError,
} from "../../../../src/domain/errors/index.js";

describe("ApplicationError", () => {
  describe("ValidationError", () => {
    it("should create error with correct properties", () => {
      const error = new ValidationError("Invalid input", {
        field: "email",
        value: "invalid-email",
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.name).toBe("ValidationError");
      expect(error.message).toBe("Invalid input");
      expect(error.code).toBe(ErrorCode.INVALID_INPUT);
      expect(error.retriable).toBe(false);
      expect(error.guidance).toContain("Check the input data");
      expect(error.context).toEqual({
        field: "email",
        value: "invalid-email",
      });
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it("should format error with guidance and context", () => {
      const error = new ValidationError("Missing required field", {
        field: "name",
      });
      const formatted = error.format();

      expect(formatted).toContain("❌ ValidationError:");
      expect(formatted).toContain("Missing required field");
      expect(formatted).toContain("💡");
      expect(formatted).toContain("Check the input data");
      expect(formatted).toContain("📋 Context:");
      expect(formatted).toContain("field");
      expect(formatted).toContain("name");
    });

    it("should convert error to JSON", () => {
      const error = new ValidationError("Invalid format", { type: "email" });
      const json = error.toJSON();

      expect(json.name).toBe("ValidationError");
      expect(json.message).toBe("Invalid format");
      expect(json.code).toBe(ErrorCode.INVALID_INPUT);
      expect(json.retriable).toBe(false);
      expect(json.timestamp).toBeDefined();
      expect(json.context).toEqual({ type: "email" });
      expect(json.stack).toBeDefined();
    });

    it("should capture stack trace", () => {
      const error = new ValidationError("Test error");
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("ValidationError");
    });
  });

  describe("NetworkError", () => {
    it("should be retriable", () => {
      const error = new NetworkError("Connection failed");
      expect(error.retriable).toBe(true);
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
    });

    it("should have network-specific guidance", () => {
      const error = new NetworkError("Timeout");
      expect(error.guidance).toContain("network");
      expect(error.guidance).toContain("connection");
    });
  });

  describe("StateTransitionError", () => {
    it("should not be retriable", () => {
      const error = new StateTransitionError(
        "Invalid transition from Finished to Todo",
        { from: "Finished", to: "Todo" },
      );
      expect(error.retriable).toBe(false);
      expect(error.code).toBe(ErrorCode.INVALID_TRANSITION);
    });

    it("should include transition context", () => {
      const error = new StateTransitionError("Invalid transition", {
        from: "Active",
        to: "Cancelled",
      });
      const json = error.toJSON();
      expect(json.context).toEqual({ from: "Active", to: "Cancelled" });
    });
  });

  describe("PermissionError", () => {
    it("should not be retriable", () => {
      const error = new PermissionError("Permission denied");
      expect(error.retriable).toBe(false);
      expect(error.code).toBe(ErrorCode.PERMISSION_DENIED);
    });

    it("should have permission-specific guidance", () => {
      const error = new PermissionError("Access forbidden");
      expect(error.guidance).toContain("permission");
      expect(error.guidance).toContain("privileges");
    });
  });

  describe("NotFoundError", () => {
    it("should not be retriable", () => {
      const error = new NotFoundError("File not found");
      expect(error.retriable).toBe(false);
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
    });

    it("should include resource path in context", () => {
      const error = new NotFoundError("Note not found", {
        path: "Projects/My Project.md",
      });
      expect(error.context?.path).toBe("Projects/My Project.md");
    });
  });

  describe("ResourceExhaustedError", () => {
    it("should be retriable", () => {
      const error = new ResourceExhaustedError("Out of memory");
      expect(error.retriable).toBe(true);
      expect(error.code).toBe(ErrorCode.RESOURCE_EXHAUSTED);
    });

    it("should have resource-specific guidance", () => {
      const error = new ResourceExhaustedError("Rate limit exceeded");
      expect(error.guidance).toContain("resource");
      expect(error.guidance).toContain("limit");
    });
  });

  describe("Error inheritance", () => {
    it("should properly extend Error", () => {
      const error = new ValidationError("Test");
      expect(error instanceof Error).toBe(true);
      expect(error instanceof ApplicationError).toBe(true);
    });

    it("should have correct prototype chain", () => {
      const error = new NetworkError("Test");
      expect(Object.getPrototypeOf(error)).toBe(NetworkError.prototype);
      expect(
        Object.getPrototypeOf(Object.getPrototypeOf(error)),
      ).toBe(ApplicationError.prototype);
    });
  });

  describe("Context handling", () => {
    it("should handle undefined context", () => {
      const error = new ValidationError("Test");
      expect(error.context).toBeUndefined();
      const formatted = error.format();
      expect(formatted).not.toContain("📋 Context:");
    });

    it("should handle empty context object", () => {
      const error = new ValidationError("Test", {});
      const formatted = error.format();
      expect(formatted).not.toContain("📋 Context:");
    });

    it("should handle complex context values", () => {
      const error = new ValidationError("Test", {
        nested: { foo: "bar" },
        array: [1, 2, 3],
        number: 42,
        boolean: true,
      });
      const formatted = error.format();
      expect(formatted).toContain("nested");
      expect(formatted).toContain("array");
      expect(formatted).toContain("number");
      expect(formatted).toContain("boolean");
    });
  });
});

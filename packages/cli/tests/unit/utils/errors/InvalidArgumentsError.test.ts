import { describe, it, expect } from "@jest/globals";
import { InvalidArgumentsError } from "../../../../src/utils/errors/InvalidArgumentsError.js";
import { ExitCodes } from "../../../../src/utils/ExitCodes.js";
import { ErrorCode } from "../../../../src/responses/index.js";

describe("InvalidArgumentsError", () => {
  describe("constructor", () => {
    it("should create error with message", () => {
      const error = new InvalidArgumentsError("Missing required argument: --vault");

      expect(error.message).toBe("Missing required argument: --vault");
    });

    it("should set correct exit code", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      expect(error.exitCode).toBe(ExitCodes.INVALID_ARGUMENTS);
    });

    it("should set correct error code", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      expect(error.errorCode).toBe(ErrorCode.VALIDATION_INVALID_ARGUMENTS);
    });

    it("should use custom suggestion when provided", () => {
      const error = new InvalidArgumentsError(
        "Invalid format",
        "Use YYYY-MM-DD format",
      );

      expect(error.guidance).toBe("Use YYYY-MM-DD format");
    });

    it("should use default guidance when no suggestion provided", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      expect(error.guidance).toContain("Check command syntax");
      expect(error.guidance).toContain("--help");
    });

    it("should include context when provided", () => {
      const error = new InvalidArgumentsError(
        "Invalid argument",
        undefined,
        { argument: "--vault", providedValue: "" },
      );

      expect(error.context?.argument).toBe("--vault");
      expect(error.context?.providedValue).toBe("");
    });

    it("should have recovery hint", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      expect(error.recoveryHint).toBeDefined();
      expect(error.recoveryHint?.suggestion).toContain("--help");
    });
  });

  describe("inheritance", () => {
    it("should be instance of Error", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      expect(error).toBeInstanceOf(Error);
    });

    it("should have correct name", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      expect(error.name).toBe("InvalidArgumentsError");
    });
  });

  describe("format()", () => {
    it("should format error for display", () => {
      const error = new InvalidArgumentsError("Missing --vault option");

      const formatted = error.format();

      expect(formatted).toContain("❌ InvalidArgumentsError");
      expect(formatted).toContain("Missing --vault option");
    });
  });

  describe("toStructuredResponse()", () => {
    it("should return structured response", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      const response = error.toStructuredResponse();

      expect(response.success).toBe(false);
      expect(response.error.code).toBe(ErrorCode.VALIDATION_INVALID_ARGUMENTS);
      expect(response.error.exitCode).toBe(ExitCodes.INVALID_ARGUMENTS);
    });

    it("should include context in response", () => {
      const error = new InvalidArgumentsError(
        "Invalid argument",
        undefined,
        { argument: "--vault", providedValue: "" },
      );

      const response = error.toStructuredResponse();

      expect(response.error.context?.argument).toBe("--vault");
    });
  });

  describe("formatJson()", () => {
    it("should return valid JSON string", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      const json = error.formatJson();

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCode.VALIDATION_INVALID_ARGUMENTS);
    });

    it("should include stack when includeStack is true", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      const json = error.formatJson(true);

      const parsed = JSON.parse(json);
      expect(parsed.error.stack).toBeDefined();
    });

    it("should not include stack when includeStack is false", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      const json = error.formatJson(false);

      const parsed = JSON.parse(json);
      expect(parsed.error.stack).toBeUndefined();
    });

    it("should include exitCode in JSON output", () => {
      const error = new InvalidArgumentsError("Invalid argument");

      const json = error.formatJson();

      const parsed = JSON.parse(json);
      expect(parsed.error.exitCode).toBe(ExitCodes.INVALID_ARGUMENTS);
    });
  });
});

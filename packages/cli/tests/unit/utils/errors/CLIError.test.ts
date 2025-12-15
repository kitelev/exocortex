import { describe, it, expect } from "@jest/globals";
import { ExitCodes } from "../../../../src/utils/ExitCodes.js";
import { ErrorCode } from "../../../../src/responses/index.js";

// Concrete implementation for testing abstract class
class TestCLIError extends Error {
  readonly exitCode = ExitCodes.GENERAL_ERROR;
  readonly errorCode = ErrorCode.INTERNAL_UNKNOWN;
  readonly guidance = "Test guidance";
  readonly context?: Record<string, unknown>;
  readonly recoveryHint?: { message: string; suggestion?: string };

  constructor(
    message: string,
    context?: Record<string, unknown>,
    recoveryHint?: { message: string; suggestion?: string },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.recoveryHint = recoveryHint;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  format(): string {
    let output = `❌ ${this.name}: ${this.message}`;

    if (this.guidance) {
      output += `\n\n💡 ${this.guidance}`;
    }

    if (this.context && Object.keys(this.context).length > 0) {
      output += `\n\n📋 Context:`;
      for (const [key, value] of Object.entries(this.context)) {
        output += `\n  ${key}: ${JSON.stringify(value)}`;
      }
    }

    return output;
  }

  toStructuredResponse(includeStack = false): {
    success: false;
    error: {
      code: ErrorCode;
      message: string;
      exitCode: ExitCodes;
      recovery?: { message: string; suggestion?: string };
      context?: Record<string, unknown>;
      stack?: string;
    };
  } {
    return {
      success: false,
      error: {
        code: this.errorCode,
        message: this.message,
        exitCode: this.exitCode,
        recovery: this.recoveryHint || { message: this.guidance },
        context: this.context,
        stack: includeStack ? this.stack : undefined,
      },
    };
  }

  formatJson(includeStack = false): string {
    return JSON.stringify(this.toStructuredResponse(includeStack), null, 2);
  }
}

describe("CLIError (abstract base class pattern)", () => {
  describe("constructor", () => {
    it("should set message correctly", () => {
      const error = new TestCLIError("Test error message");

      expect(error.message).toBe("Test error message");
    });

    it("should set name to constructor name", () => {
      const error = new TestCLIError("Test error");

      expect(error.name).toBe("TestCLIError");
    });

    it("should set context when provided", () => {
      const context = { filepath: "/test/path", operation: "read" };
      const error = new TestCLIError("Test error", context);

      expect(error.context).toEqual(context);
    });

    it("should set recovery hint when provided", () => {
      const recoveryHint = { message: "Try again", suggestion: "Wait and retry" };
      const error = new TestCLIError("Test error", undefined, recoveryHint);

      expect(error.recoveryHint).toEqual(recoveryHint);
    });

    it("should be instance of Error", () => {
      const error = new TestCLIError("Test error");

      expect(error).toBeInstanceOf(Error);
    });

    it("should have stack trace", () => {
      const error = new TestCLIError("Test error");

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("TestCLIError");
    });
  });

  describe("format()", () => {
    it("should include error name and message", () => {
      const error = new TestCLIError("Test error message");

      const formatted = error.format();

      expect(formatted).toContain("❌ TestCLIError: Test error message");
    });

    it("should include guidance", () => {
      const error = new TestCLIError("Test error");

      const formatted = error.format();

      expect(formatted).toContain("💡 Test guidance");
    });

    it("should include context when provided", () => {
      const error = new TestCLIError("Test error", { filepath: "/test/path" });

      const formatted = error.format();

      expect(formatted).toContain("📋 Context:");
      expect(formatted).toContain('filepath: "/test/path"');
    });

    it("should not include context section when context is empty", () => {
      const error = new TestCLIError("Test error", {});

      const formatted = error.format();

      expect(formatted).not.toContain("📋 Context:");
    });
  });

  describe("toStructuredResponse()", () => {
    it("should return structured error response", () => {
      const error = new TestCLIError("Test error");

      const response = error.toStructuredResponse();

      expect(response.success).toBe(false);
      expect(response.error.code).toBe(ErrorCode.INTERNAL_UNKNOWN);
      expect(response.error.message).toBe("Test error");
      expect(response.error.exitCode).toBe(ExitCodes.GENERAL_ERROR);
    });

    it("should include recovery information", () => {
      const error = new TestCLIError("Test error");

      const response = error.toStructuredResponse();

      expect(response.error.recovery).toBeDefined();
      expect(response.error.recovery?.message).toBe("Test guidance");
    });

    it("should include context when provided", () => {
      const context = { filepath: "/test/path" };
      const error = new TestCLIError("Test error", context);

      const response = error.toStructuredResponse();

      expect(response.error.context).toEqual(context);
    });

    it("should exclude stack trace by default", () => {
      const error = new TestCLIError("Test error");

      const response = error.toStructuredResponse();

      expect(response.error.stack).toBeUndefined();
    });

    it("should include stack trace when requested", () => {
      const error = new TestCLIError("Test error");

      const response = error.toStructuredResponse(true);

      expect(response.error.stack).toBeDefined();
    });
  });

  describe("formatJson()", () => {
    it("should return valid JSON string", () => {
      const error = new TestCLIError("Test error");

      const json = error.formatJson();

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("should return pretty-printed JSON", () => {
      const error = new TestCLIError("Test error");

      const json = error.formatJson();

      expect(json).toContain("\n");
      expect(json).toContain("  ");
    });

    it("should match toStructuredResponse output", () => {
      const error = new TestCLIError("Test error", { key: "value" });

      const json = error.formatJson();
      const response = error.toStructuredResponse();

      expect(JSON.parse(json)).toEqual(response);
    });
  });
});

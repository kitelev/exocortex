import { describe, it, expect } from "@jest/globals";
import { FileNotFoundError } from "../../../../src/utils/errors/FileNotFoundError.js";
import { ExitCodes } from "../../../../src/utils/ExitCodes.js";
import { ErrorCode } from "../../../../src/responses/index.js";

describe("FileNotFoundError", () => {
  describe("constructor", () => {
    it("should create error with filepath message", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(error.message).toBe("File not found: /path/to/file.md");
    });

    it("should set correct exit code", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(error.exitCode).toBe(ExitCodes.FILE_NOT_FOUND);
    });

    it("should set correct error code", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(error.errorCode).toBe(ErrorCode.VALIDATION_FILE_NOT_FOUND);
    });

    it("should include filepath in context", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(error.context).toBeDefined();
      expect(error.context?.filepath).toBe("/path/to/file.md");
    });

    it("should merge additional context", () => {
      const error = new FileNotFoundError("/path/to/file.md", { operation: "read" });

      expect(error.context?.filepath).toBe("/path/to/file.md");
      expect(error.context?.operation).toBe("read");
    });

    it("should have helpful guidance", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(error.guidance).toContain("Verify the file path");
      expect(error.guidance).toContain(".md extension");
    });

    it("should have recovery hint with suggestion", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(error.recoveryHint).toBeDefined();
      expect(error.recoveryHint?.suggestion).toContain("ls -la");
    });
  });

  describe("inheritance", () => {
    it("should be instance of Error", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(error).toBeInstanceOf(Error);
    });

    it("should have correct name", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(error.name).toBe("FileNotFoundError");
    });
  });

  describe("format()", () => {
    it("should format error for display", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      const formatted = error.format();

      expect(formatted).toContain("❌ FileNotFoundError");
      expect(formatted).toContain("File not found: /path/to/file.md");
      expect(formatted).toContain("💡");
    });
  });

  describe("toStructuredResponse()", () => {
    it("should return structured response", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      const response = error.toStructuredResponse();

      expect(response.success).toBe(false);
      expect(response.error.code).toBe(ErrorCode.VALIDATION_FILE_NOT_FOUND);
      expect(response.error.exitCode).toBe(ExitCodes.FILE_NOT_FOUND);
    });
  });

  describe("formatJson()", () => {
    it("should return valid JSON string", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      const json = error.formatJson();

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCode.VALIDATION_FILE_NOT_FOUND);
      expect(parsed.error.message).toBe("File not found: /path/to/file.md");
    });

    it("should include stack when includeStack is true", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      const json = error.formatJson(true);

      const parsed = JSON.parse(json);
      expect(parsed.error.stack).toBeDefined();
      expect(parsed.error.stack).toContain("FileNotFoundError");
    });

    it("should not include stack when includeStack is false", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      const json = error.formatJson(false);

      const parsed = JSON.parse(json);
      expect(parsed.error.stack).toBeUndefined();
    });

    it("should include context in JSON output", () => {
      const error = new FileNotFoundError("/path/to/file.md", { operation: "read" });

      const json = error.formatJson();

      const parsed = JSON.parse(json);
      expect(parsed.error.context.filepath).toBe("/path/to/file.md");
      expect(parsed.error.context.operation).toBe("read");
    });

    it("should include exitCode in JSON output", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      const json = error.formatJson();

      const parsed = JSON.parse(json);
      expect(parsed.error.exitCode).toBe(ExitCodes.FILE_NOT_FOUND);
    });

    it("should include recovery in JSON output", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      const json = error.formatJson();

      const parsed = JSON.parse(json);
      expect(parsed.error.recovery).toBeDefined();
      expect(parsed.error.recovery.suggestion).toContain("ls -la");
    });
  });
});

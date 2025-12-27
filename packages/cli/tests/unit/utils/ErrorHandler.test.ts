import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { ErrorHandler } from "../../../src/utils/ErrorHandler";
import { ExitCodes } from "../../../src/utils/ExitCodes";
import {
  FileNotFoundError,
  InvalidArgumentsError,
  ConcurrentModificationError,
  VaultNotFoundError,
} from "../../../src/utils/errors/index";
import { ErrorCode, ErrorCategory } from "../../../src/responses/index";

describe("ErrorHandler", () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as any;
    // Reset format to text for each test
    ErrorHandler.setFormat("text");
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("handle()", () => {
    it("should exit with FILE_NOT_FOUND for file not found errors", () => {
      const error = new Error("File not found: /path/to/file.md");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("File not found"),
      );
    });

    it("should exit with FILE_NOT_FOUND for ENOENT errors", () => {
      const error = new Error("ENOENT: no such file or directory");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");
    });

    it("should exit with INVALID_ARGUMENTS for validation errors", () => {
      const error = new Error("Invalid file path");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(2)");
    });

    it("should exit with INVALID_ARGUMENTS for outside vault errors", () => {
      const error = new Error("File path outside vault root");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(2)");
    });

    it("should exit with PERMISSION_DENIED for EACCES errors", () => {
      const error = new Error("EACCES: permission denied");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(4)");
    });

    it("should exit with INVALID_STATE_TRANSITION for transition errors", () => {
      const error = new Error("Invalid state transition from Done to InProgress");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(6)");
    });

    it("should exit with TRANSACTION_FAILED for transaction errors", () => {
      const error = new Error("Transaction failed: rollback");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(7)");
    });

    it("should exit with GENERAL_ERROR for unknown errors", () => {
      const error = new Error("Some other error");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(1)");
    });
  });

  describe("handle() with typed CLI errors", () => {
    it("should handle FileNotFoundError with formatted output and correct exit code", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("FileNotFoundError"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("File not found: /path/to/file.md"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("💡"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Verify the file path is correct"),
      );
    });

    it("should handle InvalidArgumentsError with formatted output and correct exit code", () => {
      const error = new InvalidArgumentsError(
        "Invalid file path",
        "Provide a valid file path within the vault.",
      );

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(2)");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("InvalidArgumentsError"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid file path"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Provide a valid file path within the vault"),
      );
    });

    it("should handle ConcurrentModificationError with formatted output and exit code 8", () => {
      const error = new ConcurrentModificationError(
        "/path/to/file.md",
        "file hash mismatch",
      );

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(8)");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("ConcurrentModificationError"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Concurrent modification detected"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("file hash mismatch"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Retry the command"),
      );
    });

    it("should include context in formatted error output", () => {
      const error = new FileNotFoundError("/path/to/file.md", {
        attemptedPath: "/absolute/path",
        vaultRoot: "/vault",
      });

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("📋 Context"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("attemptedPath"),
      );
    });
  });

  describe("handleWithMessage()", () => {
    it("should exit with custom message and exit code", () => {
      expect(() =>
        ErrorHandler.handleWithMessage("Custom error", ExitCodes.OPERATION_FAILED),
      ).toThrow("process.exit(5)");
      expect(consoleErrorSpy).toHaveBeenCalledWith("❌ Error: Custom error");
    });

    it("should use GENERAL_ERROR by default", () => {
      expect(() => ErrorHandler.handleWithMessage("Some error")).toThrow(
        "process.exit(1)",
      );
    });
  });

  describe("JSON output format", () => {
    beforeEach(() => {
      ErrorHandler.setFormat("json");
    });

    it("should output structured JSON for CLIError", () => {
      const error = new FileNotFoundError("/path/to/file.md");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");
      expect(consoleLogSpy).toHaveBeenCalled();

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCode.VALIDATION_FILE_NOT_FOUND);
      expect(parsed.error.category).toBe(ErrorCategory.VALIDATION);
      expect(parsed.error.message).toContain("File not found");
      expect(parsed.error.exitCode).toBe(ExitCodes.FILE_NOT_FOUND);
      expect(parsed.error.recovery).toBeDefined();
    });

    it("should output structured JSON for VaultNotFoundError", () => {
      const error = new VaultNotFoundError("/nonexistent/vault");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");
      expect(consoleLogSpy).toHaveBeenCalled();

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCode.VALIDATION_VAULT_NOT_FOUND);
      expect(parsed.error.category).toBe(ErrorCategory.VALIDATION);
      expect(parsed.error.context.vaultPath).toBe("/nonexistent/vault");
    });

    it("should output structured JSON for plain Error", () => {
      const error = new Error("ENOENT: no such file or directory");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");
      expect(consoleLogSpy).toHaveBeenCalled();

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCode.VALIDATION_FILE_NOT_FOUND);
      expect(parsed.error.message).toContain("ENOENT");
    });

    it("should include recovery hints in JSON output", () => {
      const error = new InvalidArgumentsError(
        "Missing required option",
        "Provide the --label option",
      );

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(2)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.error.recovery).toBeDefined();
      expect(parsed.error.recovery.message).toBeDefined();
    });

    it("should classify state transition errors correctly", () => {
      const error = new Error("Invalid state transition from Done to InProgress");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(6)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.error.code).toBe(ErrorCode.STATE_INVALID_TRANSITION);
      expect(parsed.error.category).toBe(ErrorCategory.STATE);
    });

    it("should classify concurrent modification errors correctly", () => {
      const error = new ConcurrentModificationError("/path/to/file.md", "hash mismatch");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(8)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.error.code).toBe(ErrorCode.STATE_CONCURRENT_MODIFICATION);
      expect(parsed.error.category).toBe(ErrorCategory.STATE);
    });

    it("handleWithMessage should output JSON with error code", () => {
      expect(() =>
        ErrorHandler.handleWithMessage(
          "Custom error",
          ExitCodes.OPERATION_FAILED,
          ErrorCode.INTERNAL_OPERATION_FAILED,
        ),
      ).toThrow("process.exit(5)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCode.INTERNAL_OPERATION_FAILED);
      expect(parsed.error.message).toBe("Custom error");
    });
  });

  describe("format switching", () => {
    it("should default to text format", () => {
      expect(ErrorHandler.getFormat()).toBe("text");
    });

    it("should switch to json format", () => {
      ErrorHandler.setFormat("json");
      expect(ErrorHandler.getFormat()).toBe("json");
    });

    it("should switch back to text format", () => {
      ErrorHandler.setFormat("json");
      ErrorHandler.setFormat("text");
      expect(ErrorHandler.getFormat()).toBe("text");
    });
  });

  describe("debug mode", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it("should show stack trace in development mode for CLIError", () => {
      process.env.NODE_ENV = "development";
      const error = new FileNotFoundError("/path/to/file.md");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Stack trace"));
    });

    it("should show stack trace in development mode for plain Error", () => {
      process.env.NODE_ENV = "development";
      const error = new Error("Some error");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(1)");
      expect(consoleErrorSpy).toHaveBeenCalledWith(error.stack);
    });

    it("should include stack in JSON output for CLIError in debug mode", () => {
      process.env.NODE_ENV = "development";
      ErrorHandler.setFormat("json");
      const error = new FileNotFoundError("/path/to/file.md");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.error.stack).toBeDefined();
    });

    it("should include stack in JSON output for plain Error in debug mode", () => {
      process.env.NODE_ENV = "development";
      ErrorHandler.setFormat("json");
      const error = new Error("Some error");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(1)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.error.stack).toBeDefined();
    });
  });

  describe("error classification - additional patterns", () => {
    it("should classify 'modified' errors as concurrent modification", () => {
      const error = new Error("File was modified by another process");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(8)");
    });

    it("should classify 'permission denied' as EACCES", () => {
      const error = new Error("permission denied to access file");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(4)");
    });

    it("should classify 'Not a' as invalid arguments", () => {
      const error = new Error("Not a valid file type");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(2)");
    });
  });

  describe("recovery hints coverage", () => {
    beforeEach(() => {
      ErrorHandler.setFormat("json");
    });

    it("should provide recovery hint for vault not found", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(3)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.error.recovery.message).toContain("vault");
    });

    it("should provide recovery hint for state transition errors", () => {
      const error = new Error("Invalid state transition");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(6)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.error.recovery.message).toContain("state transition");
    });

    it("should provide recovery hint for permission denied errors", () => {
      const error = new Error("EACCES: permission denied");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(4)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.error.recovery.message).toContain("permission");
    });

    it("should provide recovery hint for transaction errors", () => {
      const error = new Error("Transaction failed");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(7)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.error.recovery.message).toContain("Transaction");
    });

    it("should provide recovery hint for concurrent modification errors", () => {
      const error = new Error("concurrent access violation");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(8)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.error.recovery.message).toContain("modified");
    });

    it("should provide default recovery hint for unknown errors", () => {
      const error = new Error("Something completely random");

      expect(() => ErrorHandler.handle(error)).toThrow("process.exit(1)");

      const jsonOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.error.recovery.message).toContain("unexpected error");
    });
  });
});

import { describe, it, expect } from "@jest/globals";
import { VaultNotFoundError } from "../../../../src/utils/errors/VaultNotFoundError.js";
import { ExitCodes } from "../../../../src/utils/ExitCodes.js";
import { ErrorCode } from "../../../../src/responses/index.js";

describe("VaultNotFoundError", () => {
  describe("constructor", () => {
    it("should create error with vault path message", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(error.message).toBe("Vault not found: /path/to/vault");
    });

    it("should set correct exit code", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(error.exitCode).toBe(ExitCodes.FILE_NOT_FOUND);
    });

    it("should set correct error code", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(error.errorCode).toBe(ErrorCode.VALIDATION_VAULT_NOT_FOUND);
    });

    it("should include vaultPath in context", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(error.context).toBeDefined();
      expect(error.context?.vaultPath).toBe("/path/to/vault");
    });

    it("should merge additional context", () => {
      const error = new VaultNotFoundError("/path/to/vault", { operation: "init" });

      expect(error.context?.vaultPath).toBe("/path/to/vault");
      expect(error.context?.operation).toBe("init");
    });

    it("should have helpful guidance", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(error.guidance).toContain("vault directory");
      expect(error.guidance).toContain("Path spelling");
    });

    it("should have recovery hint", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(error.recoveryHint).toBeDefined();
      expect(error.recoveryHint?.suggestion).toContain("--vault");
    });
  });

  describe("inheritance", () => {
    it("should be instance of Error", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(error).toBeInstanceOf(Error);
    });

    it("should have correct name", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      expect(error.name).toBe("VaultNotFoundError");
    });
  });

  describe("format()", () => {
    it("should format error for display", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      const formatted = error.format();

      expect(formatted).toContain("❌ VaultNotFoundError");
      expect(formatted).toContain("Vault not found: /path/to/vault");
    });
  });

  describe("toStructuredResponse()", () => {
    it("should return structured response", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      const response = error.toStructuredResponse();

      expect(response.success).toBe(false);
      expect(response.error.code).toBe(ErrorCode.VALIDATION_VAULT_NOT_FOUND);
      expect(response.error.exitCode).toBe(ExitCodes.FILE_NOT_FOUND);
    });
  });

  describe("formatJson()", () => {
    it("should return valid JSON string", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      const json = error.formatJson();

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe(ErrorCode.VALIDATION_VAULT_NOT_FOUND);
      expect(parsed.error.message).toBe("Vault not found: /path/to/vault");
    });

    it("should include stack when includeStack is true", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      const json = error.formatJson(true);

      const parsed = JSON.parse(json);
      expect(parsed.error.stack).toBeDefined();
    });

    it("should not include stack when includeStack is false", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      const json = error.formatJson(false);

      const parsed = JSON.parse(json);
      expect(parsed.error.stack).toBeUndefined();
    });

    it("should include vaultPath in context", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      const json = error.formatJson();

      const parsed = JSON.parse(json);
      expect(parsed.error.context.vaultPath).toBe("/path/to/vault");
    });

    it("should include exitCode in JSON output", () => {
      const error = new VaultNotFoundError("/path/to/vault");

      const json = error.formatJson();

      const parsed = JSON.parse(json);
      expect(parsed.error.exitCode).toBe(ExitCodes.FILE_NOT_FOUND);
    });
  });
});

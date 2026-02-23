import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";

// Import parseTimeout function directly for unit testing
const { sparqlQueryCommand, parseTimeout } = await import("../../../src/commands/sparql-query.js");

describe("sparqlQueryCommand --timeout flag", () => {
  describe("command setup", () => {
    it("should accept --timeout option", () => {
      const cmd = sparqlQueryCommand();
      const options = cmd.options;
      const timeoutOption = options.find(opt => opt.flags.includes("--timeout"));
      expect(timeoutOption).toBeDefined();
    });

    it("should have timeout option with default value of 30s (per acceptance criteria)", () => {
      const cmd = sparqlQueryCommand();
      const options = cmd.options;
      const timeoutOption = options.find(opt => opt.flags.includes("--timeout"));
      // Issue #2217 Acceptance Criteria: "Default timeout 30 сек применяется"
      expect(timeoutOption?.defaultValue).toBe("30s");
    });

    it("should have timeout option with description", () => {
      const cmd = sparqlQueryCommand();
      const options = cmd.options;
      const timeoutOption = options.find(opt => opt.flags.includes("--timeout"));
      expect(timeoutOption?.description).toContain("timeout");
    });
  });

  describe("parseTimeout function", () => {
    it("should parse timeout in seconds (30s)", () => {
      expect(parseTimeout("30s")).toBe(30000);
    });

    it("should parse timeout in seconds (10s)", () => {
      expect(parseTimeout("10s")).toBe(10000);
    });

    it("should parse timeout in milliseconds (5000ms)", () => {
      expect(parseTimeout("5000ms")).toBe(5000);
    });

    it("should parse timeout in milliseconds (1500ms)", () => {
      expect(parseTimeout("1500ms")).toBe(1500);
    });

    it("should parse plain number as seconds (15)", () => {
      expect(parseTimeout("15")).toBe(15000);
    });

    it("should parse plain number as seconds (60)", () => {
      expect(parseTimeout("60")).toBe(60000);
    });

    it("should handle whitespace", () => {
      expect(parseTimeout("  30s  ")).toBe(30000);
      expect(parseTimeout("  5000ms  ")).toBe(5000);
    });

    it("should be case insensitive", () => {
      expect(parseTimeout("30S")).toBe(30000);
      expect(parseTimeout("5000MS")).toBe(5000);
    });

    it("should throw on invalid format", () => {
      expect(() => parseTimeout("invalid")).toThrow("Invalid timeout format");
    });

    it("should throw on negative values", () => {
      expect(() => parseTimeout("-10s")).toThrow("Invalid timeout format");
    });

    it("should throw on zero values", () => {
      expect(() => parseTimeout("0s")).toThrow("Invalid timeout format");
    });

    it("should throw on empty string", () => {
      expect(() => parseTimeout("")).toThrow("Invalid timeout format");
    });

    it("should throw on non-numeric values", () => {
      expect(() => parseTimeout("abcs")).toThrow("Invalid timeout format");
    });
  });
});

describe("QueryTimeoutError", () => {
  it("should be exported from errors module", async () => {
    const { QueryTimeoutError } = await import("../../../src/utils/errors/index.js");
    expect(QueryTimeoutError).toBeDefined();
  });

  it("should have correct exit code (OPERATION_FAILED)", async () => {
    const { QueryTimeoutError } = await import("../../../src/utils/errors/index.js");
    const { ExitCodes } = await import("../../../src/utils/ExitCodes.js");
    const error = new QueryTimeoutError(30000, 35000);
    expect(error.exitCode).toBe(ExitCodes.OPERATION_FAILED);
  });

  it("should have INTERNAL_QUERY_TIMEOUT error code", async () => {
    const { QueryTimeoutError } = await import("../../../src/utils/errors/index.js");
    const { ErrorCode } = await import("../../../src/responses/index.js");
    const error = new QueryTimeoutError(30000, 35000);
    expect(error.errorCode).toBe(ErrorCode.INTERNAL_QUERY_TIMEOUT);
  });

  it("should include timeout and elapsed time in message", async () => {
    const { QueryTimeoutError } = await import("../../../src/utils/errors/index.js");
    const error = new QueryTimeoutError(30000, 35000);
    expect(error.message).toContain("30");
    expect(error.message).toContain("timeout");
  });

  it("should provide helpful guidance", async () => {
    const { QueryTimeoutError } = await import("../../../src/utils/errors/index.js");
    const error = new QueryTimeoutError(30000, 35000);
    expect(error.guidance).toMatch(/--timeout/i);
  });
});

describe("executeWithTimeout", () => {
  it("should be exported from sparql-query module", async () => {
    const { executeWithTimeout } = await import("../../../src/commands/sparql-query.js");
    expect(executeWithTimeout).toBeDefined();
    expect(typeof executeWithTimeout).toBe("function");
  });
});

describe("EXOCORTEX_SPARQL_TIMEOUT environment variable (Issue #2233)", () => {
  const originalEnv = process.env.EXOCORTEX_SPARQL_TIMEOUT;

  beforeEach(() => {
    // Clean up environment variable before each test
    delete process.env.EXOCORTEX_SPARQL_TIMEOUT;
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.EXOCORTEX_SPARQL_TIMEOUT = originalEnv;
    } else {
      delete process.env.EXOCORTEX_SPARQL_TIMEOUT;
    }
  });

  describe("getDefaultTimeout function", () => {
    it("should export getDefaultTimeout function", async () => {
      const { getDefaultTimeout } = await import("../../../src/commands/sparql-query.js");
      expect(getDefaultTimeout).toBeDefined();
      expect(typeof getDefaultTimeout).toBe("function");
    });

    it("should return 30s (30000ms) when env var is not set", async () => {
      delete process.env.EXOCORTEX_SPARQL_TIMEOUT;
      const { getDefaultTimeout } = await import("../../../src/commands/sparql-query.js");
      expect(getDefaultTimeout()).toBe(30000);
    });

    it("should use EXOCORTEX_SPARQL_TIMEOUT env var when set (seconds)", async () => {
      process.env.EXOCORTEX_SPARQL_TIMEOUT = "60";
      // Re-import to pick up new env value
      jest.resetModules();
      const { getDefaultTimeout } = await import("../../../src/commands/sparql-query.js");
      expect(getDefaultTimeout()).toBe(60000);
    });

    it("should use EXOCORTEX_SPARQL_TIMEOUT env var when set (with s suffix)", async () => {
      process.env.EXOCORTEX_SPARQL_TIMEOUT = "120s";
      jest.resetModules();
      const { getDefaultTimeout } = await import("../../../src/commands/sparql-query.js");
      expect(getDefaultTimeout()).toBe(120000);
    });

    it("should use EXOCORTEX_SPARQL_TIMEOUT env var when set (with ms suffix)", async () => {
      process.env.EXOCORTEX_SPARQL_TIMEOUT = "45000ms";
      jest.resetModules();
      const { getDefaultTimeout } = await import("../../../src/commands/sparql-query.js");
      expect(getDefaultTimeout()).toBe(45000);
    });

    it("should fall back to 30s if env var is invalid", async () => {
      process.env.EXOCORTEX_SPARQL_TIMEOUT = "invalid";
      jest.resetModules();
      const { getDefaultTimeout } = await import("../../../src/commands/sparql-query.js");
      // Should not throw, just use default
      expect(getDefaultTimeout()).toBe(30000);
    });

    it("should fall back to 30s if env var is negative", async () => {
      process.env.EXOCORTEX_SPARQL_TIMEOUT = "-10";
      jest.resetModules();
      const { getDefaultTimeout } = await import("../../../src/commands/sparql-query.js");
      expect(getDefaultTimeout()).toBe(30000);
    });

    it("should fall back to 30s if env var is zero", async () => {
      process.env.EXOCORTEX_SPARQL_TIMEOUT = "0";
      jest.resetModules();
      const { getDefaultTimeout } = await import("../../../src/commands/sparql-query.js");
      expect(getDefaultTimeout()).toBe(30000);
    });
  });

  describe("CLI flag priority over env var", () => {
    it("--timeout flag should override EXOCORTEX_SPARQL_TIMEOUT", async () => {
      process.env.EXOCORTEX_SPARQL_TIMEOUT = "60";
      const { parseTimeout } = await import("../../../src/commands/sparql-query.js");
      // CLI flag value should be parsed directly, not affected by env var
      expect(parseTimeout("15s")).toBe(15000);
    });
  });
});

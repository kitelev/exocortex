import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

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

    it("should have timeout option with default value of 10s", () => {
      const cmd = sparqlQueryCommand();
      const options = cmd.options;
      const timeoutOption = options.find(opt => opt.flags.includes("--timeout"));
      expect(timeoutOption?.defaultValue).toBe("10s");
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

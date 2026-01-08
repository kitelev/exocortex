/**
 * Tests for validate CLI command
 *
 * @see https://github.com/kitelev/exocortex/issues/1448
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";

// Mock ValidationErrorFormatter
const mockFormatter = {
  formatForConsole: jest.fn().mockReturnValue("Validation Results: 0 violations, 0 warnings\n\n✅ All validations passed"),
  formatAsJson: jest.fn().mockReturnValue('{"conforms":true,"violations":[]}'),
};

const mockValidator = {
  validate: jest.fn().mockResolvedValue({ conforms: true, violations: [] }),
};

jest.unstable_mockModule("exocortex", () => ({
  ShaclValidator: jest.fn(() => mockValidator),
  ValidationErrorFormatter: jest.fn(() => mockFormatter),
}));

const { validateCommand } = await import("../../../src/commands/validate.js");

describe("validateCommand", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let existsSyncSpy: jest.SpiedFunction<typeof fs.existsSync>;
  let readFileSyncSpy: jest.SpiedFunction<typeof fs.readFileSync>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidator.validate.mockResolvedValue({ conforms: true, violations: [] });

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as never);
    existsSyncSpy = jest.spyOn(fs, "existsSync");
    readFileSyncSpy = jest.spyOn(fs, "readFileSync");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("command setup", () => {
    it("should create command with correct name", () => {
      const cmd = validateCommand();
      expect(cmd.name()).toBe("validate");
    });

    it("should have correct description", () => {
      const cmd = validateCommand();
      expect(cmd.description()).toBe("Validate ontology against SHACL shapes");
    });

    it("should have --ontology option", () => {
      const cmd = validateCommand();
      const ontologyOption = cmd.options.find(opt => opt.long === "--ontology");
      expect(ontologyOption).toBeDefined();
    });

    it("should have --shapes option", () => {
      const cmd = validateCommand();
      const shapesOption = cmd.options.find(opt => opt.long === "--shapes");
      expect(shapesOption).toBeDefined();
    });

    it("should have --format option with table as default", () => {
      const cmd = validateCommand();
      const formatOption = cmd.options.find(opt => opt.long === "--format");
      expect(formatOption).toBeDefined();
      expect(formatOption?.defaultValue).toBe("table");
    });
  });

  describe("validation execution", () => {
    it("should validate ontology file against shapes", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("@prefix : <http://example.org/> .");

      const cmd = validateCommand();
      await cmd.parseAsync([
        "node", "test",
        "--ontology", "/test/ems-ui.ttl",
        "--shapes", "/test/shapes.ttl",
      ]);

      expect(mockValidator.validate).toHaveBeenCalled();
      expect(mockFormatter.formatForConsole).toHaveBeenCalled();
    });

    it("should error when ontology file not found", async () => {
      existsSyncSpy.mockImplementation((path) => !String(path).includes("ems-ui"));

      const cmd = validateCommand();
      await cmd.parseAsync([
        "node", "test",
        "--ontology", "/missing/ems-ui.ttl",
        "--shapes", "/test/shapes.ttl",
      ]);

      expect(processExitSpy).toHaveBeenCalled();
    });

    it("should error when shapes file not found", async () => {
      existsSyncSpy.mockImplementation((path) => String(path).includes("ontology"));

      const cmd = validateCommand();
      await cmd.parseAsync([
        "node", "test",
        "--ontology", "/test/ontology.ttl",
        "--shapes", "/missing/shapes.ttl",
      ]);

      expect(processExitSpy).toHaveBeenCalled();
    });
  });

  describe("output formats", () => {
    it("should output in table format by default", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("@prefix : <http://example.org/> .");

      const cmd = validateCommand();
      await cmd.parseAsync([
        "node", "test",
        "--ontology", "/test/ontology.ttl",
        "--shapes", "/test/shapes.ttl",
      ]);

      expect(mockFormatter.formatForConsole).toHaveBeenCalled();
      expect(mockFormatter.formatAsJson).not.toHaveBeenCalled();
    });

    it("should output in JSON format when specified", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("@prefix : <http://example.org/> .");

      const cmd = validateCommand();
      await cmd.parseAsync([
        "node", "test",
        "--ontology", "/test/ontology.ttl",
        "--shapes", "/test/shapes.ttl",
        "--format", "json",
      ]);

      expect(mockFormatter.formatAsJson).toHaveBeenCalled();
    });
  });

  describe("exit codes", () => {
    it("should exit with 0 when validation passes", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("@prefix : <http://example.org/> .");
      mockValidator.validate.mockResolvedValue({ conforms: true, violations: [] });

      const cmd = validateCommand();
      await cmd.parseAsync([
        "node", "test",
        "--ontology", "/test/ontology.ttl",
        "--shapes", "/test/shapes.ttl",
      ]);

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it("should exit with 9 when validation fails", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("@prefix : <http://example.org/> .");
      mockValidator.validate.mockResolvedValue({
        conforms: false,
        violations: [{ focusNode: "test", message: "error", severity: "Violation" }],
      });

      const cmd = validateCommand();
      await cmd.parseAsync([
        "node", "test",
        "--ontology", "/test/ontology.ttl",
        "--shapes", "/test/shapes.ttl",
      ]);

      // Exit code 9 is VALIDATION_ERROR
      expect(processExitSpy).toHaveBeenCalledWith(9);
    });
  });
});

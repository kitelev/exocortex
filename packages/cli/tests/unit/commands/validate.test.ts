import { jest } from "@jest/globals";
import { Command } from "commander";

// Mock CacheManager (transitively depends on exocortex, fs-extra)
jest.unstable_mockModule("../../../src/cache/CacheManager.js", () => ({
  CacheManager: jest.fn(() => ({
    validateVault: jest.fn(() => []),
  })),
}));

// Mock exocortex (CacheManager dependency)
jest.unstable_mockModule("exocortex", () => ({
  NoteToRDFConverter: jest.fn(),
  Triple: jest.fn(),
  IRI: jest.fn(),
  Literal: jest.fn(),
  BlankNode: jest.fn(),
}));

// Mock fs-extra (CacheManager dependency)
jest.unstable_mockModule("fs-extra", () => ({
  default: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    pathExists: jest.fn(),
    ensureDir: jest.fn(),
    stat: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
  },
}));

const { validateCommand } = await import("../../../src/commands/validate.js");

/**
 * Issue #2346: Tests for validate CLI command registration
 *
 * Validates that the Commander.js command is correctly configured with
 * all required/optional options and proper defaults.
 */
describe("Issue #2346: validate command", () => {
  it("should create a command with name 'validate'", () => {
    const cmd = validateCommand();
    expect(cmd).toBeInstanceOf(Command);
    expect(cmd.name()).toBe("validate");
  });

  it("should have a description mentioning IRI or vault validation", () => {
    const cmd = validateCommand();
    expect(cmd.description()).toBeTruthy();
    expect(cmd.description().toLowerCase()).toMatch(/iri|valid|check|vault/);
  });

  it("should have optional --vault option with default value", () => {
    const cmd = validateCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--vault",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
    expect(option!.defaultValue).toBeDefined();
  });

  it("should have optional --output option with default 'text'", () => {
    const cmd = validateCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--output",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
    expect(option!.defaultValue).toBe("text");
  });

  it("should register exactly 2 options", () => {
    const cmd = validateCommand();
    expect(cmd.options).toHaveLength(2);
  });

  it("should have --vault option that accepts a path argument", () => {
    const cmd = validateCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--vault",
    );
    expect(option).toBeDefined();
    // Commander uses '<path>' for required argument on optional option
    expect(option!.flags).toContain("<path>");
  });

  it("should have --output option that accepts a type argument", () => {
    const cmd = validateCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--output",
    );
    expect(option).toBeDefined();
    expect(option!.flags).toContain("<type>");
  });
});

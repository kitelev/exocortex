import { jest } from "@jest/globals";
import { Command } from "commander";

// Mock uuid (UnarchiveService dependency chain)
jest.unstable_mockModule("uuid", () => ({
  v4: jest.fn(() => "mock-uuid"),
}));

// Mock exocortex (NodeFsAdapter + UnarchiveService dependencies)
jest.unstable_mockModule("exocortex", () => ({
  DateFormatter: { toLocalTimestamp: jest.fn(() => "2026-03-23T12:00:00") },
  MetadataHelpers: { buildFileContent: jest.fn(() => "---\n---\n") },
  IFileSystemAdapter: {},
  FileNotFoundError: class FileNotFoundError extends Error {},
  FileAlreadyExistsError: class FileAlreadyExistsError extends Error {},
}));

// Mock fs-extra (NodeFsAdapter dependency)
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

// Mock glob (NodeFsAdapter dependency)
jest.unstable_mockModule("glob", () => ({
  glob: jest.fn(() => []),
}));

const { unarchiveCommand } = await import(
  "../../../src/commands/unarchive.js"
);

/**
 * Issue #2344: Tests for unarchive CLI command registration
 *
 * Validates that the Commander.js command is correctly configured with
 * all required/optional options and proper defaults.
 */
describe("Issue #2344: unarchive command", () => {
  it("should create a command with name 'unarchive'", () => {
    const cmd = unarchiveCommand();
    expect(cmd.name()).toBe("unarchive");
  });

  it("should have a description mentioning restore or archive", () => {
    const cmd = unarchiveCommand();
    expect(cmd.description()).toBeTruthy();
    expect(cmd.description().toLowerCase()).toMatch(/restore|archive/);
  });

  it("should have required option --vault", () => {
    const cmd = unarchiveCommand();
    const option = cmd.options.find((opt) => opt.long === "--vault");
    expect(option).toBeDefined();
    expect(option!.mandatory).toBe(true);
  });

  it("should have required option --archive-vault", () => {
    const cmd = unarchiveCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--archive-vault",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBe(true);
  });

  it("should have required option --uuid", () => {
    const cmd = unarchiveCommand();
    const option = cmd.options.find((opt) => opt.long === "--uuid");
    expect(option).toBeDefined();
    expect(option!.mandatory).toBe(true);
  });

  it("should have optional --dry-run flag with default false", () => {
    const cmd = unarchiveCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--dry-run",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
    expect(option!.defaultValue).toBe(false);
  });

  it("should register exactly 4 options", () => {
    const cmd = unarchiveCommand();
    expect(cmd.options).toHaveLength(4);
  });
});

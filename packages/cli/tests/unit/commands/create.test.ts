import { jest } from "@jest/globals";
import { Command } from "commander";

// Mock uuid (AssetCreationService dependency)
jest.unstable_mockModule("uuid", () => ({
  v4: jest.fn(() => "mock-uuid"),
}));

// Mock exocortex (NodeFsAdapter + GenericAssetCreationService dependencies).
// The create command's action is not exercised here (only option registration),
// so a stub service class is enough to satisfy the ESM named-import binding.
jest.unstable_mockModule("exocortex", () => ({
  DateFormatter: { toLocalTimestamp: jest.fn(() => "2026-03-23T12:00:00") },
  MetadataHelpers: { buildFileContent: jest.fn(() => "---\n---\n") },
  GenericAssetCreationService: class GenericAssetCreationService {},
  IFileSystemAdapter: {},
  FileNotFoundError: class FileNotFoundError extends Error {},
  FileAlreadyExistsError: class FileAlreadyExistsError extends Error {},
  registerOrderSpecLoader: jest.fn(),
  clearOrderSpecLoader: jest.fn(),
  loadDefaultSpec: jest.fn(() => null),
  orderProperties: jest.fn((p: unknown) => p),
  Namespace: {
    fromPropertyKey: (key: string) => {
      const match = /^([a-z][a-zA-Z0-9]*)__(.+)$/.exec(key);
      if (!match) return null;
      return {
        namespace: {
          term: (localName: string) => ({
            value: `https://exocortex.my/ontology/${match[1]}#${localName}`,
          }),
        },
        localName: match[2],
      };
    },
  },
  ShapeLoader: {
    loadFromVaultFS: jest.fn(async () => ({
      get: () => undefined,
      getAll: () => [],
      register: () => undefined,
      size: 0,
    })),
  },
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

const { createCommand } = await import("../../../src/commands/create.js");

/**
 * Issue #2333: Tests for create CLI command registration
 *
 * Validates that the Commander.js command is correctly configured with
 * all required/optional options and proper defaults.
 */
describe("Issue #2333: create command", () => {
  it("should create a command with name 'create'", () => {
    const cmd = createCommand();
    expect(cmd.name()).toBe("create");
  });

  it("should have a description mentioning asset creation", () => {
    const cmd = createCommand();
    expect(cmd.description()).toBeTruthy();
    expect(cmd.description().toLowerCase()).toContain("asset");
  });

  it("should have required option --class", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--class",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBe(true);
  });

  it("should have required option --label", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--label",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBe(true);
  });

  it("should have optional --vault option with default", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--vault",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
    expect(option!.defaultValue).toBeDefined();
  });

  it("should have optional --aliases option for variadic names", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--aliases",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have optional --property option (repeatable)", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--property",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
    expect(option!.defaultValue).toEqual([]);
  });

  it("should have optional --body option", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--body",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have optional --body-file option", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--body-file",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have optional --dry-run flag", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--dry-run",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have optional --created-by option for custom creator UUID", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--created-by",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have optional --timezone option", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--timezone",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have optional --skip-wikilink-validation flag", () => {
    const cmd = createCommand();
    const option = cmd.options.find(
      (opt) => opt.long === "--skip-wikilink-validation",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should register exactly 11 options", () => {
    const cmd = createCommand();
    expect(cmd.options).toHaveLength(11);
  });
});

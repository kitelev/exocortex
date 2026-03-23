import { jest } from "@jest/globals";
import { Command } from "commander";

/**
 * Issue #2306 + #2311 + #2314: Tests for archive CLI command registration
 *
 * Acceptance criteria:
 * - Command is registered with correct name and description
 * - Required options: --vault, --archive-vault
 * - Optional options: --class, --year, --dry-run, --no-referenced, --json, --verify, --cascade
 * - --class and --year are validated at runtime (required for archive, not for verify/cascade)
 */
describe("Issue #2306: archive command", () => {
  let archiveCommandFn: () => Command;

  beforeAll(async () => {
    // Dynamic import to get the command factory
    const mod = await import("../../../src/commands/archive.js");
    archiveCommandFn = mod.archiveCommand;
  });

  it("should create a command with name 'archive'", () => {
    const cmd = archiveCommandFn();
    expect(cmd.name()).toBe("archive");
  });

  it("should have a description", () => {
    const cmd = archiveCommandFn();
    expect(cmd.description()).toContain("archive");
  });

  it("should have required option --vault", () => {
    const cmd = archiveCommandFn();
    const vaultOption = cmd.options.find(
      (opt) => opt.long === "--vault",
    );
    expect(vaultOption).toBeDefined();
    expect(vaultOption!.mandatory).toBe(true);
  });

  it("should have required option --archive-vault", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--archive-vault",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBe(true);
  });

  it("should have option --class (validated at runtime)", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--class",
    );
    expect(option).toBeDefined();
  });

  it("should have option --year (validated at runtime)", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--year",
    );
    expect(option).toBeDefined();
  });

  it("should have optional --dry-run flag", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--dry-run",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have optional --json flag", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--json",
    );
    expect(option).toBeDefined();
  });

  it("should have optional --verify flag", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--verify",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have optional --cascade flag", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--cascade",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });
});

/**
 * Issue #2345: Additional tests for archive command option details
 *
 * Validates option count, defaults, mandatory flags, and description.
 */
describe("Issue #2345: archive command dispatch branch tests", () => {
  let archiveCommandFn: () => Command;

  beforeAll(async () => {
    const mod = await import("../../../src/commands/archive.js");
    archiveCommandFn = mod.archiveCommand;
  });

  it("should have --stats option registered", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--stats",
    );
    expect(option).toBeDefined();
  });

  it("should register exactly 10 options total", () => {
    const cmd = archiveCommandFn();
    expect(cmd.options).toHaveLength(10);
  });

  it("should have --stats as non-mandatory option", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--stats",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have --stats default value of false", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--stats",
    );
    expect(option).toBeDefined();
    expect(option!.defaultValue).toBe(false);
  });

  it("should mark --vault and --archive-vault as mandatory", () => {
    const cmd = archiveCommandFn();
    const mandatoryOptions = cmd.options.filter(
      (opt) => opt.mandatory === true,
    );
    expect(mandatoryOptions).toHaveLength(2);
    const mandatoryNames = mandatoryOptions.map((opt) => opt.long);
    expect(mandatoryNames).toContain("--vault");
    expect(mandatoryNames).toContain("--archive-vault");
  });

  it("should have --no-referenced option registered", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--no-referenced",
    );
    expect(option).toBeDefined();
    expect(option!.mandatory).toBeFalsy();
  });

  it("should have --json default value of true", () => {
    const cmd = archiveCommandFn();
    const option = cmd.options.find(
      (opt) => opt.long === "--json",
    );
    expect(option).toBeDefined();
    expect(option!.defaultValue).toBe(true);
  });

  it("should have a description mentioning 'archive'", () => {
    const cmd = archiveCommandFn();
    const description = cmd.description().toLowerCase();
    expect(description).toContain("archive");
  });
});

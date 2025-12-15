import { describe, it, expect } from "@jest/globals";

// Import the command creator
import { batchRepairCommand } from "../../../src/commands/batch-repair.js";

describe("batch-repair command", () => {
  describe("command configuration", () => {
    it("should create command with correct name and description", () => {
      const cmd = batchRepairCommand();

      expect(cmd.name()).toBe("batch-repair");
      expect(cmd.description()).toContain("Batch repair folder locations");
    });

    it("should accept directory argument", () => {
      const cmd = batchRepairCommand();
      const args = cmd.registeredArguments;

      expect(args.length).toBe(1);
      expect(args[0].name()).toBe("directory");
    });

    it("should have vault option with default", () => {
      const cmd = batchRepairCommand();
      const vaultOption = cmd.options.find((o) => o.long === "--vault");

      expect(vaultOption).toBeDefined();
      expect(vaultOption?.defaultValue).toBe(process.cwd());
    });

    it("should have dry-run option", () => {
      const cmd = batchRepairCommand();
      const dryRunOption = cmd.options.find((o) => o.long === "--dry-run");

      expect(dryRunOption).toBeDefined();
    });

    it("should have format option with default text", () => {
      const cmd = batchRepairCommand();
      const formatOption = cmd.options.find((o) => o.long === "--format");

      expect(formatOption).toBeDefined();
      expect(formatOption?.defaultValue).toBe("text");
    });

    it("should have progress option enabled by default", () => {
      const cmd = batchRepairCommand();
      const progressOption = cmd.options.find((o) => o.long === "--progress");

      expect(progressOption).toBeDefined();
    });

    it("should have no-progress option to disable progress", () => {
      const cmd = batchRepairCommand();
      const noProgressOption = cmd.options.find((o) => o.long === "--no-progress");

      expect(noProgressOption).toBeDefined();
    });
  });
});

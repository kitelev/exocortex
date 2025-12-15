import { describe, it, expect } from "@jest/globals";

import { watchCommand } from "../../../src/commands/watch.js";

describe("watchCommand", () => {
  describe("command structure", () => {
    it("should create a command named 'watch'", () => {
      const command = watchCommand();
      expect(command.name()).toBe("watch");
    });

    it("should have a description", () => {
      const command = watchCommand();
      expect(command.description()).toContain("Watch");
    });

    it("should have --vault option", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--vault");
      expect(option).toBeDefined();
    });

    it("should have --pattern option", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--pattern");
      expect(option).toBeDefined();
    });

    it("should have --asset-type option", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--asset-type");
      expect(option).toBeDefined();
    });

    it("should have --debounce option", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--debounce");
      expect(option).toBeDefined();
    });
  });

  describe("option parsing", () => {
    it("should use current directory as default vault", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--vault");
      expect(option?.defaultValue).toBe(process.cwd());
    });

    it("should use 100ms as default debounce", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--debounce");
      expect(option?.defaultValue).toBe("100");
    });
  });

  describe("option descriptions", () => {
    it("should describe --vault option", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--vault");
      expect(option?.description).toContain("vault");
    });

    it("should describe --pattern option", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--pattern");
      expect(option?.description).toContain("pattern");
    });

    it("should describe --asset-type option", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--asset-type");
      expect(option?.description).toContain("asset");
    });

    it("should describe --debounce option", () => {
      const command = watchCommand();
      const option = command.options.find((o) => o.long === "--debounce");
      expect(option?.description).toContain("ebounce");
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { CLIUIProvider } from "../../../src/infrastructure/CLIUIProvider.js";
import { HeadlessError } from "exocortex";

describe("CLIUIProvider", () => {
  let provider: CLIUIProvider;
  let consoleSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    provider = new CLIUIProvider();
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("isHeadless", () => {
    it("should return true (CLI is headless mode)", () => {
      expect(provider.isHeadless).toBe(true);
    });
  });

  describe("showInputModal", () => {
    it("should throw HeadlessError", async () => {
      await expect(provider.showInputModal({ title: "Test Input" }))
        .rejects.toThrow(HeadlessError);
    });

    it("should include action description in error", async () => {
      let caughtError: HeadlessError | null = null;
      try {
        await provider.showInputModal({ title: "Enter Name" });
      } catch (error) {
        caughtError = error as HeadlessError;
      }
      expect(caughtError).toBeInstanceOf(HeadlessError);
      expect(caughtError!.action).toContain("Enter Name");
    });

    it("should include CLI alternative suggestion", async () => {
      let caughtError: HeadlessError | null = null;
      try {
        await provider.showInputModal({ title: "Enter Value" });
      } catch (error) {
        caughtError = error as HeadlessError;
      }
      expect(caughtError!.cliAlternative).toContain("CLI argument");
    });
  });

  describe("showSelectModal", () => {
    it("should throw HeadlessError", async () => {
      await expect(provider.showSelectModal({
        title: "Select Item",
        items: ["a", "b", "c"],
        getLabel: (item) => item
      })).rejects.toThrow(HeadlessError);
    });

    it("should include action description in error", async () => {
      let caughtError: HeadlessError | null = null;
      try {
        await provider.showSelectModal({
          title: "Choose Project",
          items: [],
          getLabel: (item) => String(item)
        });
      } catch (error) {
        caughtError = error as HeadlessError;
      }
      expect(caughtError).toBeInstanceOf(HeadlessError);
      expect(caughtError!.action).toContain("Choose Project");
    });

    it("should suggest --select argument", async () => {
      let caughtError: HeadlessError | null = null;
      try {
        await provider.showSelectModal({
          title: "Pick One",
          items: [],
          getLabel: (item) => String(item)
        });
      } catch (error) {
        caughtError = error as HeadlessError;
      }
      expect(caughtError!.cliAlternative).toContain("--select");
    });
  });

  describe("showConfirm", () => {
    it("should throw HeadlessError", async () => {
      await expect(provider.showConfirm("Are you sure?"))
        .rejects.toThrow(HeadlessError);
    });

    it("should include confirmation message in error", async () => {
      let caughtError: HeadlessError | null = null;
      try {
        await provider.showConfirm("Delete all files?");
      } catch (error) {
        caughtError = error as HeadlessError;
      }
      expect(caughtError).toBeInstanceOf(HeadlessError);
      expect(caughtError!.action).toContain("Delete all files?");
    });

    it("should suggest --force flag", async () => {
      let caughtError: HeadlessError | null = null;
      try {
        await provider.showConfirm("Proceed?");
      } catch (error) {
        caughtError = error as HeadlessError;
      }
      expect(caughtError!.cliAlternative).toContain("--force");
    });
  });

  describe("notify", () => {
    it("should print message to console", () => {
      provider.notify("Task completed");
      expect(consoleSpy).toHaveBeenCalledWith("Task completed");
    });

    it("should not throw errors", () => {
      expect(() => provider.notify("Any message")).not.toThrow();
    });

    it("should ignore duration parameter in CLI mode", () => {
      // Duration is for Obsidian's Notice, CLI just prints
      expect(() => provider.notify("Message", 5000)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith("Message");
    });
  });

  describe("navigate", () => {
    it("should print target path to console", async () => {
      await provider.navigate("/path/to/file.md");
      expect(consoleSpy).toHaveBeenCalledWith("Target: /path/to/file.md");
    });

    it("should resolve successfully", async () => {
      await expect(provider.navigate("some/asset")).resolves.not.toThrow();
    });
  });

  describe("IUIProvider interface compliance", () => {
    it("should implement all required methods", () => {
      expect(typeof provider.showInputModal).toBe("function");
      expect(typeof provider.showSelectModal).toBe("function");
      expect(typeof provider.showConfirm).toBe("function");
      expect(typeof provider.notify).toBe("function");
      expect(typeof provider.navigate).toBe("function");
      expect(typeof provider.isHeadless).toBe("boolean");
    });
  });
});

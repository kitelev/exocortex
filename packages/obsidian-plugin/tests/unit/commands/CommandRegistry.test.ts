import "reflect-metadata";
import { CommandRegistry } from "../../../src/application/commands/CommandRegistry";
import { ICommand } from "../../../src/application/commands/ICommand";

describe("CommandRegistry", () => {
  const createMockCommand = (id: string): ICommand => ({
    id,
    name: `Mock ${id}`,
    callback: jest.fn(),
  });

  describe("constructor", () => {
    it("should create instance with empty commands array", () => {
      const registry = new CommandRegistry([]);
      expect(registry).toBeInstanceOf(CommandRegistry);
    });

    it("should create instance with global commands", () => {
      const commands = [createMockCommand("cmd1"), createMockCommand("cmd2")];
      const registry = new CommandRegistry(commands);
      expect(registry).toBeInstanceOf(CommandRegistry);
    });
  });

  describe("getAllCommands", () => {
    it("should return global commands", () => {
      const commands = [createMockCommand("cmd1"), createMockCommand("cmd2")];
      const registry = new CommandRegistry(commands);

      expect(registry.getAllCommands()).toEqual(commands);
    });

    it("should return same array on multiple calls", () => {
      const commands = [createMockCommand("cmd1")];
      const registry = new CommandRegistry(commands);

      expect(registry.getAllCommands()).toBe(registry.getAllCommands());
    });
  });

  describe("getGlobalCommands", () => {
    it("should return same commands as getAllCommands", () => {
      const commands = [createMockCommand("cmd1")];
      const registry = new CommandRegistry(commands);

      expect(registry.getGlobalCommands()).toBe(registry.getAllCommands());
    });
  });

  describe("getCommandsForAsset", () => {
    it("should return empty array when no CommandResolver is set", async () => {
      const registry = new CommandRegistry([]);
      const result = await registry.getCommandsForAsset("iri", "class");
      expect(result).toEqual([]);
    });

    it("should delegate to CommandResolver when set", async () => {
      const registry = new CommandRegistry([]);
      const mockResolved = [
        { command: { id: "cmd1", name: "Command 1" }, binding: { id: "b1" } },
      ];
      const mockResolver = {
        resolveForAsset: jest.fn().mockResolvedValue(mockResolved),
        invalidateCache: jest.fn(),
      };

      registry.setCommandResolver(mockResolver as any);
      const result = await registry.getCommandsForAsset("iri", "class", "proto");

      expect(mockResolver.resolveForAsset).toHaveBeenCalledWith("iri", "class", "proto");
      expect(result).toBe(mockResolved);
    });
  });

  describe("setCommandResolver", () => {
    it("should enable vault-driven command resolution", async () => {
      const registry = new CommandRegistry([]);
      const mockResolver = {
        resolveForAsset: jest.fn().mockResolvedValue([]),
        invalidateCache: jest.fn(),
      };

      registry.setCommandResolver(mockResolver as any);
      await registry.getCommandsForAsset("iri", "class");

      expect(mockResolver.resolveForAsset).toHaveBeenCalled();
    });
  });
});

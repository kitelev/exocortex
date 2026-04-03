import "reflect-metadata";
import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  registerCoreServices,
  createChildContainer,
  getContainer,
  resetContainer,
  container,
} from "../../../src/infrastructure/container";
import { DI_TOKENS } from "../../../src/interfaces/tokens";

describe("container", () => {
  beforeEach(() => {
    resetContainer();
  });

  describe("registerCoreServices", () => {
    it("should register services to global container when no child container provided", () => {
      // Register mock vault adapter first (dependency)
      const mockVault = { read: jest.fn(), modify: jest.fn() };
      container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVault });
      const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      container.register(DI_TOKENS.ILogger, { useValue: mockLogger });
      const mockFs = { readFile: jest.fn(), writeFile: jest.fn() };
      container.register(DI_TOKENS.IFileSystemAdapter, { useValue: mockFs });

      registerCoreServices();

      // Verify some registered services can be resolved
      expect(container.isRegistered(DI_TOKENS.TaskCreationService)).toBe(true);
      expect(container.isRegistered(DI_TOKENS.ProjectCreationService)).toBe(true);
      expect(container.isRegistered(DI_TOKENS.AreaCreationService)).toBe(true);
    });

    it("should register services to provided child container", () => {
      const child = container.createChildContainer();
      const mockVault = { read: jest.fn(), modify: jest.fn() };
      child.register(DI_TOKENS.IVaultAdapter, { useValue: mockVault });
      const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      child.register(DI_TOKENS.ILogger, { useValue: mockLogger });
      const mockFs = { readFile: jest.fn(), writeFile: jest.fn() };
      child.register(DI_TOKENS.IFileSystemAdapter, { useValue: mockFs });

      registerCoreServices(child);

      expect(child.isRegistered(DI_TOKENS.TaskFrontmatterGenerator)).toBe(true);
      expect(child.isRegistered(DI_TOKENS.DynamicFrontmatterGenerator)).toBe(true);
      expect(child.isRegistered(DI_TOKENS.AlgorithmExtractor)).toBe(true);
    });
  });

  describe("createChildContainer", () => {
    it("should create a new child container", () => {
      const child = createChildContainer();
      expect(child).toBeDefined();
      expect(child).not.toBe(container);
    });

    it("should create isolated containers", () => {
      const child1 = createChildContainer();
      const child2 = createChildContainer();
      expect(child1).not.toBe(child2);
    });
  });

  describe("getContainer", () => {
    it("should return the global container", () => {
      const result = getContainer();
      expect(result).toBe(container);
    });
  });

  describe("resetContainer", () => {
    it("should clear all registrations", () => {
      container.register("test-token", { useValue: "test" });
      resetContainer();
      expect(container.isRegistered("test-token")).toBe(false);
    });
  });
});

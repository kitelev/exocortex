// Mock obsidian BEFORE any imports that use it
jest.mock("obsidian", () => ({
  App: jest.fn(),
  Plugin: jest.fn(),
  Modal: class MockModal {
    app: any;
    contentEl: HTMLElement;
    constructor(app: any) {
      this.app = app;
      this.contentEl = document.createElement("div");
    }
    open() {}
    close() {}
    onOpen() {}
    onClose() {}
  },
}));

// Mock SPARQLQueryBuilderModal BEFORE import
jest.mock("../../src/presentation/modals/SPARQLQueryBuilderModal", () => ({
  SPARQLQueryBuilderModal: jest.fn().mockImplementation(() => ({
    open: jest.fn(),
    close: jest.fn(),
  })),
}));

import { OpenQueryBuilderCommand } from "../../src/application/commands/OpenQueryBuilderCommand";
import { App, Plugin } from "obsidian";
import { SPARQLQueryBuilderModal } from "../../src/presentation/modals/SPARQLQueryBuilderModal";

describe("OpenQueryBuilderCommand", () => {
  let command: OpenQueryBuilderCommand;
  let mockApp: App;
  let mockPlugin: Plugin;
  let mockNotifier: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      workspace: {
        getActiveFile: jest.fn(),
      },
    } as unknown as App;

    mockPlugin = {
      manifest: { id: "exocortex" },
      settings: {},
    } as unknown as Plugin;

    mockNotifier = {
      info: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      confirm: jest.fn().mockResolvedValue(true),
    };

    command = new OpenQueryBuilderCommand(mockApp, mockPlugin, mockNotifier);
  });

  describe("properties", () => {
    it("should have correct id", () => {
      expect(command.id).toBe("open-sparql-query-builder");
    });

    it("should have correct name", () => {
      expect(command.name).toBe("open sparql query builder");
    });
  });

  describe("callback", () => {
    it("should create and open SPARQLQueryBuilderModal", async () => {
      const mockModalInstance = { open: jest.fn() };
      (SPARQLQueryBuilderModal as jest.Mock).mockImplementation(() => mockModalInstance);

      await command.callback();

      expect(SPARQLQueryBuilderModal).toHaveBeenCalledWith(mockApp, mockPlugin, mockNotifier);
      expect(mockModalInstance.open).toHaveBeenCalled();
    });

    it("should return undefined (async void)", async () => {
      const mockModalInstance = { open: jest.fn() };
      (SPARQLQueryBuilderModal as jest.Mock).mockImplementation(() => mockModalInstance);

      const result = await command.callback();

      expect(result).toBeUndefined();
    });

    it("should pass app and plugin to modal constructor", async () => {
      const mockModalInstance = { open: jest.fn() };
      (SPARQLQueryBuilderModal as jest.Mock).mockImplementation(() => mockModalInstance);

      await command.callback();

      expect(SPARQLQueryBuilderModal).toHaveBeenCalledTimes(1);
      const [appArg, pluginArg] = (SPARQLQueryBuilderModal as jest.Mock).mock.calls[0];
      expect(appArg).toBe(mockApp);
      expect(pluginArg).toBe(mockPlugin);
    });

    it("should create new modal instance each time callback is invoked", async () => {
      const mockModalInstance1 = { open: jest.fn() };
      const mockModalInstance2 = { open: jest.fn() };

      (SPARQLQueryBuilderModal as jest.Mock)
        .mockImplementationOnce(() => mockModalInstance1)
        .mockImplementationOnce(() => mockModalInstance2);

      await command.callback();
      await command.callback();

      expect(SPARQLQueryBuilderModal).toHaveBeenCalledTimes(2);
      expect(mockModalInstance1.open).toHaveBeenCalledTimes(1);
      expect(mockModalInstance2.open).toHaveBeenCalledTimes(1);
    });
  });

  describe("command interface compliance", () => {
    it("should have id property of type string", () => {
      expect(typeof command.id).toBe("string");
      expect(command.id.length).toBeGreaterThan(0);
    });

    it("should have name property of type string", () => {
      expect(typeof command.name).toBe("string");
      expect(command.name.length).toBeGreaterThan(0);
    });

    it("should have callback property of type function", () => {
      expect(typeof command.callback).toBe("function");
    });

    it("should not have checkCallback property (global command)", () => {
      // OpenQueryBuilderCommand uses callback not checkCallback
      // because it doesn't require a file context
      expect((command as any).checkCallback).toBeUndefined();
    });
  });
});

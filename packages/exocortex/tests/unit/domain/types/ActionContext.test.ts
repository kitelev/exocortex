/**
 * Tests for ActionContext interface
 *
 * Issue #1400: Add uiProvider to ActionContext
 * @see https://github.com/kitelev/exocortex/issues/1400
 */
import { ITripleStore } from "../../../../src/interfaces/ITripleStore";
import { IUIProvider } from "../../../../src/domain/ports/IUIProvider";
import { IFile } from "../../../../src/interfaces/IVaultAdapter";

// Import the interface being tested - this should fail initially (TDD RED)
import { ActionContext } from "../../../../src/domain/types/ActionContext";

describe("ActionContext", () => {
  describe("interface structure", () => {
    it("should have uiProvider field of type IUIProvider", () => {
      // Create a mock IUIProvider
      const mockUIProvider: IUIProvider = {
        showInputModal: jest.fn(),
        showSelectModal: jest.fn(),
        showConfirm: jest.fn(),
        notify: jest.fn(),
        navigate: jest.fn(),
        isHeadless: false,
      };

      // Create a mock ITripleStore (minimal implementation)
      const mockTripleStore: ITripleStore = {
        add: jest.fn(),
        remove: jest.fn(),
        has: jest.fn(),
        match: jest.fn(),
        addAll: jest.fn(),
        removeAll: jest.fn(),
        clear: jest.fn(),
        count: jest.fn(),
        subjects: jest.fn(),
        predicates: jest.fn(),
        objects: jest.fn(),
        beginTransaction: jest.fn(),
      };

      // Create an ActionContext with uiProvider
      const context: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: mockUIProvider,
      };

      // Verify the interface accepts uiProvider
      expect(context.uiProvider).toBe(mockUIProvider);
      expect(context.uiProvider.isHeadless).toBe(false);
      expect(context.tripleStore).toBe(mockTripleStore);
    });

    it("should allow optional currentAsset field", () => {
      const mockUIProvider: IUIProvider = {
        showInputModal: jest.fn(),
        showSelectModal: jest.fn(),
        showConfirm: jest.fn(),
        notify: jest.fn(),
        navigate: jest.fn(),
        isHeadless: true,
      };

      const mockTripleStore: ITripleStore = {
        add: jest.fn(),
        remove: jest.fn(),
        has: jest.fn(),
        match: jest.fn(),
        addAll: jest.fn(),
        removeAll: jest.fn(),
        clear: jest.fn(),
        count: jest.fn(),
        subjects: jest.fn(),
        predicates: jest.fn(),
        objects: jest.fn(),
        beginTransaction: jest.fn(),
      };

      const mockFile: IFile = {
        path: "/test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      // Create context with optional currentAsset
      const contextWithAsset: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: mockUIProvider,
        currentAsset: mockFile,
      };

      expect(contextWithAsset.currentAsset).toBe(mockFile);
      expect(contextWithAsset.uiProvider.isHeadless).toBe(true);
    });

    it("should allow optional cliArgs field", () => {
      const mockUIProvider: IUIProvider = {
        showInputModal: jest.fn(),
        showSelectModal: jest.fn(),
        showConfirm: jest.fn(),
        notify: jest.fn(),
        navigate: jest.fn(),
        isHeadless: true,
      };

      const mockTripleStore: ITripleStore = {
        add: jest.fn(),
        remove: jest.fn(),
        has: jest.fn(),
        match: jest.fn(),
        addAll: jest.fn(),
        removeAll: jest.fn(),
        clear: jest.fn(),
        count: jest.fn(),
        subjects: jest.fn(),
        predicates: jest.fn(),
        objects: jest.fn(),
        beginTransaction: jest.fn(),
      };

      const cliArgs = {
        project: "test-project",
        force: "true",
      };

      // Create context with CLI arguments
      const contextWithCliArgs: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: mockUIProvider,
        cliArgs,
      };

      expect(contextWithCliArgs.cliArgs).toEqual(cliArgs);
      expect(contextWithCliArgs.cliArgs?.project).toBe("test-project");
    });
  });
});

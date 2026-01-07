/**
 * Tests for ActionInterpreter - Action execution engine
 *
 * Issue #1404: Implement ActionInterpreter base structure
 * @see https://github.com/kitelev/exocortex/issues/1404
 *
 * Tests for:
 * - Constructor and handler registration
 * - execute() method
 * - loadActionDefinition() method
 * - Error handling for unknown action types
 */

import { ITripleStore } from "../../../../src/interfaces/ITripleStore";
import { IUIProvider, HeadlessError } from "../../../../src/domain/ports/IUIProvider";
import { ActionContext } from "../../../../src/domain/types/ActionContext";
import {
  ActionResult,
  ActionDefinition,
  ActionHandler,
} from "../../../../src/domain/types/ActionTypes";
import { ActionInterpreter } from "../../../../src/domain/services/ActionInterpreter";
import { GenericAssetCreationService } from "../../../../src/services/GenericAssetCreationService";
import { IFile, IVaultAdapter } from "../../../../src/interfaces/IVaultAdapter";

describe("ActionInterpreter", () => {
  let mockTripleStore: ITripleStore;
  let mockUIProvider: IUIProvider;
  let mockContext: ActionContext;

  const createMockUIProvider = (isHeadless: boolean): IUIProvider => ({
    showInputModal: jest.fn(),
    showSelectModal: jest.fn(),
    showConfirm: jest.fn(),
    notify: jest.fn(),
    navigate: jest.fn(),
    isHeadless,
  });

  beforeEach(() => {
    mockUIProvider = createMockUIProvider(false);

    mockTripleStore = {
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

    mockContext = {
      tripleStore: mockTripleStore,
      uiProvider: mockUIProvider,
    };
  });

  describe("constructor and handler registration", () => {
    it("should create instance with tripleStore", () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter).toBeInstanceOf(ActionInterpreter);
    });

    it("should register all 8 built-in handlers on construction", () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      // Check that all 8 Fixed Verbs are registered
      const expectedHandlers = [
        "exo-ui:CreateAssetAction",
        "exo-ui:UpdatePropertyAction",
        "exo-ui:NavigateAction",
        "exo-ui:ExecuteSPARQLAction",
        "exo-ui:ShowModalAction",
        "exo-ui:TriggerHookAction",
        "exo-ui:CustomHandlerAction",
        "exo-ui:CompositeAction",
      ];

      for (const handlerType of expectedHandlers) {
        expect(interpreter.hasHandler(handlerType)).toBe(true);
      }
    });

    it("should allow registering custom handlers", () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      const customHandler: ActionHandler = async () => ({
        success: true,
        message: "Custom handler executed",
      });

      interpreter.registerCustomHandler("custom:MyAction", customHandler);

      expect(interpreter.hasHandler("custom:MyAction")).toBe(true);
    });
  });

  describe("execute() method", () => {
    it("should return error for unknown action type", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      // Mock loadActionDefinition to return an unknown action type
      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "unknown:NonExistentAction",
        params: {},
      });

      const result = await interpreter.execute(
        "https://exocortex.my/actions/unknown-action",
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown action type");
      expect(result.message).toContain("unknown:NonExistentAction");
    });

    it("should execute registered handler with definition and context", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      // Mock the loadActionDefinition to return a known type
      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:CreateAssetAction",
        params: { targetClass: "Task" },
      });

      const result = await interpreter.execute(
        "https://exocortex.my/actions/create-task-1",
        mockContext
      );

      // Should call handler (stub returns not implemented)
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    it("should pass action definition params to handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      let receivedDefinition: ActionDefinition | undefined;
      const captureHandler: ActionHandler = async (def, ctx) => {
        receivedDefinition = def;
        return { success: true };
      };

      interpreter.registerCustomHandler("test:CaptureAction", captureHandler);

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "test:CaptureAction",
        params: { key: "value", num: 42 },
      });

      await interpreter.execute("https://exocortex.my/test/action", mockContext);

      expect(receivedDefinition).toBeDefined();
      expect(receivedDefinition?.type).toBe("test:CaptureAction");
      expect(receivedDefinition?.params.key).toBe("value");
      expect(receivedDefinition?.params.num).toBe(42);
    });

    it("should pass context to handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      let receivedContext: ActionContext | undefined;
      const captureHandler: ActionHandler = async (def, ctx) => {
        receivedContext = ctx;
        return { success: true };
      };

      interpreter.registerCustomHandler("test:ContextAction", captureHandler);

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "test:ContextAction",
        params: {},
      });

      await interpreter.execute("https://exocortex.my/test/ctx", mockContext);

      expect(receivedContext).toBeDefined();
      expect(receivedContext?.tripleStore).toBe(mockTripleStore);
      expect(receivedContext?.uiProvider).toBe(mockUIProvider);
    });
  });

  describe("loadActionDefinition() method", () => {
    it("should query triple store for action definition", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      // Mock match to return triples that define an action
      (mockTripleStore.match as jest.Mock).mockResolvedValue([]);

      try {
        await (interpreter as any).loadActionDefinition(
          "https://exocortex.my/actions/test-action"
        );
      } catch (e) {
        // Expected to throw since no action type found
      }

      // Should have queried the triple store
      expect(mockTripleStore.match).toHaveBeenCalled();
    });

    it("should parse action type from triple store results", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      // Mock triple store to return type triple
      const typeIRI = {
        termType: "NamedNode" as const,
        value: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
      };
      const actionIRI = {
        termType: "NamedNode" as const,
        value: "https://exocortex.my/actions/create-1",
      };
      const rdfType = {
        termType: "NamedNode" as const,
        value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      };

      (mockTripleStore.match as jest.Mock).mockResolvedValue([
        {
          subject: actionIRI,
          predicate: rdfType,
          object: typeIRI,
          toString: () => "<action> a <type>",
        },
      ]);

      const definition = await (interpreter as any).loadActionDefinition(
        "https://exocortex.my/actions/create-1"
      );

      expect(definition.type).toBe("exo-ui:CreateAssetAction");
    });

    it("should extract params from triple store results", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      const actionIRI = {
        termType: "NamedNode" as const,
        value: "https://exocortex.my/actions/create-1",
      };
      const typeIRI = {
        termType: "NamedNode" as const,
        value: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
      };
      const rdfType = {
        termType: "NamedNode" as const,
        value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      };
      const targetClassPredicate = {
        termType: "NamedNode" as const,
        value: "https://exocortex.my/ontology/exo-ui#targetClass",
      };
      const targetClassValue = {
        termType: "Literal" as const,
        value: "Task",
      };

      (mockTripleStore.match as jest.Mock).mockResolvedValue([
        {
          subject: actionIRI,
          predicate: rdfType,
          object: typeIRI,
          toString: () => "<action> a <CreateAssetAction>",
        },
        {
          subject: actionIRI,
          predicate: targetClassPredicate,
          object: targetClassValue,
          toString: () => "<action> exo-ui:targetClass Task",
        },
      ]);

      const definition = await (interpreter as any).loadActionDefinition(
        "https://exocortex.my/actions/create-1"
      );

      expect(definition.params.targetClass).toBe("Task");
    });

    it("should throw error if action type not found", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      (mockTripleStore.match as jest.Mock).mockResolvedValue([]);

      await expect(
        (interpreter as any).loadActionDefinition(
          "https://exocortex.my/actions/unknown"
        )
      ).rejects.toThrow("Action type not found");
    });
  });

  describe("CreateAssetAction handler (Issue #1405)", () => {
    let mockAssetCreationService: jest.Mocked<GenericAssetCreationService>;
    let mockFile: IFile;

    beforeEach(() => {
      mockFile = {
        path: "tasks/test-uuid.md",
        basename: "test-uuid",
        name: "test-uuid.md",
        parent: { path: "tasks", name: "tasks" },
      };

      mockAssetCreationService = {
        createAsset: jest.fn().mockResolvedValue(mockFile),
      } as unknown as jest.Mocked<GenericAssetCreationService>;
    });

    it("should create asset with targetClass in UI mode", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        mockAssetCreationService
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:CreateAssetAction",
        params: { targetClass: "ems__Task" },
      });

      // UI mode: isHeadless = false
      const uiContext: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
      };

      const result = await interpreter.execute("test:action", uiContext);

      expect(result.success).toBe(true);
      expect(result.navigateTo).toBe(mockFile);
      expect(result.refresh).toBe(true);
      expect(mockAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          className: "ems__Task",
        })
      );
    });

    it("should use template if provided", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        mockAssetCreationService
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:CreateAssetAction",
        params: {
          targetClass: "ems__Task",
          template: "meeting-notes",
        },
      });

      const uiContext: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
      };

      const result = await interpreter.execute("test:action", uiContext);

      expect(result.success).toBe(true);
      expect(mockAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          className: "ems__Task",
          label: "meeting-notes",
        })
      );
    });

    it("should use location if provided", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        mockAssetCreationService
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:CreateAssetAction",
        params: {
          targetClass: "ems__Task",
          location: "projects/my-project",
        },
      });

      const uiContext: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
      };

      const result = await interpreter.execute("test:action", uiContext);

      expect(result.success).toBe(true);
      expect(mockAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          className: "ems__Task",
          folderPath: "projects/my-project",
        })
      );
    });

    it("should throw HeadlessError if CLI mode without location", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        mockAssetCreationService
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:CreateAssetAction",
        params: { targetClass: "ems__Task" },
        // No location provided
      });

      // Headless mode: isHeadless = true
      const cliContext: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(true),
      };

      const result = await interpreter.execute("test:action", cliContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain("requires UI");
      expect(result.message).toContain("--location");
    });

    it("should work in CLI mode with location provided", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        mockAssetCreationService
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:CreateAssetAction",
        params: {
          targetClass: "ems__Task",
          location: "inbox/tasks",
        },
      });

      // Headless mode: isHeadless = true
      const cliContext: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(true),
      };

      const result = await interpreter.execute("test:action", cliContext);

      expect(result.success).toBe(true);
      expect(result.navigateTo).toBe(mockFile);
      expect(mockAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          className: "ems__Task",
          folderPath: "inbox/tasks",
        })
      );
    });

    it("should return error if asset creation fails", async () => {
      mockAssetCreationService.createAsset.mockRejectedValue(
        new Error("Vault not initialized")
      );

      const interpreter = new ActionInterpreter(
        mockTripleStore,
        mockAssetCreationService
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:CreateAssetAction",
        params: { targetClass: "ems__Task" },
      });

      const uiContext: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
      };

      const result = await interpreter.execute("test:action", uiContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Vault not initialized");
    });
  });

  describe("built-in handlers (stub implementations)", () => {
    it("should have UpdatePropertyAction handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("exo-ui:UpdatePropertyAction")).toBe(true);
    });

    it("should have NavigateAction handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("exo-ui:NavigateAction")).toBe(true);
    });

    it("should have ExecuteSPARQLAction handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("exo-ui:ExecuteSPARQLAction")).toBe(true);
    });

    it("should have ShowModalAction handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("exo-ui:ShowModalAction")).toBe(true);
    });

    it("should have TriggerHookAction handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("exo-ui:TriggerHookAction")).toBe(true);
    });

    it("should have CustomHandlerAction handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("exo-ui:CustomHandlerAction")).toBe(true);
    });

    it("should have CompositeAction handler", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("exo-ui:CompositeAction")).toBe(true);
    });
  });

  describe("hasHandler() method", () => {
    it("should return true for registered handlers", () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("exo-ui:CreateAssetAction")).toBe(true);
    });

    it("should return false for unregistered handlers", () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      expect(interpreter.hasHandler("unknown:Action")).toBe(false);
    });
  });

  describe("UpdatePropertyAction handler (Issue #1406)", () => {
    let mockVaultAdapter: jest.Mocked<IVaultAdapter>;
    let mockFile: IFile;

    beforeEach(() => {
      mockFile = {
        path: "tasks/test-uuid.md",
        basename: "test-uuid",
        name: "test-uuid.md",
        parent: { path: "tasks", name: "tasks" },
      };

      mockVaultAdapter = {
        read: jest.fn(),
        exists: jest.fn(),
        getAllFiles: jest.fn(),
        getAbstractFileByPath: jest.fn(),
        create: jest.fn(),
        modify: jest.fn(),
        delete: jest.fn(),
        process: jest.fn(),
        rename: jest.fn(),
        updateLinks: jest.fn(),
        createFolder: jest.fn(),
        getDefaultNewFileParent: jest.fn(),
        getFrontmatter: jest.fn(),
        updateFrontmatter: jest.fn().mockResolvedValue(undefined),
        getFirstLinkpathDest: jest.fn(),
      } as jest.Mocked<IVaultAdapter>;
    });

    it("should update property on currentAsset", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        undefined, // assetCreationService
        mockVaultAdapter
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:UpdatePropertyAction",
        params: {
          targetProperty: "ems__Effort_status",
          targetValue: "active",
        },
      });

      const contextWithAsset: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
        currentAsset: mockFile,
      };

      const result = await interpreter.execute("test:action", contextWithAsset);

      expect(result.success).toBe(true);
      expect(result.refresh).toBe(true);
      expect(mockVaultAdapter.updateFrontmatter).toHaveBeenCalledWith(
        mockFile,
        expect.any(Function)
      );

      // Verify the updater function sets the property correctly
      const updaterFn = mockVaultAdapter.updateFrontmatter.mock.calls[0][1];
      const testFrontmatter = { existingProp: "value" };
      const updatedFrontmatter = updaterFn(testFrontmatter);
      expect(updatedFrontmatter["ems__Effort_status"]).toBe("active");
    });

    it("should update property on targetAsset if specified", async () => {
      const targetFile: IFile = {
        path: "projects/target-project.md",
        basename: "target-project",
        name: "target-project.md",
        parent: { path: "projects", name: "projects" },
      };

      mockVaultAdapter.getAbstractFileByPath.mockReturnValue(targetFile);

      const interpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        mockVaultAdapter
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:UpdatePropertyAction",
        params: {
          targetProperty: "ems__Project_status",
          targetValue: "completed",
          targetAsset: "projects/target-project.md",
        },
      });

      const contextWithAsset: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
        currentAsset: mockFile, // Should be ignored when targetAsset is provided
      };

      const result = await interpreter.execute("test:action", contextWithAsset);

      expect(result.success).toBe(true);
      expect(result.refresh).toBe(true);
      expect(mockVaultAdapter.getAbstractFileByPath).toHaveBeenCalledWith(
        "projects/target-project.md"
      );
      expect(mockVaultAdapter.updateFrontmatter).toHaveBeenCalledWith(
        targetFile,
        expect.any(Function)
      );

      // Verify the updater function sets the property correctly
      const updaterFn = mockVaultAdapter.updateFrontmatter.mock.calls[0][1];
      const testFrontmatter = {};
      const updatedFrontmatter = updaterFn(testFrontmatter);
      expect(updatedFrontmatter["ems__Project_status"]).toBe("completed");
    });

    it("should return error if no asset (neither currentAsset nor targetAsset)", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        mockVaultAdapter
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:UpdatePropertyAction",
        params: {
          targetProperty: "status",
          targetValue: "active",
        },
      });

      // Context without currentAsset
      const contextWithoutAsset: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
        // No currentAsset
      };

      const result = await interpreter.execute("test:action", contextWithoutAsset);

      expect(result.success).toBe(false);
      expect(result.message).toContain("No target asset");
    });

    it("should return error if targetAsset not found", async () => {
      mockVaultAdapter.getAbstractFileByPath.mockReturnValue(null);

      const interpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        mockVaultAdapter
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:UpdatePropertyAction",
        params: {
          targetProperty: "status",
          targetValue: "active",
          targetAsset: "nonexistent/file.md",
        },
      });

      const contextWithAsset: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
        currentAsset: mockFile,
      };

      const result = await interpreter.execute("test:action", contextWithAsset);

      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("should return error if vaultAdapter is not provided", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        undefined // No vaultAdapter
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:UpdatePropertyAction",
        params: {
          targetProperty: "status",
          targetValue: "active",
        },
      });

      const contextWithAsset: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
        currentAsset: mockFile,
      };

      const result = await interpreter.execute("test:action", contextWithAsset);

      expect(result.success).toBe(false);
      expect(result.message).toContain("VaultAdapter not initialized");
    });

    it("should handle update failure gracefully", async () => {
      mockVaultAdapter.updateFrontmatter.mockRejectedValue(
        new Error("File locked")
      );

      const interpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        mockVaultAdapter
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:UpdatePropertyAction",
        params: {
          targetProperty: "status",
          targetValue: "active",
        },
      });

      const contextWithAsset: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
        currentAsset: mockFile,
      };

      const result = await interpreter.execute("test:action", contextWithAsset);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to update property");
      expect(result.message).toContain("File locked");
    });

    it("should support null value to remove property", async () => {
      const interpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        mockVaultAdapter
      );

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:UpdatePropertyAction",
        params: {
          targetProperty: "ems__Effort_status",
          targetValue: null,
        },
      });

      const contextWithAsset: ActionContext = {
        tripleStore: mockTripleStore,
        uiProvider: createMockUIProvider(false),
        currentAsset: mockFile,
      };

      const result = await interpreter.execute("test:action", contextWithAsset);

      expect(result.success).toBe(true);

      // Verify the updater function removes the property
      const updaterFn = mockVaultAdapter.updateFrontmatter.mock.calls[0][1];
      const testFrontmatter = { "ems__Effort_status": "active", other: "value" };
      const updatedFrontmatter = updaterFn(testFrontmatter);
      expect(updatedFrontmatter["ems__Effort_status"]).toBeUndefined();
      expect(updatedFrontmatter["other"]).toBe("value");
    });
  });
});

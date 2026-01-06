/**
 * Tests for ActionTypes interfaces
 *
 * Issue #1403: Create ActionTypes.ts with interfaces
 * @see https://github.com/kitelev/exocortex/issues/1403
 *
 * Tests for:
 * - ActionResult interface
 * - ActionDefinition interface
 * - ActionHandler type
 */
import { ITripleStore } from "../../../../src/interfaces/ITripleStore";
import { IUIProvider } from "../../../../src/domain/ports/IUIProvider";
import { IFile } from "../../../../src/interfaces/IVaultAdapter";

// Import the types being tested - this should fail initially (TDD RED)
import {
  ActionResult,
  ActionDefinition,
  ActionHandler,
} from "../../../../src/domain/types/ActionTypes";
import { ActionContext } from "../../../../src/domain/types/ActionContext";

describe("ActionTypes", () => {
  // Helper to create mock context
  const createMockContext = (): ActionContext => {
    const mockUIProvider: IUIProvider = {
      showInputModal: jest.fn(),
      showSelectModal: jest.fn(),
      showConfirm: jest.fn(),
      notify: jest.fn(),
      navigate: jest.fn(),
      isHeadless: false,
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

    return {
      tripleStore: mockTripleStore,
      uiProvider: mockUIProvider,
    };
  };

  describe("ActionResult interface", () => {
    it("should allow success result with just success flag", () => {
      const result: ActionResult = {
        success: true,
      };

      expect(result.success).toBe(true);
      expect(result.message).toBeUndefined();
      expect(result.navigateTo).toBeUndefined();
      expect(result.refresh).toBeUndefined();
      expect(result.data).toBeUndefined();
    });

    it("should allow failure result with message", () => {
      const result: ActionResult = {
        success: false,
        message: "Operation failed: invalid asset",
      };

      expect(result.success).toBe(false);
      expect(result.message).toBe("Operation failed: invalid asset");
    });

    it("should allow success result with navigateTo file", () => {
      const mockFile: IFile = {
        path: "/projects/new-project.md",
        basename: "new-project",
        name: "new-project.md",
        parent: null,
      };

      const result: ActionResult = {
        success: true,
        message: "Project created successfully",
        navigateTo: mockFile,
      };

      expect(result.success).toBe(true);
      expect(result.navigateTo).toBe(mockFile);
      expect(result.navigateTo?.path).toBe("/projects/new-project.md");
    });

    it("should allow result with refresh flag", () => {
      const result: ActionResult = {
        success: true,
        refresh: true,
      };

      expect(result.refresh).toBe(true);
    });

    it("should allow result with arbitrary data payload", () => {
      const result: ActionResult = {
        success: true,
        data: {
          createdAssets: ["asset-1", "asset-2"],
          processedCount: 2,
        },
      };

      expect(result.data).toEqual({
        createdAssets: ["asset-1", "asset-2"],
        processedCount: 2,
      });
    });

    it("should allow full result with all fields", () => {
      const mockFile: IFile = {
        path: "/tasks/task-123.md",
        basename: "task-123",
        name: "task-123.md",
        parent: null,
      };

      const result: ActionResult = {
        success: true,
        message: "Task created and linked to project",
        navigateTo: mockFile,
        refresh: true,
        data: { taskId: "123" },
      };

      expect(result.success).toBe(true);
      expect(result.message).toBe("Task created and linked to project");
      expect(result.navigateTo).toBe(mockFile);
      expect(result.refresh).toBe(true);
      expect(result.data).toEqual({ taskId: "123" });
    });
  });

  describe("ActionDefinition interface", () => {
    it("should have type and params fields", () => {
      const definition: ActionDefinition = {
        type: "exo-ui:CreateAssetAction",
        params: {},
      };

      expect(definition.type).toBe("exo-ui:CreateAssetAction");
      expect(definition.params).toEqual({});
    });

    it("should allow params with various value types", () => {
      const definition: ActionDefinition = {
        type: "exo-ui:UpdatePropertyAction",
        params: {
          property: "exo:Asset_status",
          value: "completed",
          assetUri: "https://exocortex.my/assets/task-123",
          timestamp: 1704067200000,
          force: true,
        },
      };

      expect(definition.type).toBe("exo-ui:UpdatePropertyAction");
      expect(definition.params.property).toBe("exo:Asset_status");
      expect(definition.params.value).toBe("completed");
      expect(definition.params.assetUri).toBe("https://exocortex.my/assets/task-123");
      expect(definition.params.timestamp).toBe(1704067200000);
      expect(definition.params.force).toBe(true);
    });

    it("should allow nested params objects", () => {
      const definition: ActionDefinition = {
        type: "exo-ui:CompositeAction",
        params: {
          actions: [
            { type: "exo-ui:CreateAssetAction", params: { class: "Task" } },
            { type: "exo-ui:NavigateAction", params: { target: "created" } },
          ],
          sequential: true,
        },
      };

      expect(definition.params.actions).toHaveLength(2);
      expect(definition.params.sequential).toBe(true);
    });
  });

  describe("ActionHandler type", () => {
    it("should be a function taking definition and context, returning Promise<ActionResult>", async () => {
      const handler: ActionHandler = async (
        definition: ActionDefinition,
        context: ActionContext
      ): Promise<ActionResult> => {
        return {
          success: true,
          message: `Executed action: ${definition.type}`,
        };
      };

      const definition: ActionDefinition = {
        type: "exo-ui:TestAction",
        params: {},
      };

      const context = createMockContext();
      const result = await handler(definition, context);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Executed action: exo-ui:TestAction");
    });

    it("should allow handler to access definition params", async () => {
      const handler: ActionHandler = async (definition, context) => {
        const targetClass = definition.params.assetClass as string;
        return {
          success: true,
          message: `Creating asset of class: ${targetClass}`,
        };
      };

      const result = await handler(
        {
          type: "exo-ui:CreateAssetAction",
          params: { assetClass: "Task" },
        },
        createMockContext()
      );

      expect(result.message).toBe("Creating asset of class: Task");
    });

    it("should allow handler to access context services", async () => {
      const handler: ActionHandler = async (definition, context) => {
        // Access uiProvider from context
        const isHeadless = context.uiProvider.isHeadless;
        return {
          success: true,
          data: { headlessMode: isHeadless },
        };
      };

      const result = await handler(
        { type: "exo-ui:CheckModeAction", params: {} },
        createMockContext()
      );

      expect(result.data).toEqual({ headlessMode: false });
    });

    it("should allow handler to return failure result", async () => {
      const handler: ActionHandler = async (definition, context) => {
        if (!definition.params.required) {
          return {
            success: false,
            message: "Missing required parameter",
          };
        }
        return { success: true };
      };

      const result = await handler(
        { type: "exo-ui:ValidateAction", params: {} },
        createMockContext()
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("Missing required parameter");
    });
  });
});

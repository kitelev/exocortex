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
import { IUIProvider } from "../../../../src/domain/ports/IUIProvider";
import { ActionContext } from "../../../../src/domain/types/ActionContext";
import {
  ActionResult,
  ActionDefinition,
  ActionHandler,
} from "../../../../src/domain/types/ActionTypes";
import { ActionInterpreter } from "../../../../src/domain/services/ActionInterpreter";

describe("ActionInterpreter", () => {
  let mockTripleStore: ITripleStore;
  let mockUIProvider: IUIProvider;
  let mockContext: ActionContext;

  beforeEach(() => {
    mockUIProvider = {
      showInputModal: jest.fn(),
      showSelectModal: jest.fn(),
      showConfirm: jest.fn(),
      notify: jest.fn(),
      navigate: jest.fn(),
      isHeadless: false,
    };

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

  describe("built-in handlers (stub implementations)", () => {
    it("should have CreateAssetAction handler that returns not implemented", async () => {
      const interpreter = new ActionInterpreter(mockTripleStore);

      jest.spyOn(interpreter as any, "loadActionDefinition").mockResolvedValue({
        type: "exo-ui:CreateAssetAction",
        params: { targetClass: "Task" },
      });

      const result = await interpreter.execute("test:action", mockContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Not implemented");
    });

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
});

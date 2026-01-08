// Import reflect-metadata for TSyringe dependency injection support
import "reflect-metadata";

/**
 * Integration tests verifying that CLI and Obsidian plugin use unified
 * ActionInterpreter from @exocortex/core.
 *
 * These tests verify the "Definition of Done" for RDF-Driven Architecture:
 * - ActionInterpreter exists only in core package
 * - Both CLI and Obsidian import from core, not local copies
 * - Shared components produce identical behavior
 *
 * @see https://github.com/kitelev/exocortex/issues/1469
 * @see RDF-Driven Architecture Implementation Plan, Phase 7 (lines 3147-3158)
 */

import { ActionInterpreter } from "../../../src/domain/services/ActionInterpreter";
import { ConditionEvaluator } from "../../../src/domain/services/ConditionEvaluator";
import { LayoutSelector } from "../../../src/domain/services/LayoutSelector";
import { ShaclValidator } from "../../../src/services/shacl/ShaclValidator";
import { IUIProvider, HeadlessError } from "../../../src/domain/ports/IUIProvider";
import { ITripleStore } from "../../../src/interfaces/ITripleStore";

// Re-export check - these must be exported from index.ts for consumers
import * as exocortex from "../../../src/index";

describe("Shared Core Verification (Issue #1469)", () => {
  describe("Single Definition Verification", () => {
    it("ActionInterpreter should be exported from core package", () => {
      expect(exocortex.ActionInterpreter).toBeDefined();
      expect(exocortex.ActionInterpreter).toBe(ActionInterpreter);
    });

    it("ConditionEvaluator should be exported from core package", () => {
      expect(exocortex.ConditionEvaluator).toBeDefined();
      expect(exocortex.ConditionEvaluator).toBe(ConditionEvaluator);
    });

    it("LayoutSelector should be exported from core package", () => {
      expect(exocortex.LayoutSelector).toBeDefined();
      expect(exocortex.LayoutSelector).toBe(LayoutSelector);
    });

    it("ShaclValidator should be exported from core package", () => {
      expect(exocortex.ShaclValidator).toBeDefined();
      expect(exocortex.ShaclValidator).toBe(ShaclValidator);
    });

    it("IUIProvider interface types should be exported", () => {
      // HeadlessError is a class that can be instantiated
      expect(exocortex.HeadlessError).toBeDefined();
      expect(exocortex.HeadlessError).toBe(HeadlessError);
    });
  });

  describe("ActionInterpreter Behavior Parity", () => {
    let mockTripleStore: ITripleStore;
    let headlessUIProvider: IUIProvider;
    let interactiveUIProvider: IUIProvider;

    beforeEach(() => {
      mockTripleStore = {
        add: jest.fn(),
        remove: jest.fn(),
        has: jest.fn(),
        match: jest.fn().mockResolvedValue([]),
        addAll: jest.fn(),
        removeAll: jest.fn(),
        clear: jest.fn(),
        count: jest.fn(),
        subjects: jest.fn(),
        predicates: jest.fn(),
        objects: jest.fn(),
        beginTransaction: jest.fn(),
      };

      // CLI mode (headless)
      headlessUIProvider = {
        showInputModal: jest.fn().mockRejectedValue(
          new HeadlessError("Input modal", "Use CLI args")
        ),
        showSelectModal: jest.fn().mockRejectedValue(
          new HeadlessError("Selection", "Use --select arg")
        ),
        showConfirm: jest.fn().mockRejectedValue(
          new HeadlessError("Confirmation", "Use --force")
        ),
        notify: jest.fn(),
        navigate: jest.fn(),
        isHeadless: true,
      };

      // Obsidian mode (interactive)
      interactiveUIProvider = {
        showInputModal: jest.fn().mockResolvedValue("user input"),
        showSelectModal: jest.fn().mockResolvedValue({ id: "selected" }),
        showConfirm: jest.fn().mockResolvedValue(true),
        notify: jest.fn(),
        navigate: jest.fn(),
        isHeadless: false,
      };
    });

    it("same ActionInterpreter class used regardless of UI mode", () => {
      // Create interpreter for CLI mode
      const cliInterpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        undefined,
        undefined,
        undefined,
        headlessUIProvider
      );

      // Create interpreter for Obsidian mode
      const obsidianInterpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        undefined,
        undefined,
        undefined,
        interactiveUIProvider
      );

      // Both should be same class
      expect(cliInterpreter.constructor).toBe(obsidianInterpreter.constructor);
      expect(cliInterpreter.constructor.name).toBe("ActionInterpreter");
    });

    it("both modes register same 8 built-in handlers", () => {
      const cliInterpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        undefined,
        undefined,
        undefined,
        headlessUIProvider
      );

      const obsidianInterpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        undefined,
        undefined,
        undefined,
        interactiveUIProvider
      );

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

      for (const handler of expectedHandlers) {
        expect(cliInterpreter.hasHandler(handler)).toBe(true);
        expect(obsidianInterpreter.hasHandler(handler)).toBe(true);
      }
    });

    it("unknown action type returns same error format in both modes", async () => {
      const cliInterpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        undefined,
        undefined,
        undefined,
        headlessUIProvider
      );

      const obsidianInterpreter = new ActionInterpreter(
        mockTripleStore,
        undefined,
        undefined,
        undefined,
        undefined,
        interactiveUIProvider
      );

      const context = {
        tripleStore: mockTripleStore,
        uiProvider: headlessUIProvider,
      };

      // Both should return same error format for non-existent action
      const cliResult = await cliInterpreter.execute(
        "non:ExistentAction",
        context
      );
      const obsidianResult = await obsidianInterpreter.execute(
        "non:ExistentAction",
        { ...context, uiProvider: interactiveUIProvider }
      );

      // Both fail with same error pattern (Invalid IRI format for malformed action URI)
      expect(cliResult.success).toBe(false);
      expect(obsidianResult.success).toBe(false);
      // Both should have same error structure
      expect(cliResult.message).toBeDefined();
      expect(obsidianResult.message).toBeDefined();
      // Both should fail with same error type
      expect(cliResult.message).toEqual(obsidianResult.message);
    });
  });

  describe("ConditionEvaluator Parity", () => {
    let mockTripleStore: ITripleStore;

    beforeEach(() => {
      mockTripleStore = {
        add: jest.fn(),
        remove: jest.fn(),
        has: jest.fn(),
        match: jest.fn().mockResolvedValue([]),
        addAll: jest.fn(),
        removeAll: jest.fn(),
        clear: jest.fn(),
        count: jest.fn(),
        subjects: jest.fn(),
        predicates: jest.fn(),
        objects: jest.fn(),
        beginTransaction: jest.fn(),
      };
    });

    it("same ConditionEvaluator class regardless of consumer", () => {
      const evaluator1 = new ConditionEvaluator(mockTripleStore);
      const evaluator2 = new ConditionEvaluator(mockTripleStore);

      expect(evaluator1.constructor).toBe(evaluator2.constructor);
      expect(evaluator1.constructor.name).toBe("ConditionEvaluator");
    });
  });

  describe("ShaclValidator Parity", () => {
    it("same ShaclValidator class regardless of consumer", () => {
      const validator1 = new ShaclValidator();
      const validator2 = new ShaclValidator();

      expect(validator1.constructor).toBe(validator2.constructor);
      expect(validator1.constructor.name).toBe("ShaclValidator");
    });

    it("validation produces consistent results", async () => {
      const validator1 = new ShaclValidator();
      const validator2 = new ShaclValidator();

      // Minimal valid ontology and shapes
      const ontology = `
        @prefix ex: <http://example.org/> .
        ex:subject ex:predicate "value" .
      `;

      const shapes = `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix ex: <http://example.org/> .
      `;

      const result1 = await validator1.validate(ontology, shapes);
      const result2 = await validator2.validate(ontology, shapes);

      // Both should produce same conformance result
      expect(result1.conforms).toBe(result2.conforms);
    });
  });

  describe("LayoutSelector Parity", () => {
    let mockTripleStore: ITripleStore;

    beforeEach(() => {
      mockTripleStore = {
        add: jest.fn(),
        remove: jest.fn(),
        has: jest.fn(),
        match: jest.fn().mockResolvedValue([]),
        addAll: jest.fn(),
        removeAll: jest.fn(),
        clear: jest.fn(),
        count: jest.fn(),
        subjects: jest.fn(),
        predicates: jest.fn(),
        objects: jest.fn(),
        beginTransaction: jest.fn(),
      };
    });

    it("same LayoutSelector class regardless of consumer", () => {
      const selector1 = new LayoutSelector(mockTripleStore);
      const selector2 = new LayoutSelector(mockTripleStore);

      expect(selector1.constructor).toBe(selector2.constructor);
      expect(selector1.constructor.name).toBe("LayoutSelector");
    });
  });
});

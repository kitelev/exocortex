/**
 * ActionBridge Unit Tests
 *
 * Tests for the ActionBridge adapter class that maps RDF action definitions
 * to ActionInterpreter's ActionDefinition type.
 *
 * @see https://github.com/kitelev/exocortex/issues/1997
 * @module tests/unit/application/bridges
 */

import "reflect-metadata";
import {
  ActionBridge,
  ActionMappingError,
  RdfAction,
} from "../../../../src/application/bridges/ActionBridge";

describe("ActionBridge", () => {
  describe("toActionDefinition", () => {
    describe("Feature: ActionBridge RDF-to-ActionInterpreter mapping", () => {
      describe("Scenario: Map RDF CreateAsset action to ActionInterpreter", () => {
        it("should map exo-ui:CreateAssetAction to ActionDefinition format", () => {
          // Given an RDF action definition with type "exo-ui:CreateAssetAction"
          const rdfAction: RdfAction = {
            type: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
            params: { assetClass: "Task" },
          };

          // When ActionBridge.toActionDefinition() is called
          const bridge = new ActionBridge();
          const result = bridge.toActionDefinition(rdfAction);

          // Then it returns ActionDefinition with type "exo-ui:CreateAssetAction"
          expect(result.type).toBe("exo-ui:CreateAssetAction");
          expect(result.params).toEqual({ assetClass: "Task" });
        });
      });

      describe("Scenario: Handle unknown action type", () => {
        it("should throw ActionMappingError for unknown action type", () => {
          // Given an RDF action definition with unknown type
          const rdfAction: RdfAction = {
            type: "https://exocortex.my/ontology/exo-ui#UnknownAction",
            params: {},
          };

          // When ActionBridge.toActionDefinition() is called
          const bridge = new ActionBridge();

          // Then it throws ActionMappingError
          expect(() => bridge.toActionDefinition(rdfAction)).toThrow(ActionMappingError);
          expect(() => bridge.toActionDefinition(rdfAction)).toThrow(
            /Unknown action type.*UnknownAction/
          );
        });
      });
    });

    describe("All 8 Fixed Verb types mapping", () => {
      const fixedVerbs = [
        {
          rdfType: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
          expected: "exo-ui:CreateAssetAction",
        },
        {
          rdfType: "https://exocortex.my/ontology/exo-ui#UpdatePropertyAction",
          expected: "exo-ui:UpdatePropertyAction",
        },
        {
          rdfType: "https://exocortex.my/ontology/exo-ui#NavigateAction",
          expected: "exo-ui:NavigateAction",
        },
        {
          rdfType: "https://exocortex.my/ontology/exo-ui#ExecuteSPARQLAction",
          expected: "exo-ui:ExecuteSPARQLAction",
        },
        {
          rdfType: "https://exocortex.my/ontology/exo-ui#ShowModalAction",
          expected: "exo-ui:ShowModalAction",
        },
        {
          rdfType: "https://exocortex.my/ontology/exo-ui#TriggerHookAction",
          expected: "exo-ui:TriggerHookAction",
        },
        {
          rdfType: "https://exocortex.my/ontology/exo-ui#CustomHandlerAction",
          expected: "exo-ui:CustomHandlerAction",
        },
        {
          rdfType: "https://exocortex.my/ontology/exo-ui#CompositeAction",
          expected: "exo-ui:CompositeAction",
        },
      ];

      it.each(fixedVerbs)(
        "should map $rdfType to $expected",
        ({ rdfType, expected }) => {
          const rdfAction: RdfAction = {
            type: rdfType,
            params: { testParam: "value" },
          };

          const bridge = new ActionBridge();
          const result = bridge.toActionDefinition(rdfAction);

          expect(result.type).toBe(expected);
          expect(result.params).toEqual({ testParam: "value" });
        }
      );
    });

    describe("Params extraction", () => {
      it("should preserve all params from RDF action", () => {
        const rdfAction: RdfAction = {
          type: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
          params: {
            assetClass: "Task",
            defaultStatus: "active",
            location: "/path/to/folder",
            complex: { nested: { value: 123 } },
          },
        };

        const bridge = new ActionBridge();
        const result = bridge.toActionDefinition(rdfAction);

        expect(result.params).toEqual({
          assetClass: "Task",
          defaultStatus: "active",
          location: "/path/to/folder",
          complex: { nested: { value: 123 } },
        });
      });

      it("should handle empty params", () => {
        const rdfAction: RdfAction = {
          type: "https://exocortex.my/ontology/exo-ui#NavigateAction",
          params: {},
        };

        const bridge = new ActionBridge();
        const result = bridge.toActionDefinition(rdfAction);

        expect(result.params).toEqual({});
      });
    });

    describe("Edge cases", () => {
      it("should handle type with different namespace prefix", () => {
        // Non-exo-ui namespace should throw error
        const rdfAction: RdfAction = {
          type: "https://other.namespace/CreateAssetAction",
          params: {},
        };

        const bridge = new ActionBridge();
        expect(() => bridge.toActionDefinition(rdfAction)).toThrow(ActionMappingError);
      });

      it("should handle type that is close but not exact match", () => {
        // Similar but not exact action type name
        const rdfAction: RdfAction = {
          type: "https://exocortex.my/ontology/exo-ui#CreateAsset", // Missing "Action"
          params: {},
        };

        const bridge = new ActionBridge();
        expect(() => bridge.toActionDefinition(rdfAction)).toThrow(ActionMappingError);
      });
    });
  });
});

describe("ActionMappingError", () => {
  it("should include action type in error message", () => {
    const error = new ActionMappingError("https://exocortex.my/ontology/exo-ui#UnknownType");
    expect(error.message).toContain("UnknownType");
    expect(error.name).toBe("ActionMappingError");
  });

  it("should be instanceof Error", () => {
    const error = new ActionMappingError("test");
    expect(error).toBeInstanceOf(Error);
  });
});

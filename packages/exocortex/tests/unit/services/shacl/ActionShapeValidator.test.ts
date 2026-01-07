/**
 * ActionShape SHACL Validation Tests
 *
 * Tests for SHACL validation of Action class definitions in RDF.
 * Part of v1.4 SHACL Validation milestone.
 *
 * @see https://github.com/kitelev/exocortex/issues/1445
 * @module tests/services/shacl
 * @since 1.4.0
 */

import { ShaclValidator, ValidationResult } from "../../../../src/services/shacl/ShaclValidator";
import { ACTION_SHAPE_TURTLE, ACTION_SUBCLASS_SHAPES_TURTLE } from "../../../../src/services/shacl/shapes/ActionShape";

describe("ActionShape SHACL Validation (Issue #1445)", () => {
  let validator: ShaclValidator;

  beforeEach(() => {
    validator = new ShaclValidator();
  });

  describe("Base Action Shape Validation", () => {
    it("should pass for valid base Action with required properties", async () => {
      const validActionRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyAction rdf:type exo-ui:Action .
      `;

      const result = await validator.validate(validActionRdf, ACTION_SHAPE_TURTLE);

      // Base Action has no required properties - should pass
      expect(result.conforms).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should pass for Action with optional cliCommand property", async () => {
      const actionWithCliRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyAction rdf:type exo-ui:Action .
ex:MyAction exo-ui:Action_cliCommand "exocortex-cli task start"^^xsd:string .
      `;

      const result = await validator.validate(actionWithCliRdf, ACTION_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should pass for Action with headless property as boolean", async () => {
      const actionWithHeadlessRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyAction rdf:type exo-ui:Action .
ex:MyAction exo-ui:Action_headless "true"^^xsd:boolean .
      `;

      const result = await validator.validate(actionWithHeadlessRdf, ACTION_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should fail for Action with non-string cliCommand", async () => {
      const invalidActionRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyAction rdf:type exo-ui:Action .
ex:MyAction exo-ui:Action_cliCommand "123"^^xsd:integer .
      `;

      const result = await validator.validate(invalidActionRdf, ACTION_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_cliCommand"))).toBe(true);
    });

    it("should fail for Action with non-boolean headless", async () => {
      const invalidActionRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyAction rdf:type exo-ui:Action .
ex:MyAction exo-ui:Action_headless "not-a-bool"^^xsd:string .
      `;

      const result = await validator.validate(invalidActionRdf, ACTION_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_headless"))).toBe(true);
    });
  });

  describe("UpdatePropertyAction Shape Validation", () => {
    it("should pass for valid UpdatePropertyAction with all required properties", async () => {
      const validUpdatePropertyRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:UpdateStatusAction rdf:type exo-ui:UpdatePropertyAction .
ex:UpdateStatusAction exo-ui:Action_targetProperty ex:StatusProperty .
      `;

      const result = await validator.validate(validUpdatePropertyRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should fail for UpdatePropertyAction without targetProperty", async () => {
      const invalidUpdatePropertyRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:UpdateStatusAction rdf:type exo-ui:UpdatePropertyAction .
      `;

      const result = await validator.validate(invalidUpdatePropertyRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_targetProperty"))).toBe(true);
    });

    it("should fail for UpdatePropertyAction with non-IRI targetProperty", async () => {
      const invalidUpdatePropertyRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:UpdateStatusAction rdf:type exo-ui:UpdatePropertyAction .
ex:UpdateStatusAction exo-ui:Action_targetProperty "not-an-iri"^^xsd:string .
      `;

      const result = await validator.validate(invalidUpdatePropertyRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_targetProperty"))).toBe(true);
    });
  });

  describe("CreateAssetAction Shape Validation", () => {
    it("should pass for valid CreateAssetAction with required targetClass", async () => {
      const validCreateAssetRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:CreateTaskAction rdf:type exo-ui:CreateAssetAction .
ex:CreateTaskAction exo-ui:Action_targetClass ex:Task .
      `;

      const result = await validator.validate(validCreateAssetRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should fail for CreateAssetAction without targetClass", async () => {
      const invalidCreateAssetRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:CreateTaskAction rdf:type exo-ui:CreateAssetAction .
      `;

      const result = await validator.validate(invalidCreateAssetRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_targetClass"))).toBe(true);
    });

    it("should pass for CreateAssetAction with optional template and location", async () => {
      const fullCreateAssetRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:CreateTaskAction rdf:type exo-ui:CreateAssetAction .
ex:CreateTaskAction exo-ui:Action_targetClass ex:Task .
ex:CreateTaskAction exo-ui:Action_template ex:TaskTemplate .
ex:CreateTaskAction exo-ui:Action_location "/tasks/2025/"^^xsd:string .
      `;

      const result = await validator.validate(fullCreateAssetRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(true);
    });
  });

  describe("ExecuteSPARQLAction Shape Validation", () => {
    it("should pass for valid ExecuteSPARQLAction with required query", async () => {
      const validExecuteSPARQLRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:ListTasksAction rdf:type exo-ui:ExecuteSPARQLAction .
ex:ListTasksAction exo-ui:Action_query "SELECT ?task WHERE { ?task a ex:Task }"^^xsd:string .
      `;

      const result = await validator.validate(validExecuteSPARQLRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should fail for ExecuteSPARQLAction without query", async () => {
      const invalidExecuteSPARQLRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:ListTasksAction rdf:type exo-ui:ExecuteSPARQLAction .
      `;

      const result = await validator.validate(invalidExecuteSPARQLRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_query"))).toBe(true);
    });
  });

  describe("CompositeAction Shape Validation", () => {
    it("should pass for valid CompositeAction with actions list", async () => {
      const validCompositeRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:WorkflowAction rdf:type exo-ui:CompositeAction .
ex:WorkflowAction exo-ui:Action_actions ex:ActionList .
      `;

      const result = await validator.validate(validCompositeRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should fail for CompositeAction without actions", async () => {
      const invalidCompositeRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:WorkflowAction rdf:type exo-ui:CompositeAction .
      `;

      const result = await validator.validate(invalidCompositeRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_actions"))).toBe(true);
    });
  });

  describe("ShowModalAction Shape Validation", () => {
    it("should pass for valid ShowModalAction with required modalType", async () => {
      const validShowModalRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:ConfirmAction rdf:type exo-ui:ShowModalAction .
ex:ConfirmAction exo-ui:Action_modalType "confirm"^^xsd:string .
      `;

      const result = await validator.validate(validShowModalRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should fail for ShowModalAction without modalType", async () => {
      const invalidShowModalRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:ConfirmAction rdf:type exo-ui:ShowModalAction .
      `;

      const result = await validator.validate(invalidShowModalRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_modalType"))).toBe(true);
    });
  });

  describe("CustomHandlerAction Shape Validation", () => {
    it("should pass for valid CustomHandlerAction with required handler", async () => {
      const validCustomHandlerRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:CustomAction rdf:type exo-ui:CustomHandlerAction .
ex:CustomAction exo-ui:Action_handler "myCustomHandler"^^xsd:string .
      `;

      const result = await validator.validate(validCustomHandlerRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should fail for CustomHandlerAction without handler", async () => {
      const invalidCustomHandlerRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:CustomAction rdf:type exo-ui:CustomHandlerAction .
      `;

      const result = await validator.validate(invalidCustomHandlerRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_handler"))).toBe(true);
    });
  });

  describe("NavigateAction Shape Validation", () => {
    it("should pass for valid NavigateAction with required target", async () => {
      const validNavigateRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:GoToTaskAction rdf:type exo-ui:NavigateAction .
ex:GoToTaskAction exo-ui:Action_target ex:MyTask .
      `;

      const result = await validator.validate(validNavigateRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should fail for NavigateAction without target", async () => {
      const invalidNavigateRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:GoToTaskAction rdf:type exo-ui:NavigateAction .
      `;

      const result = await validator.validate(invalidNavigateRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Action_target"))).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty data graph", async () => {
      const emptyRdf = "";

      const result = await validator.validate(emptyRdf, ACTION_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should handle data graph with no Action instances", async () => {
      const noActionsRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix ex: <https://example.org/> .

ex:SomeOtherThing rdf:type ex:NotAnAction .
ex:SomeOtherThing ex:someProperty "value" .
      `;

      const result = await validator.validate(noActionsRdf, ACTION_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should validate only Action instances, ignoring other types", async () => {
      const mixedRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:ValidAction rdf:type exo-ui:Action .

ex:SomeOtherThing rdf:type ex:NotAnAction .
ex:SomeOtherThing ex:randomProperty "value" .
      `;

      const result = await validator.validate(mixedRdf, ACTION_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });

    it("should include descriptive error messages", async () => {
      const invalidCreateAssetRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:BadCreateAction rdf:type exo-ui:CreateAssetAction .
      `;

      const result = await validator.validate(invalidCreateAssetRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);

      // Check that each violation has required fields
      for (const violation of result.violations) {
        expect(violation.focusNode).toBeDefined();
        expect(violation.message).toBeDefined();
        expect(violation.message.length).toBeGreaterThan(0);
      }
    });

    it("should identify the focus node in violations", async () => {
      const invalidCreateAssetRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:BadCreateAction rdf:type exo-ui:CreateAssetAction .
      `;

      const result = await validator.validate(invalidCreateAssetRdf, ACTION_SUBCLASS_SHAPES_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v =>
        v.focusNode?.includes("BadCreateAction")
      )).toBe(true);
    });
  });
});

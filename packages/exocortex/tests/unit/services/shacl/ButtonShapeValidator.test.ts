/**
 * ButtonShape SHACL Validation Tests
 *
 * Tests for SHACL validation of Button class definitions in RDF.
 * Part of v1.4 SHACL Validation milestone.
 *
 * @see https://github.com/kitelev/exocortex/issues/1444
 * @module tests/services/shacl
 * @since 1.4.0
 */

import { ShaclValidator, ValidationResult } from "../../../../src/services/shacl/ShaclValidator";
import { BUTTON_SHAPE_TURTLE } from "../../../../src/services/shacl/shapes/ButtonShape";

describe("ButtonShape SHACL Validation (Issue #1444)", () => {
  let validator: ShaclValidator;

  beforeEach(() => {
    validator = new ShaclValidator();
  });

  describe("Valid Button Definitions", () => {
    it("should pass for valid button with all required properties", async () => {
      // Note: Using simple Turtle format (one triple per line) as parser doesn't support semicolons
      const validButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyButton rdf:type exo-ui:Button .
ex:MyButton exo-ui:Button_id "my-button"^^xsd:string .
ex:MyButton exo-ui:Button_action ex:MyAction .
      `;

      const result = await validator.validate(validButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should pass for button with all properties including optional ones", async () => {
      const fullButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:CreateTaskButton rdf:type exo-ui:Button .
ex:CreateTaskButton exo-ui:Button_id "create-task-btn"^^xsd:string .
ex:CreateTaskButton exo-ui:Button_action ex:CreateTaskAction .
ex:CreateTaskButton exo-ui:Button_label "Create Task"^^xsd:string .
ex:CreateTaskButton exo-ui:Button_icon "plus-circle"^^xsd:string .
ex:CreateTaskButton exo-ui:Button_tooltip "Create a new task"^^xsd:string .
ex:CreateTaskButton exo-ui:Button_condition ex:HasActiveProject .
ex:CreateTaskButton exo-ui:Button_group ex:StatusButtonGroup .
ex:CreateTaskButton exo-ui:Button_order "10"^^xsd:integer .
ex:CreateTaskButton exo-ui:Button_variant "primary"^^xsd:string .
      `;

      const result = await validator.validate(fullButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should pass for multiple valid buttons", async () => {
      const multipleButtonsRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:Button1 rdf:type exo-ui:Button .
ex:Button1 exo-ui:Button_id "btn1"^^xsd:string .
ex:Button1 exo-ui:Button_action ex:Action1 .

ex:Button2 rdf:type exo-ui:Button .
ex:Button2 exo-ui:Button_id "btn2"^^xsd:string .
ex:Button2 exo-ui:Button_action ex:Action2 .
      `;

      const result = await validator.validate(multipleButtonsRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });
  });

  describe("Invalid Button Definitions - Missing Required Properties", () => {
    it("should fail for button without id", async () => {
      const invalidButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyButton rdf:type exo-ui:Button .
ex:MyButton exo-ui:Button_action ex:MyAction .
      `;

      const result = await validator.validate(invalidButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some(v => v.path?.includes("Button_id"))).toBe(true);
    });

    it("should fail for button without action", async () => {
      const invalidButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyButton rdf:type exo-ui:Button .
ex:MyButton exo-ui:Button_id "my-button"^^xsd:string .
      `;

      const result = await validator.validate(invalidButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Button_action"))).toBe(true);
    });

    it("should fail for button missing all required properties", async () => {
      const invalidButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:EmptyButton rdf:type exo-ui:Button .
      `;

      const result = await validator.validate(invalidButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Invalid Button Definitions - Cardinality Violations", () => {
    it("should fail for button with multiple ids", async () => {
      const invalidButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyButton rdf:type exo-ui:Button .
ex:MyButton exo-ui:Button_id "my-button"^^xsd:string .
ex:MyButton exo-ui:Button_id "another-id"^^xsd:string .
ex:MyButton exo-ui:Button_action ex:MyAction .
      `;

      const result = await validator.validate(invalidButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v =>
        v.message?.toLowerCase().includes("exactly one") ||
        v.message?.toLowerCase().includes("maxcount") ||
        v.message?.toLowerCase().includes("at most")
      )).toBe(true);
    });
  });

  describe("Invalid Button Definitions - Wrong Datatypes", () => {
    it("should fail for button with non-string id", async () => {
      const invalidButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyButton rdf:type exo-ui:Button .
ex:MyButton exo-ui:Button_id "123"^^xsd:integer .
ex:MyButton exo-ui:Button_action ex:MyAction .
      `;

      const result = await validator.validate(invalidButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Button_id"))).toBe(true);
    });

    it("should fail for button with non-IRI action", async () => {
      const invalidButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyButton rdf:type exo-ui:Button .
ex:MyButton exo-ui:Button_id "my-button"^^xsd:string .
ex:MyButton exo-ui:Button_action "not-an-iri"^^xsd:string .
      `;

      const result = await validator.validate(invalidButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Button_action"))).toBe(true);
    });
  });

  describe("Validation Result Details", () => {
    it("should include descriptive error messages", async () => {
      const invalidButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyButton rdf:type exo-ui:Button .
      `;

      const result = await validator.validate(invalidButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);

      // Check that each violation has required fields
      for (const violation of result.violations) {
        expect(violation.focusNode).toBeDefined();
        expect(violation.message).toBeDefined();
        expect(violation.message.length).toBeGreaterThan(0);
      }
    });

    it("should identify the focus node in violations", async () => {
      const invalidButtonRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:BadButton rdf:type exo-ui:Button .
      `;

      const result = await validator.validate(invalidButtonRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v =>
        v.focusNode?.includes("BadButton")
      )).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty data graph", async () => {
      const emptyRdf = "";

      const result = await validator.validate(emptyRdf, BUTTON_SHAPE_TURTLE);

      // Empty graph should conform (no instances to validate)
      expect(result.conforms).toBe(true);
    });

    it("should handle data graph with no Button instances", async () => {
      const noButtonsRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix ex: <https://example.org/> .

ex:SomeOtherThing rdf:type ex:NotAButton .
ex:SomeOtherThing ex:someProperty "value" .
      `;

      const result = await validator.validate(noButtonsRdf, BUTTON_SHAPE_TURTLE);

      // No buttons = nothing to validate = conforms
      expect(result.conforms).toBe(true);
    });

    it("should validate only Button instances, ignoring other types", async () => {
      const mixedRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:ValidButton rdf:type exo-ui:Button .
ex:ValidButton exo-ui:Button_id "valid"^^xsd:string .
ex:ValidButton exo-ui:Button_action ex:SomeAction .

ex:SomeOtherThing rdf:type ex:NotAButton .
ex:SomeOtherThing ex:randomProperty "value" .
      `;

      const result = await validator.validate(mixedRdf, BUTTON_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });
  });
});

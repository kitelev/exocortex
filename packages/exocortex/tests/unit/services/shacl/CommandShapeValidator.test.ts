/**
 * CommandShape SHACL Validation Tests
 *
 * Tests for SHACL validation of Command class definitions in RDF.
 * Part of v1.4 SHACL Validation milestone.
 *
 * @see https://github.com/kitelev/exocortex/issues/1435
 * @module tests/services/shacl
 * @since 1.4.0
 */

import { ShaclValidator, ValidationResult } from "../../../../src/services/shacl/ShaclValidator";
import { COMMAND_SHAPE_TURTLE } from "../../../../src/services/shacl/shapes/CommandShape";

describe("CommandShape SHACL Validation (Issue #1435)", () => {
  let validator: ShaclValidator;

  beforeEach(() => {
    validator = new ShaclValidator();
  });

  describe("Valid Command Definitions", () => {
    it("should pass for valid command with all required properties", async () => {
      // Note: Using simple Turtle format (one triple per line) as parser doesn't support semicolons
      const validCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyCommand rdf:type exo-ui:Command .
ex:MyCommand exo-ui:Command_id "my-command"^^xsd:string .
ex:MyCommand exo-ui:Command_name "My Command"^^xsd:string .
ex:MyCommand exo-ui:Command_action ex:MyAction .
      `;

      const result = await validator.validate(validCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should pass for command with all properties including optional ones", async () => {
      const fullCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:CreateTaskCommand rdf:type exo-ui:Command .
ex:CreateTaskCommand exo-ui:Command_id "exocortex:create-task"^^xsd:string .
ex:CreateTaskCommand exo-ui:Command_name "Create Task"^^xsd:string .
ex:CreateTaskCommand exo-ui:Command_action ex:CreateTaskAction .
ex:CreateTaskCommand exo-ui:Command_icon "plus-circle"^^xsd:string .
ex:CreateTaskCommand exo-ui:Command_hotkey "Mod+Shift+T"^^xsd:string .
ex:CreateTaskCommand exo-ui:Command_condition ex:AlwaysTrueCondition .
      `;

      const result = await validator.validate(fullCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should pass for multiple valid commands", async () => {
      const multipleCommandsRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:Command1 rdf:type exo-ui:Command .
ex:Command1 exo-ui:Command_id "cmd1"^^xsd:string .
ex:Command1 exo-ui:Command_name "Command 1"^^xsd:string .
ex:Command1 exo-ui:Command_action ex:Action1 .

ex:Command2 rdf:type exo-ui:Command .
ex:Command2 exo-ui:Command_id "cmd2"^^xsd:string .
ex:Command2 exo-ui:Command_name "Command 2"^^xsd:string .
ex:Command2 exo-ui:Command_action ex:Action2 .
      `;

      const result = await validator.validate(multipleCommandsRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });
  });

  describe("Invalid Command Definitions - Missing Required Properties", () => {
    it("should fail for command without id", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyCommand rdf:type exo-ui:Command .
ex:MyCommand exo-ui:Command_name "My Command"^^xsd:string .
ex:MyCommand exo-ui:Command_action ex:MyAction .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some(v => v.path?.includes("Command_id"))).toBe(true);
    });

    it("should fail for command without name", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyCommand rdf:type exo-ui:Command .
ex:MyCommand exo-ui:Command_id "my-command"^^xsd:string .
ex:MyCommand exo-ui:Command_action ex:MyAction .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Command_name"))).toBe(true);
    });

    it("should fail for command without action", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyCommand rdf:type exo-ui:Command .
ex:MyCommand exo-ui:Command_id "my-command"^^xsd:string .
ex:MyCommand exo-ui:Command_name "My Command"^^xsd:string .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Command_action"))).toBe(true);
    });

    it("should fail for command missing all required properties", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:EmptyCommand rdf:type exo-ui:Command .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Invalid Command Definitions - Cardinality Violations", () => {
    it("should fail for command with multiple ids", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyCommand rdf:type exo-ui:Command .
ex:MyCommand exo-ui:Command_id "my-command"^^xsd:string .
ex:MyCommand exo-ui:Command_id "another-id"^^xsd:string .
ex:MyCommand exo-ui:Command_name "My Command"^^xsd:string .
ex:MyCommand exo-ui:Command_action ex:MyAction .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v =>
        v.message?.toLowerCase().includes("exactly one") ||
        v.message?.toLowerCase().includes("maxcount") ||
        v.message?.toLowerCase().includes("at most")
      )).toBe(true);
    });
  });

  describe("Invalid Command Definitions - Wrong Datatypes", () => {
    it("should fail for command with non-string id", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyCommand rdf:type exo-ui:Command .
ex:MyCommand exo-ui:Command_id "123"^^xsd:integer .
ex:MyCommand exo-ui:Command_name "My Command"^^xsd:string .
ex:MyCommand exo-ui:Command_action ex:MyAction .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Command_id"))).toBe(true);
    });

    it("should fail for command with non-IRI action", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyCommand rdf:type exo-ui:Command .
ex:MyCommand exo-ui:Command_id "my-command"^^xsd:string .
ex:MyCommand exo-ui:Command_name "My Command"^^xsd:string .
ex:MyCommand exo-ui:Command_action "not-an-iri"^^xsd:string .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v => v.path?.includes("Command_action"))).toBe(true);
    });
  });

  describe("Validation Result Details", () => {
    it("should include descriptive error messages", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:MyCommand rdf:type exo-ui:Command .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);

      // Check that each violation has required fields
      for (const violation of result.violations) {
        expect(violation.focusNode).toBeDefined();
        expect(violation.message).toBeDefined();
        expect(violation.message.length).toBeGreaterThan(0);
      }
    });

    it("should identify the focus node in violations", async () => {
      const invalidCommandRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:BadCommand rdf:type exo-ui:Command .
      `;

      const result = await validator.validate(invalidCommandRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(false);
      expect(result.violations.some(v =>
        v.focusNode?.includes("BadCommand")
      )).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty data graph", async () => {
      const emptyRdf = "";

      const result = await validator.validate(emptyRdf, COMMAND_SHAPE_TURTLE);

      // Empty graph should conform (no instances to validate)
      expect(result.conforms).toBe(true);
    });

    it("should handle data graph with no Command instances", async () => {
      const noCommandsRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix ex: <https://example.org/> .

ex:SomeOtherThing rdf:type ex:NotACommand .
ex:SomeOtherThing ex:someProperty "value" .
      `;

      const result = await validator.validate(noCommandsRdf, COMMAND_SHAPE_TURTLE);

      // No commands = nothing to validate = conforms
      expect(result.conforms).toBe(true);
    });

    it("should validate only Command instances, ignoring other types", async () => {
      const mixedRdf = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ex: <https://example.org/> .

ex:ValidCommand rdf:type exo-ui:Command .
ex:ValidCommand exo-ui:Command_id "valid"^^xsd:string .
ex:ValidCommand exo-ui:Command_name "Valid Command"^^xsd:string .
ex:ValidCommand exo-ui:Command_action ex:SomeAction .

ex:SomeOtherThing rdf:type ex:NotACommand .
ex:SomeOtherThing ex:randomProperty "value" .
      `;

      const result = await validator.validate(mixedRdf, COMMAND_SHAPE_TURTLE);

      expect(result.conforms).toBe(true);
    });
  });
});

/**
 * SolutionMapping Contract Tests
 *
 * Consumer-driven contract tests for SPARQL solution mappings.
 * These tests verify the behavioral guarantees that the obsidian-plugin
 * depends on when working with query results.
 *
 * @see packages/core/contracts/SolutionMapping.contract.ts
 */

import { SolutionMapping } from "../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../src/domain/models/rdf/BlankNode";
import { SolutionMappingContract } from "../../contracts/SolutionMapping.contract";

describe("SolutionMapping Contract Tests", () => {
  describe(`Contract: ${SolutionMappingContract.name} v${SolutionMappingContract.version}`, () => {
    describe("Constructor", () => {
      it("creates empty solution mapping when no bindings provided", () => {
        const solution = new SolutionMapping();
        expect(solution.size()).toBe(0);
        expect(solution.variables()).toEqual([]);
      });

      it("creates solution mapping with initial bindings", () => {
        const bindings = new Map<string, IRI | Literal>();
        bindings.set("s", new IRI("http://example.org/subject"));
        bindings.set("name", new Literal("Test"));

        const solution = new SolutionMapping(bindings);
        expect(solution.size()).toBe(2);
        expect(solution.has("s")).toBe(true);
        expect(solution.has("name")).toBe(true);
      });
    });

    describe("get() method", () => {
      it("returns bound value for existing variable", () => {
        const solution = new SolutionMapping();
        const iri = new IRI("http://example.org/subject");
        solution.set("s", iri);

        expect(solution.get("s")).toBe(iri);
      });

      it("returns undefined for unbound variable", () => {
        const solution = new SolutionMapping();
        expect(solution.get("unbound")).toBeUndefined();
      });
    });

    describe("set() method", () => {
      it("binds variable to IRI value", () => {
        const solution = new SolutionMapping();
        const iri = new IRI("http://example.org/resource");
        solution.set("resource", iri);

        expect(solution.get("resource")).toBe(iri);
        expect(solution.has("resource")).toBe(true);
      });

      it("binds variable to Literal value", () => {
        const solution = new SolutionMapping();
        const literal = new Literal("test value");
        solution.set("value", literal);

        expect(solution.get("value")).toBe(literal);
      });

      it("binds variable to BlankNode value", () => {
        const solution = new SolutionMapping();
        const blank = new BlankNode("b1");
        solution.set("node", blank);

        expect(solution.get("node")).toBe(blank);
      });

      it("overwrites existing binding for same variable", () => {
        const solution = new SolutionMapping();
        const first = new Literal("first");
        const second = new Literal("second");

        solution.set("value", first);
        expect(solution.get("value")).toBe(first);

        solution.set("value", second);
        expect(solution.get("value")).toBe(second);
        expect(solution.size()).toBe(1);
      });
    });

    describe("has() method", () => {
      it("returns true for bound variables", () => {
        const solution = new SolutionMapping();
        solution.set("x", new IRI("http://example.org/x"));

        expect(solution.has("x")).toBe(true);
      });

      it("returns false for unbound variables", () => {
        const solution = new SolutionMapping();
        expect(solution.has("unbound")).toBe(false);
      });
    });

    describe("variables() method", () => {
      it("returns empty array for empty solution", () => {
        const solution = new SolutionMapping();
        expect(solution.variables()).toEqual([]);
      });

      it("returns all bound variable names", () => {
        const solution = new SolutionMapping();
        solution.set("a", new IRI("http://example.org/a"));
        solution.set("b", new Literal("b"));
        solution.set("c", new BlankNode("c"));

        const vars = solution.variables();
        expect(vars).toHaveLength(3);
        expect(vars).toContain("a");
        expect(vars).toContain("b");
        expect(vars).toContain("c");
      });
    });

    describe("size() method", () => {
      it("returns 0 for empty solution", () => {
        const solution = new SolutionMapping();
        expect(solution.size()).toBe(0);
      });

      it("accurately reflects number of bindings", () => {
        const solution = new SolutionMapping();
        expect(solution.size()).toBe(0);

        solution.set("a", new IRI("http://example.org/a"));
        expect(solution.size()).toBe(1);

        solution.set("b", new Literal("b"));
        expect(solution.size()).toBe(2);

        // Overwrite doesn't increase size
        solution.set("a", new IRI("http://example.org/a2"));
        expect(solution.size()).toBe(2);
      });
    });

    describe("clone() method", () => {
      it("creates independent copy", () => {
        const original = new SolutionMapping();
        original.set("x", new IRI("http://example.org/x"));

        const clone = original.clone();

        // Clone has same bindings
        expect(clone.get("x")).toBeDefined();
        expect(clone.size()).toBe(1);

        // Modifications to clone don't affect original
        clone.set("y", new Literal("y"));
        expect(clone.size()).toBe(2);
        expect(original.size()).toBe(1);
        expect(original.has("y")).toBe(false);
      });

      it("preserves all variable bindings", () => {
        const original = new SolutionMapping();
        original.set("s", new IRI("http://example.org/s"));
        original.set("p", new IRI("http://example.org/p"));
        original.set("o", new Literal("value"));

        const clone = original.clone();

        expect(clone.variables()).toHaveLength(3);
        expect(clone.has("s")).toBe(true);
        expect(clone.has("p")).toBe(true);
        expect(clone.has("o")).toBe(true);
      });
    });

    describe("merge() method", () => {
      it("combines all bindings from both solutions", () => {
        const sol1 = new SolutionMapping();
        sol1.set("a", new IRI("http://example.org/a"));

        const sol2 = new SolutionMapping();
        sol2.set("b", new Literal("b"));

        const merged = sol1.merge(sol2);

        expect(merged).not.toBeNull();
        expect(merged!.size()).toBe(2);
        expect(merged!.has("a")).toBe(true);
        expect(merged!.has("b")).toBe(true);
      });

      it("returns null if solutions are incompatible", () => {
        const sol1 = new SolutionMapping();
        sol1.set("x", new IRI("http://example.org/value1"));

        const sol2 = new SolutionMapping();
        sol2.set("x", new IRI("http://example.org/value2"));

        const merged = sol1.merge(sol2);
        expect(merged).toBeNull();
      });

      it("succeeds when shared variables have equal values", () => {
        const iri = new IRI("http://example.org/same");

        const sol1 = new SolutionMapping();
        sol1.set("x", iri);
        sol1.set("a", new Literal("a"));

        const sol2 = new SolutionMapping();
        sol2.set("x", new IRI("http://example.org/same")); // Same value
        sol2.set("b", new Literal("b"));

        const merged = sol1.merge(sol2);

        expect(merged).not.toBeNull();
        expect(merged!.size()).toBe(3);
      });
    });

    describe("isCompatibleWith() method", () => {
      it("returns true for empty solutions", () => {
        const sol1 = new SolutionMapping();
        const sol2 = new SolutionMapping();

        expect(sol1.isCompatibleWith(sol2)).toBe(true);
        expect(sol2.isCompatibleWith(sol1)).toBe(true);
      });

      it("returns true for non-overlapping variables", () => {
        const sol1 = new SolutionMapping();
        sol1.set("a", new IRI("http://example.org/a"));

        const sol2 = new SolutionMapping();
        sol2.set("b", new Literal("b"));

        expect(sol1.isCompatibleWith(sol2)).toBe(true);
      });

      it("returns true when shared variables have equal values", () => {
        const sol1 = new SolutionMapping();
        sol1.set("x", new Literal("same"));

        const sol2 = new SolutionMapping();
        sol2.set("x", new Literal("same"));

        expect(sol1.isCompatibleWith(sol2)).toBe(true);
      });

      it("returns false when shared variables have different values", () => {
        const sol1 = new SolutionMapping();
        sol1.set("x", new Literal("value1"));

        const sol2 = new SolutionMapping();
        sol2.set("x", new Literal("value2"));

        expect(sol1.isCompatibleWith(sol2)).toBe(false);
      });

      it("compares IRIs by value", () => {
        const sol1 = new SolutionMapping();
        sol1.set("x", new IRI("http://example.org/same"));

        const sol2 = new SolutionMapping();
        sol2.set("x", new IRI("http://example.org/same"));

        expect(sol1.isCompatibleWith(sol2)).toBe(true);
      });

      it("compares Literals by value and datatype", () => {
        const sol1 = new SolutionMapping();
        sol1.set("x", new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#integer")));

        const sol2 = new SolutionMapping();
        sol2.set("x", new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#integer")));

        expect(sol1.isCompatibleWith(sol2)).toBe(true);

        // Different datatype = incompatible
        const sol3 = new SolutionMapping();
        sol3.set("x", new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#string")));

        expect(sol1.isCompatibleWith(sol3)).toBe(false);
      });
    });

    describe("toJSON() method", () => {
      it("produces Record with variable names as keys", () => {
        const solution = new SolutionMapping();
        solution.set("s", new IRI("http://example.org/subject"));
        solution.set("name", new Literal("Test"));

        const json = solution.toJSON();

        expect(typeof json).toBe("object");
        expect("s" in json).toBe(true);
        expect("name" in json).toBe(true);
      });

      it("converts RDF terms to string representations", () => {
        const solution = new SolutionMapping();
        solution.set("iri", new IRI("http://example.org/resource"));
        solution.set("literal", new Literal("text value"));
        solution.set("blank", new BlankNode("b1"));

        const json = solution.toJSON();

        expect(typeof json.iri).toBe("string");
        expect(typeof json.literal).toBe("string");
        expect(typeof json.blank).toBe("string");
      });

      it("returns empty object for empty solution", () => {
        const solution = new SolutionMapping();
        const json = solution.toJSON();

        expect(json).toEqual({});
      });
    });

    describe("getBindings() method", () => {
      it("returns a copy of bindings Map", () => {
        const solution = new SolutionMapping();
        solution.set("x", new IRI("http://example.org/x"));

        const bindings = solution.getBindings();

        expect(bindings instanceof Map).toBe(true);
        expect(bindings.size).toBe(1);
        expect(bindings.has("x")).toBe(true);

        // Modifying returned map doesn't affect original
        bindings.set("y", new Literal("y"));
        expect(solution.has("y")).toBe(false);
      });
    });

    describe("Behavioral guarantees", () => {
      it("handles typed literals correctly", () => {
        const solution = new SolutionMapping();
        const intLiteral = new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#integer"));
        const dateLiteral = new Literal("2025-01-15", new IRI("http://www.w3.org/2001/XMLSchema#date"));

        solution.set("count", intLiteral);
        solution.set("date", dateLiteral);

        expect(solution.size()).toBe(2);
        expect(solution.get("count")).toBe(intLiteral);
        expect(solution.get("date")).toBe(dateLiteral);
      });

      it("handles language-tagged literals", () => {
        const solution = new SolutionMapping();
        const enLabel = new Literal("Hello", undefined, "en");
        const esLabel = new Literal("Hola", undefined, "es");

        solution.set("labelEn", enLabel);
        solution.set("labelEs", esLabel);

        expect(solution.size()).toBe(2);
      });

      it("preserves variable binding order in variables()", () => {
        const solution = new SolutionMapping();
        solution.set("first", new Literal("1"));
        solution.set("second", new Literal("2"));
        solution.set("third", new Literal("3"));

        const vars = solution.variables();

        // Map iteration order is insertion order in ES6+
        expect(vars[0]).toBe("first");
        expect(vars[1]).toBe("second");
        expect(vars[2]).toBe("third");
      });
    });
  });
});

/**
 * Pure-helper unit tests for the `convert` subcommand.
 *
 * These tests intentionally do NOT mock the `exocortex` package — they exercise
 * `resolveClassIri` and `filterByClass` against real `IRI`/`Triple`/`Namespace`
 * to give the convert command's branch logic real coverage (the Commander
 * action handler is harder to drive without spawning the CLI binary, which the
 * integration tests already cover but at the cost of zero in-process coverage).
 */
import { describe, it, expect } from "@jest/globals";
import { IRI, Literal, Namespace, Triple } from "exocortex";
import {
  resolveClassIri,
  filterByClass,
  RDF_TYPE_IRI,
  KNOWN_NAMESPACES,
} from "../../../src/commands/convert.js";
import { InvalidArgumentsError } from "../../../src/utils/errors/index.js";

describe("convert helpers — resolveClassIri", () => {
  it("expands shorthand `ems__Task` to a full IRI", () => {
    const iri = resolveClassIri("ems__Task");
    expect(iri.value).toBe("https://exocortex.my/ontology/ems#Task");
  });

  it("expands shorthand for ims namespace", () => {
    const iri = resolveClassIri("ims__Concept");
    expect(iri.value).toBe("https://exocortex.my/ontology/ims#Concept");
  });

  it("expands prefixed `ems:Task` form", () => {
    const iri = resolveClassIri("ems:Task");
    expect(iri.value).toBe("https://exocortex.my/ontology/ems#Task");
  });

  it("passes through full https:// IRIs unchanged", () => {
    const iri = resolveClassIri("https://example.org/MyClass");
    expect(iri.value).toBe("https://example.org/MyClass");
  });

  it("passes through full http:// IRIs unchanged", () => {
    const iri = resolveClassIri("http://example.org/Class");
    expect(iri.value).toBe("http://example.org/Class");
  });

  it("trims surrounding whitespace before resolving", () => {
    const iri = resolveClassIri("  ems__Task  ");
    expect(iri.value).toBe("https://exocortex.my/ontology/ems#Task");
  });

  it("throws InvalidArgumentsError for unknown shorthand prefix", () => {
    expect(() => resolveClassIri("zzz__Foo")).toThrow(InvalidArgumentsError);
  });

  it("throws InvalidArgumentsError for unknown prefixed form", () => {
    expect(() => resolveClassIri("zzz:Foo")).toThrow(InvalidArgumentsError);
  });

  it("throws InvalidArgumentsError for free-form non-IRI strings", () => {
    expect(() => resolveClassIri("Just A Label")).toThrow(InvalidArgumentsError);
  });

  it("throws InvalidArgumentsError for empty input", () => {
    expect(() => resolveClassIri("")).toThrow(InvalidArgumentsError);
  });
});

describe("convert helpers — filterByClass", () => {
  const taskClassIri = new IRI("https://exocortex.my/ontology/ems#Task");
  const conceptClassIri = new IRI("https://exocortex.my/ontology/ims#Concept");

  const taskSubject = new IRI("obsidian://vault/task1.md");
  const conceptSubject = new IRI("obsidian://vault/concept1.md");
  const labelPredicate = new IRI("https://exocortex.my/ontology/exo#Asset_label");

  const taskTypeTriple = new Triple(taskSubject, RDF_TYPE_IRI, taskClassIri);
  const taskLabelTriple = new Triple(
    taskSubject,
    labelPredicate,
    new Literal("Task A"),
  );
  const conceptTypeTriple = new Triple(
    conceptSubject,
    RDF_TYPE_IRI,
    conceptClassIri,
  );
  const conceptLabelTriple = new Triple(
    conceptSubject,
    labelPredicate,
    new Literal("Concept B"),
  );

  it("keeps only triples whose subject is an instance of the given class", () => {
    const all = [
      taskTypeTriple,
      taskLabelTriple,
      conceptTypeTriple,
      conceptLabelTriple,
    ];
    const filtered = filterByClass(all, taskClassIri);
    expect(filtered).toHaveLength(2);
    expect(filtered).toEqual(expect.arrayContaining([taskTypeTriple, taskLabelTriple]));
    expect(filtered).not.toEqual(expect.arrayContaining([conceptTypeTriple]));
  });

  it("returns an empty array when no subject has the given rdf:type", () => {
    const all = [taskTypeTriple, taskLabelTriple];
    const filtered = filterByClass(all, conceptClassIri);
    expect(filtered).toEqual([]);
  });

  it("ignores rdf:type triples whose object is a Literal (not an IRI)", () => {
    const weirdTriple = new Triple(
      taskSubject,
      RDF_TYPE_IRI,
      new Literal("not-a-class"),
    );
    const filtered = filterByClass([weirdTriple], taskClassIri);
    expect(filtered).toEqual([]);
  });

  it("returns an empty array when given an empty triple list", () => {
    expect(filterByClass([], taskClassIri)).toEqual([]);
  });
});

describe("convert helpers — module wiring", () => {
  it("RDF_TYPE_IRI points to the canonical rdf:type IRI", () => {
    expect(RDF_TYPE_IRI.value).toBe(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    );
  });

  it("KNOWN_NAMESPACES includes the standard Exocortex prefixes", () => {
    const prefixes = KNOWN_NAMESPACES.map((ns) => ns.prefix);
    for (const expected of [
      "rdf",
      "rdfs",
      "owl",
      "xsd",
      "exo",
      "ems",
      "ims",
    ]) {
      expect(prefixes).toContain(expected);
    }
  });

  it("Namespace.EMS roundtrips through KNOWN_NAMESPACES", () => {
    const ems = KNOWN_NAMESPACES.find((ns) => ns.prefix === "ems");
    expect(ems).toBeDefined();
    expect(ems!.iri.value).toBe(Namespace.EMS.iri.value);
  });
});

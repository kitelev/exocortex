/**
 * Shared test utilities for SPARQL compliance tests
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../src/domain/models/rdf/BlankNode";
import { Triple } from "../../../src/domain/models/rdf/Triple";

// Re-export for convenience
export { InMemoryTripleStore, QueryExecutor, IRI, Literal, BlankNode, Triple };

/**
 * Common prefixes used in tests
 */
export const PREFIXES: Record<string, string> = {
  foaf: "http://xmlns.com/foaf/0.1/",
  ex: "http://example.org/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
};

/**
 * Build PREFIX declarations for SPARQL queries
 */
export function buildPrefixes(...prefixNames: string[]): string {
  return prefixNames
    .map((name) => `PREFIX ${name}: <${PREFIXES[name]}>`)
    .join("\n");
}

/**
 * Create IRI helper
 */
export function iri(value: string): IRI {
  return new IRI(value);
}

/**
 * Create Literal helper
 */
export function literal(
  value: string,
  datatypeOrLang?: string,
  isLangTag = false
): Literal {
  if (isLangTag && datatypeOrLang) {
    return new Literal(value, undefined, datatypeOrLang);
  }
  return new Literal(value, datatypeOrLang ? new IRI(datatypeOrLang) : undefined);
}

/**
 * Create BlankNode helper
 */
export function bnode(id: string): BlankNode {
  return new BlankNode(id);
}

/**
 * Create Triple helper
 */
export function triple(
  subject: IRI | BlankNode,
  predicate: IRI,
  object: IRI | Literal | BlankNode
): Triple {
  return new Triple(subject, predicate, object);
}

/**
 * XSD typed literal helpers
 */
export const xsd = {
  integer: (value: number): Literal =>
    new Literal(String(value), new IRI(PREFIXES.xsd + "integer")),
  decimal: (value: string): Literal =>
    new Literal(value, new IRI(PREFIXES.xsd + "decimal")),
  double: (value: number): Literal =>
    new Literal(String(value), new IRI(PREFIXES.xsd + "double")),
  boolean: (value: boolean): Literal =>
    new Literal(String(value), new IRI(PREFIXES.xsd + "boolean")),
  string: (value: string): Literal =>
    new Literal(value, new IRI(PREFIXES.xsd + "string")),
  dateTime: (value: string): Literal =>
    new Literal(value, new IRI(PREFIXES.xsd + "dateTime")),
  date: (value: string): Literal =>
    new Literal(value, new IRI(PREFIXES.xsd + "date")),
};

/**
 * Test environment with all SPARQL components
 */
export interface TestEnvironment {
  store: InMemoryTripleStore;
  executor: QueryExecutor;
  parser: SPARQLParser;
  translator: AlgebraTranslator;
}

/**
 * Create test environment with store and executor
 */
export function createTestEnvironment(): TestEnvironment {
  const store = new InMemoryTripleStore();
  const executor = new QueryExecutor(store);
  const parser = new SPARQLParser();
  const translator = new AlgebraTranslator();
  return { store, executor, parser, translator };
}

/**
 * Load test data into store
 */
export async function loadTestData(
  store: InMemoryTripleStore,
  triples: Triple[]
): Promise<void> {
  for (const t of triples) {
    await store.add(t);
  }
}

/**
 * Extract native JavaScript value from RDF term
 */
function extractValue(term: IRI | Literal | BlankNode): unknown {
  if (term instanceof Literal) {
    const value = term.value;
    const datatype = term.datatype?.value;

    if (datatype) {
      if (datatype.includes("integer") || datatype.includes("int") ||
          datatype.includes("decimal") || datatype.includes("double") ||
          datatype.includes("float")) {
        return parseFloat(value);
      }
      if (datatype.includes("boolean")) {
        return value === "true";
      }
    }
    return value;
  }

  if (term instanceof IRI) {
    return term.value;
  }

  if (term instanceof BlankNode) {
    return `_:${term.id}`;
  }

  return String(term);
}

/**
 * Execute SELECT/ASK query and convert results to JSON for easier assertions
 */
export async function executeQuery(
  executor: QueryExecutor,
  query: string
): Promise<Record<string, unknown>[]> {
  const parser = new SPARQLParser();
  const translator = new AlgebraTranslator();

  const parsed = parser.parse(query);
  const algebra = translator.translate(parsed);
  const results: Record<string, unknown>[] = [];

  for await (const solution of executor.execute(algebra)) {
    const obj: Record<string, unknown> = {};
    for (const variable of solution.variables()) {
      const term = solution.get(variable);
      if (term) {
        obj[variable] = extractValue(term as IRI | Literal | BlankNode);
      }
    }
    results.push(obj);
  }

  return results;
}

/**
 * Execute CONSTRUCT/DESCRIBE query and return triples
 */
export async function executeConstructQuery(
  executor: QueryExecutor,
  query: string
): Promise<Triple[]> {
  const parser = new SPARQLParser();
  const translator = new AlgebraTranslator();

  const parsed = parser.parse(query);
  const algebra = translator.translate(parsed);
  const triples: Triple[] = [];

  for await (const solution of executor.execute(algebra)) {
    const subject = solution.get("s") || solution.get("subject");
    const predicate = solution.get("p") || solution.get("predicate");
    const object = solution.get("o") || solution.get("object");

    if (subject && predicate && object) {
      triples.push(new Triple(
        subject as IRI | BlankNode,
        predicate as IRI,
        object as IRI | Literal | BlankNode
      ));
    }
  }

  return triples;
}

/**
 * Standard test data sets
 */
export const TEST_DATA = {
  foafPersons: (): Triple[] => {
    const foaf = PREFIXES.foaf;
    const ex = PREFIXES.ex;
    return [
      triple(iri(`${ex}alice`), iri(`${foaf}name`), literal("Alice")),
      triple(iri(`${ex}alice`), iri(`${foaf}age`), xsd.integer(30)),
      triple(iri(`${ex}alice`), iri(`${foaf}mbox`), iri("mailto:alice@example.org")),
      triple(iri(`${ex}alice`), iri(`${foaf}knows`), iri(`${ex}bob`)),
      triple(iri(`${ex}bob`), iri(`${foaf}name`), literal("Bob")),
      triple(iri(`${ex}bob`), iri(`${foaf}age`), xsd.integer(25)),
      triple(iri(`${ex}bob`), iri(`${foaf}knows`), iri(`${ex}charlie`)),
      triple(iri(`${ex}charlie`), iri(`${foaf}name`), literal("Charlie")),
      triple(iri(`${ex}charlie`), iri(`${foaf}age`), xsd.integer(35)),
    ];
  },

  hierarchy: (): Triple[] => {
    const ex = PREFIXES.ex;
    const rdfs = PREFIXES.rdfs;
    return [
      triple(iri(`${ex}Dog`), iri(`${rdfs}subClassOf`), iri(`${ex}Animal`)),
      triple(iri(`${ex}Cat`), iri(`${rdfs}subClassOf`), iri(`${ex}Animal`)),
      triple(iri(`${ex}Mammal`), iri(`${rdfs}subClassOf`), iri(`${ex}Animal`)),
      triple(iri(`${ex}Dog`), iri(`${rdfs}subClassOf`), iri(`${ex}Mammal`)),
      triple(iri(`${ex}Cat`), iri(`${rdfs}subClassOf`), iri(`${ex}Mammal`)),
      triple(iri(`${ex}wheel`), iri(`${ex}partOf`), iri(`${ex}car`)),
      triple(iri(`${ex}engine`), iri(`${ex}partOf`), iri(`${ex}car`)),
      triple(iri(`${ex}piston`), iri(`${ex}partOf`), iri(`${ex}engine`)),
    ];
  },

  numericData: (): Triple[] => {
    const ex = PREFIXES.ex;
    return [
      triple(iri(`${ex}item1`), iri(`${ex}value`), xsd.integer(10)),
      triple(iri(`${ex}item1`), iri(`${ex}category`), literal("A")),
      triple(iri(`${ex}item2`), iri(`${ex}value`), xsd.integer(20)),
      triple(iri(`${ex}item2`), iri(`${ex}category`), literal("A")),
      triple(iri(`${ex}item3`), iri(`${ex}value`), xsd.integer(30)),
      triple(iri(`${ex}item3`), iri(`${ex}category`), literal("B")),
      triple(iri(`${ex}item4`), iri(`${ex}value`), xsd.integer(40)),
      triple(iri(`${ex}item4`), iri(`${ex}category`), literal("B")),
      triple(iri(`${ex}item5`), iri(`${ex}value`), xsd.integer(50)),
      triple(iri(`${ex}item5`), iri(`${ex}category`), literal("B")),
    ];
  },

  stringData: (): Triple[] => {
    const ex = PREFIXES.ex;
    return [
      triple(iri(`${ex}doc1`), iri(`${ex}title`), literal("Hello World")),
      triple(iri(`${ex}doc1`), iri(`${ex}lang`), literal("Bonjour", "fr", true)),
      triple(iri(`${ex}doc2`), iri(`${ex}title`), literal("SPARQL Tutorial")),
      triple(iri(`${ex}doc2`), iri(`${ex}content`), literal("Learn SPARQL")),
    ];
  },

  dateTimeData: (): Triple[] => {
    const ex = PREFIXES.ex;
    return [
      triple(iri(`${ex}event1`), iri(`${ex}date`), xsd.dateTime("2024-01-15T10:30:00Z")),
      triple(iri(`${ex}event2`), iri(`${ex}date`), xsd.dateTime("2024-06-20T14:00:00Z")),
      triple(iri(`${ex}event3`), iri(`${ex}date`), xsd.dateTime("2024-12-25T00:00:00Z")),
    ];
  },
};

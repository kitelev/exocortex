/**
 * ITripleStore Contract
 *
 * Defines the expected behaviors of RDF triple store implementations.
 * The obsidian-plugin relies on this for:
 * - Storing RDF triples from vault notes
 * - Pattern matching for SPARQL BGP execution
 * - Transaction support for atomic updates
 */

export interface TripleStoreContractMethod {
  description: string;
  inputTypes: string[];
  outputType: string;
  mustNotThrow?: string[];
  mayThrow?: string[];
  isAsync: boolean;
}

export interface TripleStoreContract {
  name: "ITripleStore";
  version: "1.0.0";

  methods: {
    add: TripleStoreContractMethod;
    remove: TripleStoreContractMethod;
    has: TripleStoreContractMethod;
    match: TripleStoreContractMethod;
    addAll: TripleStoreContractMethod;
    removeAll: TripleStoreContractMethod;
    clear: TripleStoreContractMethod;
    count: TripleStoreContractMethod;
    subjects: TripleStoreContractMethod;
    predicates: TripleStoreContractMethod;
    objects: TripleStoreContractMethod;
    beginTransaction: TripleStoreContractMethod;
  };

  optionalMethods: {
    findSubjectsByUUID: TripleStoreContractMethod;
    findSubjectsByUUIDSync: TripleStoreContractMethod;
    addToGraph: TripleStoreContractMethod;
    removeFromGraph: TripleStoreContractMethod;
    matchInGraph: TripleStoreContractMethod;
    getNamedGraphs: TripleStoreContractMethod;
    hasGraph: TripleStoreContractMethod;
    clearGraph: TripleStoreContractMethod;
    countInGraph: TripleStoreContractMethod;
  };

  behaviors: string[];
}

export const TripleStoreContract: TripleStoreContract = {
  name: "ITripleStore",
  version: "1.0.0",

  methods: {
    add: {
      description: "Add a triple to the store",
      inputTypes: ["Triple"],
      outputType: "Promise<void>",
      mustNotThrow: ["valid triple with IRI subject, predicate, and any object"],
      isAsync: true,
    },

    remove: {
      description: "Remove a triple from the store",
      inputTypes: ["Triple"],
      outputType: "Promise<boolean>",
      mustNotThrow: ["any triple (returns false if not found)"],
      isAsync: true,
    },

    has: {
      description: "Check if a triple exists in the store",
      inputTypes: ["Triple"],
      outputType: "Promise<boolean>",
      mustNotThrow: ["any valid triple"],
      isAsync: true,
    },

    match: {
      description: "Find triples matching a pattern",
      inputTypes: ["Subject?", "Predicate?", "Object?"],
      outputType: "Promise<Triple[]>",
      mustNotThrow: [
        "all parameters undefined (returns all triples)",
        "subject only specified",
        "predicate only specified",
        "object only specified",
        "all parameters specified",
      ],
      isAsync: true,
    },

    addAll: {
      description: "Add multiple triples atomically",
      inputTypes: ["Triple[]"],
      outputType: "Promise<void>",
      mustNotThrow: ["empty array", "array of valid triples"],
      isAsync: true,
    },

    removeAll: {
      description: "Remove multiple triples atomically",
      inputTypes: ["Triple[]"],
      outputType: "Promise<number>",
      mustNotThrow: ["empty array", "array containing non-existent triples"],
      isAsync: true,
    },

    clear: {
      description: "Remove all triples from the store",
      inputTypes: [],
      outputType: "Promise<void>",
      mustNotThrow: ["called on empty store", "called on non-empty store"],
      isAsync: true,
    },

    count: {
      description: "Get the number of triples in the store",
      inputTypes: [],
      outputType: "Promise<number>",
      mustNotThrow: ["always"],
      isAsync: true,
    },

    subjects: {
      description: "Get all unique subjects",
      inputTypes: [],
      outputType: "Promise<Subject[]>",
      mustNotThrow: ["always"],
      isAsync: true,
    },

    predicates: {
      description: "Get all unique predicates",
      inputTypes: [],
      outputType: "Promise<Predicate[]>",
      mustNotThrow: ["always"],
      isAsync: true,
    },

    objects: {
      description: "Get all unique objects",
      inputTypes: [],
      outputType: "Promise<Object[]>",
      mustNotThrow: ["always"],
      isAsync: true,
    },

    beginTransaction: {
      description: "Begin a new transaction",
      inputTypes: [],
      outputType: "Promise<ITransaction>",
      mustNotThrow: ["always"],
      isAsync: true,
    },
  },

  optionalMethods: {
    findSubjectsByUUID: {
      description: "Find subjects containing a UUID (async)",
      inputTypes: ["string"],
      outputType: "Promise<Subject[]>",
      mustNotThrow: ["any string"],
      isAsync: true,
    },

    findSubjectsByUUIDSync: {
      description: "Find subjects containing a UUID (sync)",
      inputTypes: ["string"],
      outputType: "Subject[]",
      mustNotThrow: ["any string"],
      isAsync: false,
    },

    addToGraph: {
      description: "Add triple to a named graph",
      inputTypes: ["Triple", "GraphName"],
      outputType: "Promise<void>",
      isAsync: true,
    },

    removeFromGraph: {
      description: "Remove triple from a named graph",
      inputTypes: ["Triple", "GraphName"],
      outputType: "Promise<boolean>",
      isAsync: true,
    },

    matchInGraph: {
      description: "Match triples in a specific graph",
      inputTypes: ["Subject?", "Predicate?", "Object?", "GraphName?"],
      outputType: "Promise<Triple[]>",
      isAsync: true,
    },

    getNamedGraphs: {
      description: "Get all named graph IRIs",
      inputTypes: [],
      outputType: "Promise<IRI[]>",
      isAsync: true,
    },

    hasGraph: {
      description: "Check if a named graph exists",
      inputTypes: ["IRI"],
      outputType: "Promise<boolean>",
      isAsync: true,
    },

    clearGraph: {
      description: "Clear all triples from a graph",
      inputTypes: ["GraphName"],
      outputType: "Promise<void>",
      isAsync: true,
    },

    countInGraph: {
      description: "Count triples in a graph",
      inputTypes: ["GraphName"],
      outputType: "Promise<number>",
      isAsync: true,
    },
  },

  behaviors: [
    "add() creates a new triple if it doesn't exist",
    "add() is idempotent (adding same triple twice has no effect)",
    "remove() returns true if triple was removed, false if not found",
    "has() returns true only for exact triple match",
    "match() returns empty array for no matches",
    "match() with all undefined parameters returns all triples",
    "match() filters are AND-combined (all must match)",
    "addAll() and removeAll() are atomic operations",
    "clear() results in count() returning 0",
    "count() accurately reflects number of unique triples",
    "subjects/predicates/objects return unique values only",
    "Transaction commit() persists all changes atomically",
    "Transaction rollback() discards all changes",
    "findSubjectsByUUID performs case-insensitive UUID search",
    "Named graph operations isolate triples by graph context",
  ],
};

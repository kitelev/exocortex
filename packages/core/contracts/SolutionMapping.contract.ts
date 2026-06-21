/**
 * SolutionMapping Contract
 *
 * Defines the expected behaviors of SPARQL solution mappings.
 * The obsidian-plugin relies on this for:
 * - Accessing query result bindings
 * - Merging solution mappings during joins
 * - Converting results to displayable formats
 */

export interface SolutionMappingContractMethod {
  description: string;
  inputTypes: string[];
  outputType: string;
  mustNotThrow?: string[];
}

export interface SolutionMappingContract {
  name: "SolutionMapping";
  version: "1.0.0";

  constructorSpec: {
    description: string;
    inputTypes: string[];
  };

  methods: {
    get: SolutionMappingContractMethod;
    set: SolutionMappingContractMethod;
    has: SolutionMappingContractMethod;
    delete: SolutionMappingContractMethod;
    variables: SolutionMappingContractMethod;
    size: SolutionMappingContractMethod;
    clone: SolutionMappingContractMethod;
    merge: SolutionMappingContractMethod;
    isCompatibleWith: SolutionMappingContractMethod;
    toJSON: SolutionMappingContractMethod;
    entries: SolutionMappingContractMethod;
  };

  behaviors: string[];
}

export const SolutionMappingContract: SolutionMappingContract = {
  name: "SolutionMapping",
  version: "1.0.0",

  constructorSpec: {
    description: "Create a new solution mapping with optional initial bindings",
    inputTypes: ["Map<string, RDFTerm>?"],
  },

  methods: {
    get: {
      description: "Get the value bound to a variable",
      inputTypes: ["string"],
      outputType: "RDFTerm | undefined",
      mustNotThrow: ["any variable name"],
    },

    set: {
      description: "Bind a variable to a value",
      inputTypes: ["string", "RDFTerm"],
      outputType: "void",
      mustNotThrow: ["any variable name and RDF term"],
    },

    has: {
      description: "Check if a variable is bound",
      inputTypes: ["string"],
      outputType: "boolean",
      mustNotThrow: ["any variable name"],
    },

    delete: {
      description: "Remove a variable binding",
      inputTypes: ["string"],
      outputType: "boolean",
      mustNotThrow: ["any variable name"],
    },

    variables: {
      description: "Get all bound variable names",
      inputTypes: [],
      outputType: "string[]",
      mustNotThrow: ["always"],
    },

    size: {
      description: "Get the number of bindings",
      inputTypes: [],
      outputType: "number",
      mustNotThrow: ["always"],
    },

    clone: {
      description: "Create a deep copy of this solution",
      inputTypes: [],
      outputType: "SolutionMapping",
      mustNotThrow: ["always"],
    },

    merge: {
      description: "Merge with another solution if compatible",
      inputTypes: ["SolutionMapping"],
      outputType: "SolutionMapping | null",
      mustNotThrow: ["any solution mapping"],
    },

    isCompatibleWith: {
      description: "Check if two solutions can be merged",
      inputTypes: ["SolutionMapping"],
      outputType: "boolean",
      mustNotThrow: ["any solution mapping"],
    },

    toJSON: {
      description: "Convert to plain object for serialization",
      inputTypes: [],
      outputType: "Record<string, string>",
      mustNotThrow: ["always"],
    },

    entries: {
      description: "Get iterator of [variable, term] pairs",
      inputTypes: [],
      outputType: "IterableIterator<[string, RDFTerm]>",
      mustNotThrow: ["always"],
    },
  },

  behaviors: [
    "Empty solution mapping has size 0",
    "get() returns undefined for unbound variables",
    "set() overwrites existing binding for same variable",
    "has() returns true only for bound variables",
    "delete() returns true if variable was bound, false otherwise",
    "variables() returns empty array for empty solution",
    "clone() creates independent copy (mutations don't affect original)",
    "merge() returns null if solutions are incompatible",
    "merge() combines all bindings from both solutions",
    "isCompatibleWith() returns true for empty solutions",
    "isCompatibleWith() returns true when shared variables have equal values",
    "isCompatibleWith() returns false when shared variables have different values",
    "toJSON() produces Record with variable names as keys",
    "toJSON() converts RDF terms to string representations",
    "entries() yields all variable bindings in iteration order",
    "Solution mapping is iterable via for...of",
  ],
};

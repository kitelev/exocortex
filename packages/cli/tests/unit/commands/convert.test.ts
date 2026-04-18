import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";

// Mock exocortex package
class FakeIRI {
  constructor(public readonly value: string) {}
  equals(other: FakeIRI): boolean {
    return other instanceof FakeIRI && this.value === other.value;
  }
  toString(): string {
    return `<${this.value}>`;
  }
}

class FakeNamespace {
  constructor(public readonly prefix: string, private readonly base: string) {}
  get iri(): FakeIRI {
    return new FakeIRI(this.base);
  }
  term(local: string): FakeIRI {
    return new FakeIRI(`${this.base}${local}`);
  }
}

const FakeNamespaceStatics = {
  RDF: new FakeNamespace("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"),
  RDFS: new FakeNamespace("rdfs", "http://www.w3.org/2000/01/rdf-schema#"),
  OWL: new FakeNamespace("owl", "http://www.w3.org/2002/07/owl#"),
  XSD: new FakeNamespace("xsd", "http://www.w3.org/2001/XMLSchema#"),
  EXO: new FakeNamespace("exo", "https://exocortex.my/ontology/exo#"),
  EMS: new FakeNamespace("ems", "https://exocortex.my/ontology/ems#"),
  EXOCMD: new FakeNamespace("exocmd", "https://exocortex.my/ontology/exocmd#"),
  IMS: new FakeNamespace("ims", "https://exocortex.my/ontology/ims#"),
  ZTLK: new FakeNamespace("ztlk", "https://exocortex.my/ontology/ztlk#"),
  PTMS: new FakeNamespace("ptms", "https://exocortex.my/ontology/ptms#"),
  LIT: new FakeNamespace("lit", "https://exocortex.my/ontology/lit#"),
  INBOX: new FakeNamespace("inbox", "https://exocortex.my/ontology/inbox#"),
};

jest.unstable_mockModule("exocortex", () => ({
  InMemoryTripleStore: jest.fn(() => ({
    addAll: jest.fn(),
    match: jest.fn().mockResolvedValue([]),
  })),
  NoteToRDFConverter: jest.fn(() => ({
    convertVault: jest.fn().mockResolvedValue([]),
  })),
  RDFSerializer: jest.fn(() => ({
    serializeTriples: jest.fn().mockReturnValue(""),
    serialize: jest.fn().mockResolvedValue(""),
  })),
  IRI: FakeIRI,
  Namespace: Object.assign(FakeNamespace, FakeNamespaceStatics),
  Literal: jest.fn(),
  BlankNode: jest.fn(),
  Triple: jest.fn(),
}));

jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(),
}));

const { convertCommand } = await import("../../../src/commands/convert.js");

describe("convertCommand", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let existsSyncSpy: jest.SpiedFunction<typeof fs.existsSync>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as never);
    existsSyncSpy = jest.spyOn(fs, "existsSync");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("command setup", () => {
    it("has name 'convert'", () => {
      expect(convertCommand().name()).toBe("convert");
    });

    it("description mentions RDF dump", () => {
      expect(convertCommand().description()).toMatch(/dump|rdf|turtle/i);
    });

    it("has --format option with default 'turtle'", () => {
      const opt = convertCommand().options.find((o) => o.flags.includes("--format"));
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe("turtle");
    });

    it("has --out option", () => {
      const opt = convertCommand().options.find((o) => o.flags.includes("--out"));
      expect(opt).toBeDefined();
    });

    it("has --filter option", () => {
      const opt = convertCommand().options.find((o) => o.flags.includes("--filter"));
      expect(opt).toBeDefined();
    });

    it("has --vault option", () => {
      const opt = convertCommand().options.find((o) => o.flags.includes("--vault"));
      expect(opt).toBeDefined();
    });
  });

  describe("argument validation", () => {
    it("errors when vault does not exist", async () => {
      existsSyncSpy.mockReturnValue(false);

      await convertCommand().parseAsync([
        "node",
        "test",
        "--vault",
        "/missing/vault",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalled();
    });

    it("rejects unknown format", async () => {
      existsSyncSpy.mockReturnValue(true);

      await convertCommand().parseAsync([
        "node",
        "test",
        "--vault",
        "/test/vault",
        "--format",
        "xml",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalled();
    });
  });
});

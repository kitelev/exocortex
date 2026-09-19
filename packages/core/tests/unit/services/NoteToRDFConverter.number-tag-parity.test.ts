import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { RDFSerializer } from "../../../src/infrastructure/rdf/RDFSerializer";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

/**
 * Number-tag parity between the two paths a JS number enters the graph
 * (ticket d5ad5217, founder decision 2026-09-19 «Паритет: целое → xsd:integer,
 * дробное → xsd:decimal в обоих путях»).
 *
 * Requirement: @req:d553b1a4-c312-4819-964d-fe6dae0a50e1
 *
 * Path 1 — frontmatter: NoteToRDFConverter.valueToRDFObject (YAML number).
 * Path 2 — JSON-LD document: RDFSerializer.collectTriplesForValue (native JSON
 * number). Before this ticket path 1 tagged EVERY number xsd:decimal while
 * path 2 already split integer / decimal, so `"3"^^xsd:decimal` and
 * `"3"^^xsd:integer` described the same value depending on the entry point.
 *
 * P1 is the pair axis: one whole number through BOTH paths → ONE tag, and that
 * tag is xsd:integer (RED on aaadac12: converter gave xsd:decimal).
 * P2 is the fractional control: both paths keep xsd:decimal (GREEN before and
 * after — it pins the branch the change must NOT touch).
 */
const XSD = "http://www.w3.org/2001/XMLSchema#";
const EMS = "https://exocortex.my/ontology/ems#";
const REQ = "@req:d553b1a4-c312-4819-964d-fe6dae0a50e1";

describe(`NoteToRDFConverter ↔ RDFSerializer number-tag parity (d5ad5217) ${REQ}`, () => {
  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;

  const taskFile: IFile = {
    path: "assetspaces/kitelev/exoas-my/my-tasks/aa000000-0000-0000-0000-00000000d5ad.md",
    basename: "aa000000-0000-0000-0000-00000000d5ad",
    name: "aa000000-0000-0000-0000-00000000d5ad.md",
    parent: null,
  };

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      updateLinks: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;
    mockVault.read.mockResolvedValue("");
    converter = new NoteToRDFConverter(mockVault);
  });

  /** Datatype IRI of the single `ems__Task_weight` literal the converter emits for `value`. */
  async function converterTag(value: number): Promise<string | undefined> {
    const frontmatter: IFrontmatter = { ems__Task_weight: value };
    mockVault.getFrontmatter.mockImplementation((f: IFile) =>
      f.path === taskFile.path ? frontmatter : null,
    );
    const triples = await converter.convertNote(taskFile);
    const weight = triples.filter(
      (t) => (t.predicate as IRI).value === `${EMS}Task_weight`,
    );
    expect(weight).toHaveLength(1);
    expect(weight[0].object).toBeInstanceOf(Literal);
    const lit = weight[0].object as Literal;
    expect(lit.value).toBe(String(value));
    return lit.datatype?.value;
  }

  /** Datatype IRI the JSON-LD parser assigns to the same native number. */
  function jsonLdTag(value: number): string | undefined {
    const serializer = new RDFSerializer(new InMemoryTripleStore());
    const triples = serializer.parse(
      JSON.stringify({
        "@id": "http://example.com/task",
        [`${EMS}Task_weight`]: value,
      }),
      "json-ld",
    );
    expect(triples).toHaveLength(1);
    const lit = triples[0].object as Literal;
    expect(lit.value).toBe(String(value));
    return lit.datatype?.value;
  }

  it(`P1 ${REQ} a whole YAML number and the same native JSON-LD number get ONE tag — xsd:integer`, async () => {
    const fromFrontmatter = await converterTag(3);
    const fromJsonLd = jsonLdTag(3);
    expect(fromFrontmatter).toBe(`${XSD}integer`);
    expect(fromJsonLd).toBe(fromFrontmatter);
  });

  it(`P2 ${REQ} a fractional number keeps xsd:decimal on BOTH paths (control: the branch the change must not touch)`, async () => {
    const fromFrontmatter = await converterTag(3.5);
    const fromJsonLd = jsonLdTag(3.5);
    expect(fromFrontmatter).toBe(`${XSD}decimal`);
    expect(fromJsonLd).toBe(fromFrontmatter);
  });

  it.each([
    [0, "integer"],
    [-7, "integer"],
    [166774905, "integer"],
    [1e3, "integer"],
    [0.5, "decimal"],
    [-0.25, "decimal"],
  ])(
    `P3 ${REQ} converter tags %s as xsd:%s (Number.isInteger rule, same as the JSON-LD parser)`,
    async (value, local) => {
      expect(await converterTag(value)).toBe(`${XSD}${local}`);
      expect(jsonLdTag(value)).toBe(`${XSD}${local}`);
    },
  );

  it(`P4 ${REQ} a QUOTED number in YAML stays a plain string literal — the tag rule is for typeof number only`, async () => {
    const frontmatter: IFrontmatter = { ems__Task_weight: "3" };
    mockVault.getFrontmatter.mockImplementation((f: IFile) =>
      f.path === taskFile.path ? frontmatter : null,
    );
    const triples = await converter.convertNote(taskFile);
    const weight = triples.filter(
      (t) => (t.predicate as IRI).value === `${EMS}Task_weight`,
    );
    expect(weight).toHaveLength(1);
    const lit = weight[0].object as Literal;
    expect(lit.value).toBe("3");
    expect(lit.datatype?.value ?? `${XSD}string`).toBe(`${XSD}string`);
  });
});

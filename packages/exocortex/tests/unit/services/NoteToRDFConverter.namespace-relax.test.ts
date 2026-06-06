import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";

/**
 * RFC: SHACL namespace whitelist relaxation. Frontmatter keys with
 * non-whitelisted prefixes (e.g. `aiKnow__`, `aiTask__`) must produce triples
 * under the standard `https://exocortex.my/ontology/<prefix>#` IRI convention,
 * instead of being silently dropped by the converter as before.
 */
describe("NoteToRDFConverter — namespace whitelist relaxation", () => {
  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;

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
    converter = new NoteToRDFConverter(mockVault);
  });

  const file: IFile = {
    path: "knowledge.md",
    basename: "knowledge",
    name: "knowledge.md",
    parent: null,
  };

  it("emits triples for keys with non-whitelisted prefixes (aiKnow__)", async () => {
    const frontmatter: IFrontmatter = {
      aiKnow__Memory_aboutConcept: "concept-uuid",
    };
    mockVault.getFrontmatter.mockReturnValue(frontmatter);

    const triples = await converter.convertNote(file);

    const aboutConcept = triples.find((t) =>
      t.predicate.value.endsWith("aiKnow#Memory_aboutConcept"),
    );
    expect(aboutConcept).toBeDefined();
    expect(aboutConcept!.predicate.value).toBe(
      "https://exocortex.my/ontology/aiKnow#Memory_aboutConcept",
    );
  });

  it("emits triples for inbox__ExoAssistantKnowledge_decay/_confidence/_lastReinforcedAt", async () => {
    const frontmatter: IFrontmatter = {
      inbox__ExoAssistantKnowledge_decay: "0.05",
      inbox__ExoAssistantKnowledge_confidence: "0.9",
      inbox__ExoAssistantKnowledge_lastReinforcedAt: "2026-05-09T00:00:00Z",
    };
    mockVault.getFrontmatter.mockReturnValue(frontmatter);

    const triples = await converter.convertNote(file);

    const predicateValues = triples.map((t) => t.predicate.value);
    expect(predicateValues).toEqual(
      expect.arrayContaining([
        "https://exocortex.my/ontology/inbox#ExoAssistantKnowledge_decay",
        "https://exocortex.my/ontology/inbox#ExoAssistantKnowledge_confidence",
        "https://exocortex.my/ontology/inbox#ExoAssistantKnowledge_lastReinforcedAt",
      ]),
    );
  });

  it("ignores keys without the <prefix>__<local> shape", async () => {
    // `aliases` moved to the UNPREFIXED_ASSET_FIELDS whitelist (RFC 1b1c21b2) —
    // it is now emitted as exo:Asset_aliases and covered in NoteToRDFConverter.test.ts.
    // `tags` / `cssclasses` remain non-whitelisted and must stay ignored.
    const frontmatter: IFrontmatter = {
      tags: ["x"],
      cssclasses: "muted",
    };
    mockVault.getFrontmatter.mockReturnValue(frontmatter);

    const triples = await converter.convertNote(file);

    // Only the implicit Asset_filename triple should be emitted.
    expect(triples.length).toBe(1);
    expect(triples[0].predicate.value.endsWith("Asset_filename")).toBe(true);
  });

  it("ignores keys whose prefix starts with a non-letter", async () => {
    const frontmatter: IFrontmatter = {
      "9invalid__field": "x",
      "_leading_underscore__field": "y",
    };
    mockVault.getFrontmatter.mockReturnValue(frontmatter);

    const triples = await converter.convertNote(file);
    expect(triples.length).toBe(1); // only Asset_filename
  });
});

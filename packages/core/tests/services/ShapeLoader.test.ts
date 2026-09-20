import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { ShapeLoader } from "../../src/services/ShapeLoader";
import { ShapeRegistry } from "../../src/services/ShapeRegistry";
import type { Shape } from "../../src/services/ShapeRegistry";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { Namespace } from "../../src/domain/models/rdf/Namespace";
import type { ITripleStore } from "../../src/interfaces/ITripleStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

const EMS = "https://exocortex.my/ontology/ems#";
const EXO = "https://exocortex.my/ontology/exo#";

function makeTriple(s: string, p: string, o: string | { literal: string }): Triple {
  const subj = new IRI(s);
  const pred = new IRI(p);
  const obj =
    typeof o === "string" ? new IRI(o) : new Literal((o as { literal: string }).literal);
  return new Triple(subj, pred, obj);
}

// Minimal mock for ITripleStore
function makeStore(triples: Triple[]): jest.Mocked<ITripleStore> {
  return {
    match: jest.fn().mockImplementation(
      async (
        subject?: unknown,
        predicate?: unknown,
        object?: unknown,
      ): Promise<Triple[]> => {
        return triples.filter((t) => {
          if (subject && !(t.subject instanceof IRI && t.subject.value === (subject as IRI).value))
            return false;
          if (
            predicate &&
            !(t.predicate instanceof IRI && t.predicate.value === (predicate as IRI).value)
          )
            return false;
          if (object && !(t.object instanceof IRI && t.object.value === (object as IRI).value))
            return false;
          return true;
        });
      },
    ),
    add: jest.fn(),
    remove: jest.fn(),
    has: jest.fn(),
    addAll: jest.fn(),
    removeAll: jest.fn(),
    clear: jest.fn(),
    count: jest.fn(),
    subjects: jest.fn(),
    predicates: jest.fn(),
    objects: jest.fn(),
    beginTransaction: jest.fn(),
  } as unknown as jest.Mocked<ITripleStore>;
}

// ── loadFromShapeJSON ─────────────────────────────────────────────────────────

describe("ShapeLoader.loadFromShapeJSON", () => {
  let tmpDir: string;
  let jsonPath: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shacl-test-"));
    jsonPath = path.join(tmpDir, "shapes.json");
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns ShapeRegistry instance", async () => {
    await fs.writeFile(
      jsonPath,
      JSON.stringify({ version: 1, vaultMtime: 0, shapes: {} }),
      "utf-8",
    );
    const reg = await ShapeLoader.loadFromShapeJSON(jsonPath);
    expect(reg).toBeInstanceOf(ShapeRegistry);
  });

  it("loads shapes from RFC §Cached shape format", async () => {
    const cache = {
      version: 1,
      vaultMtime: 1714398672,
      shapes: {
        "ems__Effort_parent": {
          propertyIRI: `${EMS}Effort_parent`,
          domain: [`${EMS}Effort`],
          range: [`${EMS}ParentEffort`],
          cardinality: "Single",
          severity: "sh:Violation",
          message: "ems__Effort_parent must reference ems__ParentEffort",
        },
      },
    };
    await fs.writeFile(jsonPath, JSON.stringify(cache), "utf-8");

    const reg = await ShapeLoader.loadFromShapeJSON(jsonPath);
    expect(reg.size).toBe(1);
    const shape = reg.get(`${EMS}Effort_parent`);
    expect(shape).toBeDefined();
    expect(shape!.domain).toEqual([`${EMS}Effort`]);
    expect(shape!.range).toEqual([`${EMS}ParentEffort`]);
    expect(shape!.cardinality).toBe("Single");
    expect(shape!.severity).toBe("sh:Violation");
    expect(shape!.message).toBe("ems__Effort_parent must reference ems__ParentEffort");
  });

  it("loads multiple shapes", async () => {
    const cache = {
      version: 1,
      vaultMtime: 0,
      shapes: {
        a: { propertyIRI: `${EMS}Effort_parent`, domain: [`${EMS}Effort`], severity: "sh:Violation" },
        b: { propertyIRI: `${EMS}Effort_status`, domain: [`${EMS}Effort`], severity: "sh:Warning" },
      },
    };
    await fs.writeFile(jsonPath, JSON.stringify(cache), "utf-8");
    const reg = await ShapeLoader.loadFromShapeJSON(jsonPath);
    expect(reg.size).toBe(2);
  });
});

// ── loadFromRDFGraph ──────────────────────────────────────────────────────────

describe("ShapeLoader.loadFromRDFGraph", () => {
  const FILE_IRI = "obsidian://vault/ems/ems__Effort_parent.md";
  const RDF_TYPE = Namespace.RDF.term("type").value;
  const RDFS_DOMAIN = Namespace.RDFS.term("domain").value;
  const RDFS_RANGE = Namespace.RDFS.term("range").value;
  const EXO_CARD = Namespace.EXO.term("Property_cardinality").value;
  const EXO_SEV = Namespace.EXO.term("Property_severity").value;
  const EXO_LABEL = Namespace.EXO.term("Asset_label").value;
  const OBJ_PROP_TYPE = `${EXO}ObjectProperty`;
  const PROP_TYPE = `${EXO}Property`;

  function makePropertyTriples(overrides?: {
    type?: string;
    domain?: string;
    range?: string;
    cardinality?: string;
    severity?: string;
    label?: string;
  }): Triple[] {
    const t = {
      type: OBJ_PROP_TYPE,
      domain: `${EMS}Effort`,
      range: `${EMS}ParentEffort`,
      cardinality: `${EXO}PropertyCardinalitySingle`,
      severity: undefined as string | undefined,
      label: "ems__Effort_parent",
      ...overrides,
    };

    const triples: Triple[] = [
      makeTriple(FILE_IRI, RDF_TYPE, t.type),
      makeTriple(FILE_IRI, RDFS_DOMAIN, t.domain),
      makeTriple(FILE_IRI, RDFS_RANGE, t.range),
      makeTriple(FILE_IRI, EXO_CARD, t.cardinality),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: t.label }),
    ];

    if (t.severity) {
      triples.push(makeTriple(FILE_IRI, EXO_SEV, { literal: t.severity }));
    }

    return triples;
  }

  it("returns ShapeRegistry instance", async () => {
    const store = makeStore([]);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg).toBeInstanceOf(ShapeRegistry);
  });

  it("loads shape from exo:ObjectProperty triple", async () => {
    const store = makeStore(makePropertyTriples());
    const reg = await ShapeLoader.loadFromRDFGraph(store);

    expect(reg.size).toBe(1);
    const shape = reg.get(`${EMS}Effort_parent`);
    expect(shape).toBeDefined();
    expect(shape!.domain).toContain(`${EMS}Effort`);
    expect(shape!.range).toContain(`${EMS}ParentEffort`);
    expect(shape!.cardinality).toBe("Single");
  });

  it("loads shape from exo:Property triple", async () => {
    const store = makeStore(makePropertyTriples({ type: PROP_TYPE }));
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.size).toBe(1);
  });

  it("skips property without domain triples", async () => {
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "ems__Effort_parent" }),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.size).toBe(0);
  });

  it("skips property without label triple", async () => {
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS}Effort`),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.size).toBe(0);
  });

  it("defaults severity to sh:Violation when not specified", async () => {
    const store = makeStore(makePropertyTriples({ severity: undefined }));
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS}Effort_parent`)!.severity).toBe("sh:Violation");
  });

  it("parses sh:Warning severity", async () => {
    const store = makeStore(makePropertyTriples({ severity: "sh:Warning" }));
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS}Effort_parent`)!.severity).toBe("sh:Warning");
  });

  it("parses sh:Info severity", async () => {
    const store = makeStore(makePropertyTriples({ severity: "sh:Info" }));
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS}Effort_parent`)!.severity).toBe("sh:Info");
  });

  it("parses Multiple cardinality", async () => {
    const store = makeStore(
      makePropertyTriples({ cardinality: `${EXO}PropertyCardinalityMultiple` }),
    );
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS}Effort_parent`)!.cardinality).toBe("Multiple");
  });

  it("Issue #3179: parses Single cardinality from UID-form IRI", async () => {
    // Post-UID-canon (RFC-004) Property_cardinality wikilinks resolve to
    // file IRIs containing the enum UID rather than the symbolic label.
    const SINGLE_UID = "c93c4b2f-b43d-4cc9-8dd0-31514d608da2";
    const UID_FILE_IRI = `obsidian://vault/assetspaces/exo/${SINGLE_UID}.md`;
    const store = makeStore(
      makePropertyTriples({ cardinality: UID_FILE_IRI }),
    );
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS}Effort_parent`)!.cardinality).toBe("Single");
  });

  it("Issue #3179: parses Multiple cardinality from UID-form IRI", async () => {
    const MULTI_UID = "59a37aa7-ffbe-4e0d-ba60-06ae370d880f";
    const UID_FILE_IRI = `obsidian://vault/assetspaces/exo/${MULTI_UID}.md`;
    const store = makeStore(
      makePropertyTriples({ cardinality: UID_FILE_IRI }),
    );
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS}Effort_parent`)!.cardinality).toBe("Multiple");
  });

  it("auto-extends ad-hoc namespaces for non-whitelisted label prefixes", async () => {
    // RFC: SHACL namespace whitelist relaxation — `unknown__something`
    // resolves to `https://exocortex.my/ontology/unknown#something` instead of
    // being silently dropped, so cross-namespace queries (e.g. aiKnow:*) work.
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS}Effort`),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "unknown__something" }),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.size).toBe(1);
    expect(reg.get("https://exocortex.my/ontology/unknown#something")).toBeDefined();
  });

  it("rejects label that does not match the <prefix>__<local> form", async () => {
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS}Effort`),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "no_double_underscore" }),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.size).toBe(0);
  });

  it("handles empty store — returns empty registry", async () => {
    const store = makeStore([]);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.size).toBe(0);
  });

  it("resolves file-IRI domain/range via rdfs:label to canonical IRI", async () => {
    // Regression: after RFC-004 UUID-canonicalization, NoteToRDFConverter
    // sometimes emits domain/range as a synthesised file IRI when the
    // wikilink target lies outside the source vault. resolveClassIRI must
    // look up the file IRI's rdfs:label in the graph and convert it to the
    // canonical namespace IRI so sh:class constraints match rdf:type values.
    const CLASS_FILE_IRI = "obsidian://vault/ems/uid-1.md";
    const RDFS_LABEL = Namespace.RDFS.term("label").value;
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, CLASS_FILE_IRI),
      makeTriple(FILE_IRI, RDFS_RANGE, CLASS_FILE_IRI),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "ems__Effort_parent" }),
      makeTriple(CLASS_FILE_IRI, RDFS_LABEL, { literal: "ems__Task" }),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    const shape = reg.get(`${EMS}Effort_parent`);
    expect(shape).toBeDefined();
    expect(shape!.domain).toEqual([`${EMS}Task`]);
    expect(shape!.range).toEqual([`${EMS}Task`]);
  });

  it("falls back to original file IRI when no label exists in graph", async () => {
    const UNKNOWN_CLASS_IRI = "obsidian://vault/foo/unknown.md";
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, UNKNOWN_CLASS_IRI),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "ems__Effort_parent" }),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    const shape = reg.get(`${EMS}Effort_parent`);
    expect(shape).toBeDefined();
    // Unresolvable class file → original IRI retained so the shape still
    // registers (cardinality / minCount checks remain effective).
    expect(shape!.domain).toEqual([UNKNOWN_CLASS_IRI]);
  });

  it("skips label that produces an invalid IRI (e.g. whitespace in localName)", async () => {
    // Regression: real-world vault assets had labels like 'exo__Class Foo'
    // (with whitespace) which made Namespace.term throw and aborted the
    // entire validation run. labelToIRI must now treat such labels as
    // unresolvable and drop the shape without throwing.
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS}Effort`),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "ems__bad label with spaces" }),
    ];
    const store = makeStore(triples);
    await expect(ShapeLoader.loadFromRDFGraph(store)).resolves.toBeDefined();
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.size).toBe(0);
  });
});

// ── loadFromVaultFS ───────────────────────────────────────────────────────────

describe("ShapeLoader.loadFromVaultFS", () => {
  let tmpDir: string;

  async function writeFile(name: string, content: string): Promise<string> {
    const filePath = path.join(tmpDir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shacl-vault-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty registry for empty vault", async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "shacl-empty-"));
    try {
      const reg = await ShapeLoader.loadFromVaultFS(emptyDir);
      expect(reg.size).toBe(0);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("skips non-property .md files", async () => {
    await writeFile(
      "regular-note.md",
      `---\nexo__Instance_class:\n  - "[[ems__Task]]"\nexo__Asset_label: some-task\n---\n`,
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    expect(reg.size).toBe(0);
  });

  it("loads property with domain, range, cardinality, severity from frontmatter", async () => {
    await writeFile(
      "ems__Effort_parent.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"',
        'exo__Property_domain: "[[086f71fa-dd30-4284-90cf-e609f2a6c461|ems__Effort]]"',
        'exo__Property_range: "[[ems__ParentEffort]]"',
        'exo__Property_cardinality: "[[exo__PropertyCardinalitySingle]]"',
        "exo__Asset_label: ems__Effort_parent",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_parent`);
    expect(shape).toBeDefined();
    expect(shape!.domain).toEqual([`${EMS}Effort`]);
    expect(shape!.range).toEqual([`${EMS}ParentEffort`]);
    expect(shape!.cardinality).toBe("Single");
  });

  it("loads property with pure UID-form exo__Instance_class (post UUID-canon, no alias)", async () => {
    // After RFC-004 UUID-canonicalization + alias strip (2026-05-17),
    // property files reference their type class by bare UID with no display alias:
    //   exo__Instance_class:
    //     - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16]]"  # exo__ObjectProperty UID
    // ShapeLoader must recognise this form, otherwise validate-schema --shapes-mode
    // silently loads zero shapes and reports `conforms: true` on every vault.
    await writeFile(
      "uid-form-prop.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        'exo__Property_range: "[[ems__Task]]"',
        "exo__Asset_label: ems__Task_uidFormProp",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Task_uidFormProp`);
    expect(shape).toBeDefined();
    expect(shape!.range).toEqual([`${EMS}Task`]);
  });

  it("loads property with pure UID-form for exo__Property class UID", async () => {
    // Same scenario for exo__Property (not ObjectProperty) by UID:
    //   38277bfa-d7f9-4a75-b856-b23276ab0db3 = exo__Property class
    await writeFile(
      "uid-form-base-prop.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[38277bfa-d7f9-4a75-b856-b23276ab0db3]]"',
        'exo__Property_domain: "[[exo__Asset]]"',
        "exo__Asset_label: exo__Asset_uidLabel",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EXO}Asset_uidLabel`);
    expect(shape).toBeDefined();
    expect(shape!.domain).toEqual([`${EXO}Asset`]);
  });

  it("defaults severity to sh:Violation when absent", async () => {
    await writeFile(
      "no-severity.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        "exo__Asset_label: ems__Effort_blocker",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_blocker`);
    expect(shape).toBeDefined();
    expect(shape!.severity).toBe("sh:Violation");
  });

  it("parses exo__Property class (not just ObjectProperty)", async () => {
    await writeFile(
      "sub/base-prop.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__Property]]"',
        'exo__Property_domain: "[[exo__Asset]]"',
        "exo__Asset_label: exo__Asset_label",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EXO}Asset_label`);
    expect(shape).toBeDefined();
  });

  it("skips file without exo__Property_domain", async () => {
    const preSize = (await ShapeLoader.loadFromVaultFS(tmpDir)).size;
    await writeFile(
      "no-domain.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        "exo__Asset_label: ems__Effort_something",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    expect(reg.size).toBe(preSize); // unchanged
  });

  it("skips file without exo__Asset_label", async () => {
    const preSize = (await ShapeLoader.loadFromVaultFS(tmpDir)).size;
    await writeFile(
      "no-label.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    expect(reg.size).toBe(preSize); // unchanged
  });

  it("handles Multiple cardinality", async () => {
    await writeFile(
      "multi-card.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        'exo__Property_cardinality: "[[exo__PropertyCardinalityMultiple]]"',
        "exo__Asset_label: ems__Effort_relates",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_relates`);
    expect(shape).toBeDefined();
    expect(shape!.cardinality).toBe("Multiple");
  });

  it("Issue #3179: handles Single cardinality declared as UID wikilink", async () => {
    // Post-UID-canon vault property files use bare UID wikilinks for the
    // cardinality enum: `[[c93c4b2f-...]]` is the UID of
    // exo__PropertyCardinalitySingle. cardinalityFromLabel previously only
    // checked label suffixes and silently returned undefined → CLI fell
    // back to array emission for single-cardinality predicates.
    await writeFile(
      "uid-card-single.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        'exo__Property_cardinality: "[[c93c4b2f-b43d-4cc9-8dd0-31514d608da2]]"',
        "exo__Asset_label: ems__Effort_status",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_status`);
    expect(shape).toBeDefined();
    expect(shape!.cardinality).toBe("Single");
  });

  it("Issue #3179: handles Multiple cardinality declared as UID wikilink", async () => {
    await writeFile(
      "uid-card-multi.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        'exo__Property_cardinality: "[[59a37aa7-ffbe-4e0d-ba60-06ae370d880f]]"',
        "exo__Asset_label: ems__Effort_relatesUid",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_relatesUid`);
    expect(shape).toBeDefined();
    expect(shape!.cardinality).toBe("Multiple");
  });

  it("parses sh:Violation severity literal", async () => {
    await writeFile(
      "sev-violation.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        "exo__Property_severity: sh:Violation",
        "exo__Asset_label: ems__Effort_jiraURL",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    expect(reg.get(`${EMS}Effort_jiraURL`)!.severity).toBe("sh:Violation");
  });

  it("walks subdirectories recursively", async () => {
    await writeFile(
      "deep/sub/dir/property.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[exo__Asset]]"',
        "exo__Asset_label: exo__Asset_uid",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    expect(reg.get(`${EXO}Asset_uid`)).toBeDefined();
  });

  it("skips files without frontmatter", async () => {
    const preSize = (await ShapeLoader.loadFromVaultFS(tmpDir)).size;
    await writeFile("no-fm.md", "# Just a note\nNo frontmatter here.\n");
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    expect(reg.size).toBe(preSize);
  });

  it("handles range absent — shape.range is undefined", async () => {
    await writeFile(
      "no-range.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        "exo__Asset_label: ems__Effort_day",
        "---",
      ].join("\n"),
    );

    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_day`);
    expect(shape).toBeDefined();
    expect(shape!.range).toBeUndefined();
  });

  it("gracefully handles non-existent vault directory (returns empty registry)", async () => {
    const reg = await ShapeLoader.loadFromVaultFS("/non/existent/dir");
    expect(reg.size).toBe(0);
  });

  it("flushes array at end of frontmatter (last key is array)", async () => {
    // Frontmatter where the array is the very last key (no trailing newline before ---)
    await writeFile(
      "array-last.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        "exo__Asset_label: ems__Effort_area",
        'exo__Property_range:',
        '  - "[[ems__Area]]"',
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_area`);
    expect(shape).toBeDefined();
    expect(shape!.range).toEqual([`${Namespace.EMS.term("Area").value}`]);
  });

  it("handles range wikilink with full http IRI fallback", async () => {
    await writeFile(
      "full-iri-range.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        'exo__Property_range: "[[http://www.w3.org/ns/shacl#Severity]]"',
        "exo__Asset_label: exo__Property_severity",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EXO}Property_severity`);
    expect(shape).toBeDefined();
    expect(shape!.range).toEqual(["http://www.w3.org/ns/shacl#Severity"]);
  });

  it("handles unrecognized cardinality label (returns undefined cardinality)", async () => {
    await writeFile(
      "unknown-card.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        'exo__Property_cardinality: "[[exo__UnknownCardinality]]"',
        "exo__Asset_label: ems__Effort_notes",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_notes`);
    expect(shape).toBeDefined();
    expect(shape!.cardinality).toBeUndefined();
  });

  it("auto-extends range wikilink with non-whitelisted prefix to ad-hoc IRI", async () => {
    // RFC: SHACL namespace whitelist relaxation — period__Day now resolves to
    // <https://exocortex.my/ontology/period#Day> instead of being dropped.
    await writeFile(
      "period-range.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[ems__Effort]]"',
        'exo__Property_range: "[[period__Day]]"',
        "exo__Asset_label: ems__Effort_day2",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EMS}Effort_day2`);
    expect(shape).toBeDefined();
    expect(shape!.range).toEqual(["https://exocortex.my/ontology/period#Day"]);
  });

  it("handles sh: prefix in range wikilink", async () => {
    await writeFile(
      "sh-range.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__ObjectProperty]]"',
        'exo__Property_domain: "[[exo__Property]]"',
        'exo__Property_range: "[[sh:Severity]]"',
        "exo__Asset_label: exo__Property_severity2",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EXO}Property_severity2`);
    expect(shape).toBeDefined();
    expect(shape!.range).toEqual(["http://www.w3.org/ns/shacl#Severity"]);
  });
});

// ── loadFromRDFGraph: additional edge-case coverage ───────────────────────────

describe("ShapeLoader.loadFromRDFGraph — additional cases", () => {
  const FILE_IRI = "obsidian://vault/ems/test-prop.md";
  const RDF_TYPE = Namespace.RDF.term("type").value;
  const RDFS_DOMAIN = Namespace.RDFS.term("domain").value;
  const EXO_CARD = Namespace.EXO.term("Property_cardinality").value;
  const EXO_SEV = Namespace.EXO.term("Property_severity").value;
  const EXO_LABEL = Namespace.EXO.term("Asset_label").value;
  const EMS_NS = "https://exocortex.my/ontology/ems#";
  const EXO_NS = "https://exocortex.my/ontology/exo#";
  const OBJ_PROP_TYPE = `${EXO_NS}ObjectProperty`;

  it("defaults to sh:Violation for unknown severity IRI", async () => {
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS_NS}Effort`),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "ems__Effort_test" }),
      makeTriple(FILE_IRI, EXO_SEV, { literal: "totally-unknown-severity" }),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS_NS}Effort_test`)!.severity).toBe("sh:Violation");
  });

  it("returns undefined cardinality for unrecognized cardinality IRI", async () => {
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS_NS}Effort`),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "ems__Effort_test2" }),
      makeTriple(FILE_IRI, EXO_CARD, `${EXO_NS}PropertyCardinalityUnknown`),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS_NS}Effort_test2`)!.cardinality).toBeUndefined();
  });

  it("parses minCount from RDF graph literal", async () => {
    const EXO_MIN_COUNT = Namespace.EXO.term("Property_minCount").value;
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS_NS}Effort`),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "ems__Effort_mintest" }),
      makeTriple(FILE_IRI, EXO_MIN_COUNT, { literal: "1" }),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS_NS}Effort_mintest`)!.minCount).toBe(1);
  });

  it("returns undefined minCount when not specified in RDF graph", async () => {
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS_NS}Effort`),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "ems__Effort_nomin" }),
    ];
    const store = makeStore(triples);
    const reg = await ShapeLoader.loadFromRDFGraph(store);
    expect(reg.get(`${EMS_NS}Effort_nomin`)!.minCount).toBeUndefined();
  });
});

// ── xsd: prefix and minCount in loadFromVaultFS ───────────────────────────────

describe("ShapeLoader.loadFromVaultFS — minCount and xsd: range", () => {
  const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
  const EXO_NS = "https://exocortex.my/ontology/exo#";
  let tmpDir: string;

  async function writeFile(name: string, content: string): Promise<string> {
    const filePath = path.join(tmpDir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shacl-mincount-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("parses minCount from frontmatter", async () => {
    await writeFile(
      "min-count-prop.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__Property]]"',
        'exo__Property_domain: "[[exo__Asset]]"',
        "exo__Property_minCount: 1",
        "exo__Asset_label: exo__Asset_updatedAt",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EXO_NS}Asset_updatedAt`);
    expect(shape).toBeDefined();
    expect(shape!.minCount).toBe(1);
  });

  it("returns undefined minCount when not specified in frontmatter", async () => {
    await writeFile(
      "no-min-count.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__Property]]"',
        'exo__Property_domain: "[[exo__Asset]]"',
        "exo__Asset_label: exo__Asset_description",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EXO_NS}Asset_description`);
    expect(shape).toBeDefined();
    expect(shape!.minCount).toBeUndefined();
  });

  it("resolves xsd: prefix in range to full XSD IRI", async () => {
    await writeFile(
      "xsd-range.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__Property]]"',
        'exo__Property_domain: "[[exo__Asset]]"',
        'exo__Property_range: "[[xsd:dateTime]]"',
        "exo__Asset_label: exo__Asset_createdAt",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EXO_NS}Asset_createdAt`);
    expect(shape).toBeDefined();
    expect(shape!.range).toEqual([`${XSD_NS}dateTime`]);
  });

  it("exo__Asset_updatedAt shape: minCount=1, xsd:dateTime range, sh:Warning severity", async () => {
    await writeFile(
      "updatedAt-full.md",
      [
        "---",
        'exo__Instance_class:',
        '  - "[[exo__Property]]"',
        'exo__Property_domain: "[[exo__Asset]]"',
        'exo__Property_range: "[[xsd:dateTime]]"',
        "exo__Property_minCount: 1",
        "exo__Property_severity: sh:Warning",
        "exo__Asset_label: exo__Asset_updatedAt",
        "---",
      ].join("\n"),
    );
    const reg = await ShapeLoader.loadFromVaultFS(tmpDir);
    const shape = reg.get(`${EXO_NS}Asset_updatedAt`);
    expect(shape).toBeDefined();
    expect(shape!.minCount).toBe(1);
    expect(shape!.range).toEqual([`${XSD_NS}dateTime`]);
    expect(shape!.severity).toBe("sh:Warning");
    expect(shape!.domain).toEqual([`${EXO_NS}Asset`]);
  });
});

// ── CURIE-literal datatype range in loadFromRDFGraph (ticket a9b55ead) ────────

describe("ShapeLoader.loadFromRDFGraph — CURIE-literal datatype range xsd:<local> (@req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2)", () => {
  const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
  const FILE_IRI = "obsidian://vault/pmi/pmi__Principle_number.md";
  const RDF_TYPE = Namespace.RDF.term("type").value;
  const RDFS_DOMAIN = Namespace.RDFS.term("domain").value;
  const RDFS_RANGE = Namespace.RDFS.term("range").value;
  const EXO_LABEL = Namespace.EXO.term("Asset_label").value;

  function propertyTriples(rangeLiteral: string): Triple[] {
    return [
      makeTriple(FILE_IRI, RDF_TYPE, `${EXO}Property`),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS}Task`),
      makeTriple(FILE_IRI, RDFS_RANGE, { literal: rangeLiteral }),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "pmi__Principle_number" }),
    ];
  }

  it("L1 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 CURIE literal range \"xsd:integer\" (the live-corpus form) resolves to the full XSD IRI, like wikilinkToIRI does", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(makeStore(propertyTriples("xsd:integer")));
    const shape = reg.get("https://exocortex.my/ontology/pmi#Principle_number");
    expect(shape).toBeDefined();
    expect(shape!.range).toEqual([`${XSD_NS}integer`]);
  });

  it("L2 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 full-IRI literal range keeps resolving (no regression of the http:// branch)", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(
      makeStore(propertyTriples(`${XSD_NS}integer`)),
    );
    expect(reg.get("https://exocortex.my/ontology/pmi#Principle_number")!.range).toEqual([
      `${XSD_NS}integer`,
    ]);
  });

  it("L3 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 a literal range that is neither a CURIE nor an IRI is still dropped (shape.range undefined)", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(makeStore(propertyTriples("integer")));
    expect(reg.get("https://exocortex.my/ontology/pmi#Principle_number")!.range).toBeUndefined();
  });

  it("L4 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 loader parity: the SAME frontmatter yields the SAME shape.range via loadFromRDFGraph (through NoteToRDFConverter) and via loadFromVaultFS", async () => {
    const { NoteToRDFConverter } = await import("../../src/services/NoteToRDFConverter");
    const { InMemoryTripleStore } = await import(
      "../../src/infrastructure/rdf/InMemoryTripleStore"
    );
    const frontmatter = {
      exo__Instance_class: ["[[exo__Property]]"],
      exo__Asset_label: "pmi__Principle_number",
      exo__Property_domain: ["[[ems__Task]]"],
      exo__Property_range: "xsd:integer",
    };
    const mockVault = {
      getFrontmatter: jest.fn().mockReturnValue(frontmatter),
      getAllFiles: jest.fn().mockReturnValue([]),
      read: jest.fn().mockResolvedValue(""),
      getFirstLinkpathDest: jest.fn().mockReturnValue(null),
    } as unknown as ConstructorParameters<typeof NoteToRDFConverter>[0];
    const converter = new NoteToRDFConverter(mockVault);
    const triples = await converter.convertNote({
      path: "pmi/pmi__Principle_number.md",
      basename: "pmi__Principle_number",
      extension: "md",
      name: "pmi__Principle_number.md",
      parent: null,
    } as Parameters<typeof converter.convertNote>[0]);
    const store = new InMemoryTripleStore();
    await store.addAll(triples);
    const viaGraph = await ShapeLoader.loadFromRDFGraph(store);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shacl-parity-"));
    try {
      await fs.writeFile(
        path.join(tmpDir, "pmi__Principle_number.md"),
        [
          "---",
          "exo__Instance_class:",
          '  - "[[exo__Property]]"',
          "exo__Asset_label: pmi__Principle_number",
          "exo__Property_domain:",
          '  - "[[ems__Task]]"',
          "exo__Property_range: xsd:integer",
          "---",
        ].join("\n"),
        "utf-8",
      );
      const viaFS = await ShapeLoader.loadFromVaultFS(tmpDir);
      const iri = "https://exocortex.my/ontology/pmi#Principle_number";
      expect(viaFS.get(iri)!.range).toEqual([`${XSD_NS}integer`]);
      expect(viaGraph.get(iri)?.range).toEqual(viaFS.get(iri)!.range);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Property-def classes reached through exo__Class_superClass (ticket 84bb4d08) ──

describe("ShapeLoader — property definitions typed by a SUBCLASS of exo__Property are loaded by both loaders (@req:67767fcb-15e3-4deb-9b70-5b96c7110a22)", () => {
  const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
  const RDF_TYPE = Namespace.RDF.term("type").value;
  const RDFS_DOMAIN = Namespace.RDFS.term("domain").value;
  const RDFS_LABEL = Namespace.RDFS.term("label").value;
  const RDFS_SUBCLASS_OF = Namespace.RDFS.term("subClassOf").value;
  const EXO_LABEL = Namespace.EXO.term("Asset_label").value;
  const EXO_RANGE = Namespace.EXO.term("Property_range").value;
  const EXO_SUPER = Namespace.EXO.term("Class_superClass").value;
  const PROPERTY_IRI = "https://exocortex.my/ontology/flow#Stage_order";
  const DEF_IRI = "obsidian://vault/tbox/flow/9d2f1a11-0000-4000-8000-000000000001.md";
  // Live UIDs (exoas-exo): exo__Property, exo__ObjectProperty, exo__DatatypeProperty, exo__StringProperty.
  const PROPERTY_UID = "38277bfa-d7f9-4a75-b856-b23276ab0db3";
  const DATATYPE_UID = "ae56ca4c-b610-42a4-a25d-058c23673296";
  const STRING_UID = "30d63ce4-e574-456c-8de8-2bf1a53688c1";
  const OBJECT_PROPERTY_UID = "9a1cf31c-9d41-4ef3-9023-584a8d087d16";
  const BOOLEAN_UID = "5f5d3f0e-0000-4000-8000-00000000b001";
  const classFile = (uid: string) => `obsidian://vault/tbox/exo/${uid}.md`;

  /** A property def typed ONLY `typeIRI`, range "xsd:integer", domain ems:Task. */
  function defTriples(typeIRI: string): Triple[] {
    return [
      makeTriple(DEF_IRI, RDF_TYPE, typeIRI),
      makeTriple(DEF_IRI, RDFS_DOMAIN, `${EMS}Task`),
      makeTriple(DEF_IRI, EXO_RANGE, { literal: "xsd:integer" }),
      makeTriple(DEF_IRI, EXO_LABEL, { literal: "flow__Stage_order" }),
    ];
  }
  /** A TBox class file: labelled, declaring `exo__Class_superClass` → `parentIRI` (as the converter emits it). */
  function classTriples(uid: string, label: string, parentIRI: string, predicate = EXO_SUPER): Triple[] {
    return [
      makeTriple(classFile(uid), RDFS_LABEL, { literal: label }),
      makeTriple(classFile(uid), predicate, parentIRI),
    ];
  }

  it("D1 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromRDFGraph: a def typed only exo:DatatypeProperty is registered when the graph declares DatatypeProperty ⊑ Property (sh:datatype xsd:integer reaches the registry)", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(
      makeStore([
        ...defTriples(`${EXO}DatatypeProperty`),
        ...classTriples(DATATYPE_UID, "exo__DatatypeProperty", `${EXO}Property`),
      ]),
    );
    const shape = reg.get(PROPERTY_IRI);
    expect(shape).toBeDefined();
    expect(shape!.range).toEqual([`${XSD_NS}integer`]);
    expect(shape!.domain).toEqual([`${EMS}Task`]);
  });

  it("D2 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromRDFGraph: the walk is transitive — exo:StringProperty ⊑ DatatypeProperty ⊑ Property", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(
      makeStore([
        ...defTriples(`${EXO}StringProperty`),
        ...classTriples(STRING_UID, "exo__StringProperty", `${EXO}DatatypeProperty`),
        ...classTriples(DATATYPE_UID, "exo__DatatypeProperty", `${EXO}Property`),
      ]),
    );
    expect(reg.get(PROPERTY_IRI)?.range).toEqual([`${XSD_NS}integer`]);
  });

  it("D3 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromRDFGraph: an rdfs:subClassOf edge (the converter's RDFS twin) is walked too, and a file-IRI parent resolves through its label", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(
      makeStore([
        ...defTriples(`${EXO}DatatypeProperty`),
        // parent written as the class FILE IRI (pure-UID wikilink form), not the symbolic IRI
        ...classTriples(DATATYPE_UID, "exo__DatatypeProperty", classFile(PROPERTY_UID), RDFS_SUBCLASS_OF),
        makeTriple(classFile(PROPERTY_UID), RDFS_LABEL, { literal: "exo__Property" }),
      ]),
    );
    expect(reg.get(PROPERTY_IRI)?.range).toEqual([`${XSD_NS}integer`]);
  });

  it("D4 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromRDFGraph: the class set is derived from the graph, not hard-coded — without the DatatypeProperty ⊑ Property edge the def stays unknown", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(makeStore(defTriples(`${EXO}DatatypeProperty`)));
    expect(reg.get(PROPERTY_IRI)).toBeUndefined();
  });

  it("D5 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromRDFGraph: negative control — a class outside the exo:Property hierarchy (ems:Task ⊑ exo:Asset) never yields a shape, and exo:Property / exo:ObjectProperty keep loading without any edge", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(
      makeStore([
        ...defTriples(`${EMS}Task`),
        ...classTriples("1b20a8f0-d745-4e93-91db-4531b3df120e", "ems__Task", `${EXO}Asset`),
      ]),
    );
    expect(reg.get(PROPERTY_IRI)).toBeUndefined();
    for (const legacy of [`${EXO}Property`, `${EXO}ObjectProperty`]) {
      const legacyReg = await ShapeLoader.loadFromRDFGraph(makeStore(defTriples(legacy)));
      expect(legacyReg.get(PROPERTY_IRI)?.range).toEqual([`${XSD_NS}integer`]);
    }
  });

  it("D6 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromRDFGraph: a cycle in the declared hierarchy terminates — Property ⊑ X ⊑ Property still registers a def typed X; an unrelated cycle A ⊑ B ⊑ A does not", async () => {
    const X = "aaaaaaaa-0000-4000-8000-00000000000a";
    const A = "aaaaaaaa-0000-4000-8000-00000000000b";
    const B = "aaaaaaaa-0000-4000-8000-00000000000c";
    const reg = await ShapeLoader.loadFromRDFGraph(
      makeStore([
        ...defTriples(`${EXO}XProperty`),
        ...classTriples(X, "exo__XProperty", `${EXO}Property`),
        ...classTriples(PROPERTY_UID, "exo__Property", `${EXO}XProperty`),
        ...classTriples(A, "exo__ACycle", `${EXO}BCycle`),
        ...classTriples(B, "exo__BCycle", `${EXO}ACycle`),
      ]),
    );
    expect(reg.get(PROPERTY_IRI)?.range).toEqual([`${XSD_NS}integer`]);
    const unrelated = await ShapeLoader.loadFromRDFGraph(
      makeStore([
        ...defTriples(`${EXO}ACycle`),
        ...classTriples(A, "exo__ACycle", `${EXO}BCycle`),
        ...classTriples(B, "exo__BCycle", `${EXO}ACycle`),
      ]),
    );
    expect(unrelated.get(PROPERTY_IRI)).toBeUndefined();
  });

  it("D7 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromRDFGraph: the walk starts from BOTH seeds — exo:BooleanProperty ⊑ exo:ObjectProperty ⊑ exo:Property (the live exoas-exo shape) is registered", async () => {
    const reg = await ShapeLoader.loadFromRDFGraph(
      makeStore([
        ...defTriples(`${EXO}BooleanProperty`),
        ...classTriples(BOOLEAN_UID, "exo__BooleanProperty", `${EXO}ObjectProperty`),
        ...classTriples(OBJECT_PROPERTY_UID, "exo__ObjectProperty", `${EXO}Property`),
      ]),
    );
    expect(reg.get(PROPERTY_IRI)?.range).toEqual([`${XSD_NS}integer`]);
  });

  // ── loadFromVaultFS ──

  const DEF_FM = (classValue: string) =>
    [
      "---",
      `exo__Asset_uid: 9d2f1a11-0000-4000-8000-000000000001`,
      "exo__Instance_class:",
      `  - "${classValue}"`,
      "exo__Asset_label: flow__Stage_order",
      "exo__Property_domain:",
      '  - "[[ems__Task]]"',
      'exo__Property_range: "xsd:integer"',
      'exo__Property_cardinality: "[[c93c4b2f-b43d-4cc9-8dd0-31514d608da2]]"',
      // unquoted, as `create --class DatatypeProperty` writes it (the FS parser keeps a quoted "1" verbatim — separate gap)
      "exo__Property_minCount: 1",
      "---",
      "",
    ].join("\n");
  const CLASS_FM = (uid: string | null, label: string, superValue: string) =>
    [
      "---",
      ...(uid ? [`exo__Asset_uid: ${uid}`] : []),
      "exo__Instance_class:",
      '  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"',
      "exo__Class_superClass:",
      `  - "${superValue}"`,
      `exo__Asset_label: ${label}`,
      "---",
      "",
    ].join("\n");

  async function withVault(
    files: Record<string, string>,
    run: (dir: string) => Promise<void>,
  ): Promise<void> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shape-loader-subclass-"));
    try {
      for (const [rel, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await fs.writeFile(path.join(dir, rel), content, "utf-8");
      }
      await run(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it("F1 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromVaultFS: pure-UID class form [[ae56ca4c…]] (exo__DatatypeProperty) is accepted through UID-named class files DatatypeProperty → Property — and through a legacy label-named class file carrying that exo__Asset_uid", async () => {
    await withVault(
      {
        "flow/def.md": DEF_FM(`[[${DATATYPE_UID}]]`),
        [`exo/${DATATYPE_UID}.md`]: CLASS_FM(DATATYPE_UID, "exo__DatatypeProperty", `[[${PROPERTY_UID}]]`),
        [`exo/${PROPERTY_UID}.md`]: CLASS_FM(PROPERTY_UID, "exo__Property", "[[493c2ae2-de56-47ec-954d-2eb8cb49bff7]]"),
      },
      async (dir) => {
        const shape = (await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI);
        expect(shape).toBeDefined();
        expect(shape!.range).toEqual([`${XSD_NS}integer`]);
        expect(shape!.cardinality).toBe("Single");
        expect(shape!.minCount).toBe(1);
      },
    );
    // Pre-UID-canon class file: label-named on disk, UID only in frontmatter — the def's [[<uid>]] must still match it.
    await withVault(
      {
        "flow/def.md": DEF_FM(`[[${DATATYPE_UID}]]`),
        // uid written as a quoted scalar — the quotes must not become part of the key
        "exo/exo__DatatypeProperty.md": CLASS_FM(DATATYPE_UID, "exo__DatatypeProperty", "[[exo__Property]]").replace(
          `exo__Asset_uid: ${DATATYPE_UID}`,
          `exo__Asset_uid: "${DATATYPE_UID}"`,
        ),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          `${XSD_NS}integer`,
        ]);
      },
    );
  });

  it("F2 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromVaultFS: legacy label form [[exo__DatatypeProperty]] is accepted through a label-named class file (no exo__Asset_uid, no label field) declaring [[exo__Property]] — and through a UID-named class file whose exo__Asset_label is that name", async () => {
    // Label-named file with NO exo__Asset_label: only the filename stem can name it.
    const labelless = CLASS_FM(null, "exo__DatatypeProperty", "[[exo__Property]]").replace(
      "exo__Asset_label: exo__DatatypeProperty\n",
      "",
    );
    expect(labelless).not.toContain("exo__Asset_label");
    await withVault(
      {
        "flow/def.md": DEF_FM("[[exo__DatatypeProperty]]"),
        "exo/exo__DatatypeProperty.md": labelless,
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          `${XSD_NS}integer`,
        ]);
      },
    );
    // Post-UID-canon class file referenced by its label (legacy def form): only exo__Asset_label can name it —
    // written as a quoted scalar here, the form labels with special characters take.
    await withVault(
      {
        "flow/def.md": DEF_FM("[[exo__DatatypeProperty]]"),
        [`exo/${DATATYPE_UID}.md`]: CLASS_FM(DATATYPE_UID, "exo__DatatypeProperty", "[[exo__Property]]").replace(
          "exo__Asset_label: exo__DatatypeProperty",
          'exo__Asset_label: "exo__DatatypeProperty"',
        ),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          `${XSD_NS}integer`,
        ]);
      },
    );
  });

  it("F3 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromVaultFS: transitive + uid|alias form — [[<uid>|exo__StringProperty]] ⊑ DatatypeProperty ⊑ Property, with the class files scanned AFTER the def (order-independent)", async () => {
    await withVault(
      {
        "a-flow/def.md": DEF_FM(`[[${STRING_UID}|exo__StringProperty]]`),
        [`z-exo/${STRING_UID}.md`]: CLASS_FM(STRING_UID, "exo__StringProperty", `[[${DATATYPE_UID}|exo__DatatypeProperty]]`),
        [`z-exo/${DATATYPE_UID}.md`]: CLASS_FM(DATATYPE_UID, "exo__DatatypeProperty", `[[${PROPERTY_UID}]]`),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          `${XSD_NS}integer`,
        ]);
      },
    );
  });

  it("F4 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromVaultFS: negative controls — a class outside the hierarchy yields no shape; a DatatypeProperty def without its class file stays unknown; exo__Property / exo__ObjectProperty still load with no class files", async () => {
    await withVault(
      {
        "flow/def.md": DEF_FM("[[ems__Task]]"),
        "ems/ems__Task.md": CLASS_FM(null, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)).toBeUndefined();
      },
    );
    await withVault({ "flow/def.md": DEF_FM(`[[${DATATYPE_UID}]]`) }, async (dir) => {
      expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)).toBeUndefined();
    });
    for (const legacy of ["[[exo__Property]]", `[[${PROPERTY_UID}]]`, "[[exo__ObjectProperty]]"]) {
      await withVault({ "flow/def.md": DEF_FM(legacy) }, async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          `${XSD_NS}integer`,
        ]);
      });
    }
  });

  it("F5 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromVaultFS: a cycle in the class files terminates — Property ⊑ X ⊑ Property still registers a def typed X; an unrelated A ⊑ B ⊑ A registers nothing", async () => {
    const X = "aaaaaaaa-0000-4000-8000-00000000000a";
    const A = "aaaaaaaa-0000-4000-8000-00000000000b";
    const B = "aaaaaaaa-0000-4000-8000-00000000000c";
    await withVault(
      {
        "flow/def.md": DEF_FM(`[[${X}]]`),
        [`exo/${X}.md`]: CLASS_FM(X, "exo__XProperty", `[[${PROPERTY_UID}]]`),
        [`exo/${PROPERTY_UID}.md`]: CLASS_FM(PROPERTY_UID, "exo__Property", `[[${X}]]`),
        [`exo/${A}.md`]: CLASS_FM(A, "exo__ACycle", `[[${B}]]`),
        [`exo/${B}.md`]: CLASS_FM(B, "exo__BCycle", `[[${A}]]`),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          `${XSD_NS}integer`,
        ]);
      },
    );
    await withVault(
      {
        "flow/def.md": DEF_FM(`[[${A}]]`),
        [`exo/${A}.md`]: CLASS_FM(A, "exo__ACycle", `[[${B}]]`),
        [`exo/${B}.md`]: CLASS_FM(B, "exo__BCycle", `[[${A}]]`),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)).toBeUndefined();
      },
    );
  });

  it("F6 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loadFromVaultFS: the walk starts from BOTH seeds — [[<uid>]] of exo__BooleanProperty ⊑ exo__ObjectProperty ⊑ exo__Property is accepted", async () => {
    await withVault(
      {
        "flow/def.md": DEF_FM(`[[${BOOLEAN_UID}]]`),
        [`exo/${BOOLEAN_UID}.md`]: CLASS_FM(BOOLEAN_UID, "exo__BooleanProperty", `[[${OBJECT_PROPERTY_UID}]]`),
        [`exo/${OBJECT_PROPERTY_UID}.md`]: CLASS_FM(OBJECT_PROPERTY_UID, "exo__ObjectProperty", `[[${PROPERTY_UID}]]`),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          `${XSD_NS}integer`,
        ]);
      },
    );
  });

  /**
   * Loader parity (§A40): the SAME files through NoteToRDFConverter + loadFromRDFGraph
   * and through loadFromVaultFS must yield the same shape. Returns both.
   */
  async function parityShapes(files: Record<string, string>): Promise<{ viaGraph: unknown; viaFS: unknown }> {
    const { NoteToRDFConverter } = await import("../../src/services/NoteToRDFConverter");
    const { InMemoryTripleStore } = await import(
      "../../src/infrastructure/rdf/InMemoryTripleStore"
    );
    // Frontmatter as Obsidian's metadataCache would hand it to the converter.
    const parseFm = (content: string): Record<string, unknown> => {
      const fm: Record<string, unknown> = {};
      let key: string | null = null;
      for (const line of content.split("\n").slice(1)) {
        if (line === "---") break;
        const item = /^ {2}- "?(.*?)"?$/.exec(line);
        if (item && key) {
          (fm[key] as string[]).push(item[1]);
          continue;
        }
        const kv = /^([^:]+):\s*(.*)$/.exec(line);
        if (!kv) continue;
        key = kv[1];
        fm[key] = kv[2] === "" ? [] : kv[2].replace(/^"|"$/g, "");
      }
      return fm;
    };
    const byPath = new Map(Object.entries(files).map(([rel, c]) => [rel, parseFm(c)]));
    const fileOf = (rel: string) => ({
      path: rel,
      basename: path.basename(rel, ".md"),
      extension: "md",
      name: path.basename(rel),
      parent: null,
    });
    const mockVault = {
      getFrontmatter: jest.fn((f: { path: string }) => byPath.get(f.path)),
      getAllFiles: jest.fn().mockReturnValue([]),
      read: jest.fn().mockResolvedValue(""),
      // `[[<uid>]]` resolves to the UID-named class file, as in a live vault.
      getFirstLinkpathDest: jest.fn((link: string) => {
        const rel = [...byPath.keys()].find((p) => path.basename(p, ".md") === link);
        return rel ? fileOf(rel) : null;
      }),
    } as unknown as ConstructorParameters<typeof NoteToRDFConverter>[0];
    const converter = new NoteToRDFConverter(mockVault);
    const store = new InMemoryTripleStore();
    for (const rel of byPath.keys()) {
      await store.addAll(
        await converter.convertNote(fileOf(rel) as Parameters<typeof converter.convertNote>[0]),
      );
    }
    const viaGraph = (await ShapeLoader.loadFromRDFGraph(store)).get(PROPERTY_IRI);
    let viaFS: unknown;
    await withVault(files, async (dir) => {
      viaFS = (await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI);
    });
    return { viaGraph, viaFS };
  }

  it("P1 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loader parity: the SAME three files (DatatypeProperty-only def + its two class files) yield the SAME shape via loadFromRDFGraph (through NoteToRDFConverter) and via loadFromVaultFS — and so does an exo__Property def (no churn on the previous form)", async () => {
    const { viaGraph, viaFS } = await parityShapes({
      "flow/9d2f1a11-0000-4000-8000-000000000001.md": DEF_FM(`[[${DATATYPE_UID}]]`),
      [`exo/${DATATYPE_UID}.md`]: CLASS_FM(DATATYPE_UID, "exo__DatatypeProperty", `[[${PROPERTY_UID}]]`),
      [`exo/${PROPERTY_UID}.md`]: CLASS_FM(PROPERTY_UID, "exo__Property", "[[493c2ae2-de56-47ec-954d-2eb8cb49bff7]]"),
    });
    expect(viaFS).toBeDefined();
    expect(viaGraph).toBeDefined();
    expect(viaGraph).toEqual(viaFS);
    expect((viaFS as Shape).range).toEqual([`${XSD_NS}integer`]);
    expect((viaFS as Shape).minCount).toBe(1);
    expect((viaFS as Shape).cardinality).toBe("Single");

    // The pre-change form: a def typed exo__Property, no class files at all.
    const legacy = await parityShapes({
      "flow/9d2f1a11-0000-4000-8000-000000000001.md": DEF_FM("[[exo__Property]]"),
    });
    expect(legacy.viaFS).toBeDefined();
    expect(legacy.viaGraph).toEqual(legacy.viaFS);
    expect(legacy.viaGraph).toEqual(viaFS);
  });

  it("P2 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 loader parity on the ObjectProperty subtree: a def typed [[<uid>]] of exo__BooleanProperty ⊑ exo__ObjectProperty ⊑ exo__Property yields the SAME shape via both loaders", async () => {
    const { viaGraph, viaFS } = await parityShapes({
      "flow/9d2f1a11-0000-4000-8000-000000000001.md": DEF_FM(`[[${BOOLEAN_UID}]]`),
      [`exo/${BOOLEAN_UID}.md`]: CLASS_FM(BOOLEAN_UID, "exo__BooleanProperty", `[[${OBJECT_PROPERTY_UID}]]`),
      [`exo/${OBJECT_PROPERTY_UID}.md`]: CLASS_FM(OBJECT_PROPERTY_UID, "exo__ObjectProperty", `[[${PROPERTY_UID}]]`),
      [`exo/${PROPERTY_UID}.md`]: CLASS_FM(PROPERTY_UID, "exo__Property", "[[493c2ae2-de56-47ec-954d-2eb8cb49bff7]]"),
    });
    expect(viaFS).toBeDefined();
    expect(viaGraph).toBeDefined();
    expect(viaGraph).toEqual(viaFS);
    expect((viaFS as Shape).range).toEqual([`${XSD_NS}integer`]);
  });

  // ── ticket 32d44596: pure-UID domain / range ──────────────────────────────
  //
  // After RFC-004 strip-canon a domain/range names its class by bare UID
  // (`[[1b20a8f0-…]]`), which no branch of wikilinkToIRI could parse — the
  // value resolved to null, `domain` came out empty and registerCandidate
  // dropped the whole def silently. The fix indexes `uid → symbolic label`
  // during the SAME scanDir pass and consults it LAST.

  const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
  const TASK_IRI = `${EMS}Task`;

  /** A def typed `exo__Property` (needs no class files) with a configurable domain/range. */
  const V_DEF = (domainValue: string, rangeLine = 'exo__Property_range: "xsd:integer"') =>
    [
      "---",
      "exo__Asset_uid: 9d2f1a11-0000-4000-8000-000000000001",
      "exo__Instance_class:",
      '  - "[[exo__Property]]"',
      "exo__Asset_label: flow__Stage_order",
      "exo__Property_domain:",
      `  - "${domainValue}"`,
      rangeLine,
      'exo__Property_cardinality: "[[59a37aa7-ffbe-4e0d-ba60-06ae370d880f]]"',
      "---",
      "",
    ].join("\n");

  it("V1 @req:94b302e0-eecd-4809-a5b1-0d1677c38d9c loadFromVaultFS: a bare-UID exo__Property_domain [[1b20a8f0-…]] (the RFC-004 strip-canon form) resolves through the uid → label index the same pass collects, so the def registers instead of being dropped", async () => {
    await withVault(
      {
        "flow/def.md": V_DEF(`[[${TASK_UID}]]`),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        const shape = (await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI);
        expect(shape).toBeDefined();
        expect(shape!.domain).toEqual([TASK_IRI]);
        expect(shape!.range).toEqual([`${XSD_NS}integer`]);
        expect(shape!.cardinality).toBe("Multiple");
      },
    );
  });

  it("V2 @req:94b302e0-eecd-4809-a5b1-0d1677c38d9c loadFromVaultFS: when the alias half of [[<uid>|alias]] does not parse as <prefix>__<Local>, the UID half still resolves the domain", async () => {
    await withVault(
      {
        "flow/def.md": V_DEF(`[[${TASK_UID}|Some Human Label]]`),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
  });

  it("V3 @req:94b302e0-eecd-4809-a5b1-0d1677c38d9c loadFromVaultFS: registration waits for the index to be COMPLETE — the def resolves even when its class file is visited AFTER it in scan order (this is what makes the single-pass design correct)", async () => {
    // scanDir sorts entries by name, so `a-flow/` is walked before `z-ems/`:
    // the def is collected while the index still lacks its class.
    await withVault(
      {
        "a-flow/def.md": V_DEF(`[[${TASK_UID}]]`),
        [`z-ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
    // Control: the opposite order must behave identically.
    await withVault(
      {
        "z-flow/def.md": V_DEF(`[[${TASK_UID}]]`),
        [`a-ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
  });

  it("V4 @req:94b302e0-eecd-4809-a5b1-0d1677c38d9c loadFromVaultFS: negative controls — a multi-word class label is NOT indexed (parity with buildUidClassIndex), an unknown UID stays unresolved, and the label form keeps resolving with no class file at all", async () => {
    const DEPRECATED_UID = "14cbc15d-bd94-4146-864e-e17273226c34";
    // A real live shape: `concept__Definition (DEPRECATED)` — the graph-side
    // index skips whitespace labels too, so this is parity, not a gap.
    await withVault(
      {
        "flow/def.md": V_DEF(`[[${DEPRECATED_UID}]]`),
        [`c/${DEPRECATED_UID}.md`]: CLASS_FM(
          DEPRECATED_UID,
          "concept__Definition (DEPRECATED)",
          "[[exo__Asset]]",
        ),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)).toBeUndefined();
      },
    );
    // No file carries that UID at all.
    await withVault({ "flow/def.md": V_DEF(`[[${TASK_UID}]]`) }, async (dir) => {
      expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)).toBeUndefined();
    });
    // The index is keyed by UID ONLY — mirroring buildUidClassIndex, which keys
    // by the UUID it extracts from a file IRI. Naming a class through a
    // non-UID filename stem must NOT resolve, or the fallback would quietly
    // widen into a filename resolver.
    await withVault(
      {
        "flow/def.md": V_DEF("[[task-notes]]"),
        "ems/task-notes.md": CLASS_FM(null, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)).toBeUndefined();
      },
    );
    // The pre-change label form is untouched — the index is consulted only
    // after labelToIRI has already failed.
    await withVault({ "flow/def.md": V_DEF("[[ems__Task]]") }, async (dir) => {
      expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
        TASK_IRI,
      ]);
    });
  });

  it("V5 @req:94b302e0-eecd-4809-a5b1-0d1677c38d9c loadFromVaultFS: exo__Property_range takes the SAME fallback as the domain (loadFromRDFGraph canonicalizes both positions), and a CURIE range is unaffected", async () => {
    await withVault(
      {
        "flow/def.md": V_DEF(`[[${TASK_UID}]]`, `exo__Property_range: "[[${TASK_UID}]]"`),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          TASK_IRI,
        ]);
      },
    );
    // Control: the CURIE form still wins before the index is ever consulted.
    await withVault(
      {
        "flow/def.md": V_DEF(`[[${TASK_UID}]]`),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.range).toEqual([
          `${XSD_NS}integer`,
        ]);
      },
    );
  });

  it("V6 @req:94b302e0-eecd-4809-a5b1-0d1677c38d9c loader parity: the SAME files yield deep-equal shapes via loadFromRDFGraph and loadFromVaultFS when BOTH the domain and the range are bare-UID wikilinks", async () => {
    const { viaGraph, viaFS } = await parityShapes({
      "flow/9d2f1a11-0000-4000-8000-000000000001.md": V_DEF(
        `[[${TASK_UID}]]`,
        `exo__Property_range: "[[${TASK_UID}]]"`,
      ),
      [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
    });
    expect(viaFS).toBeDefined();
    expect(viaGraph).toBeDefined();
    expect(viaGraph).toEqual(viaFS);
    expect((viaFS as Shape).domain).toEqual([TASK_IRI]);
    expect((viaFS as Shape).range).toEqual([TASK_IRI]);
  });

  it("V7 @req:94b302e0-eecd-4809-a5b1-0d1677c38d9c loadFromVaultFS: the index is keyed by BOTH a quoted exo__Asset_uid and a UID-named filename stem, and the first label seen for a uid wins", async () => {
    // Key 1 — quoted uid on a legacy label-named file (the quotes must not
    // become part of the key).
    await withVault(
      {
        "flow/def.md": V_DEF(`[[${TASK_UID}]]`),
        "ems/ems__Task.md": CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]").replace(
          `exo__Asset_uid: ${TASK_UID}`,
          `exo__Asset_uid: "${TASK_UID}"`,
        ),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
    // Key 2 — UID-named file with NO exo__Asset_uid field: only the stem can key it.
    await withVault(
      {
        "flow/def.md": V_DEF(`[[${TASK_UID}]]`),
        [`ems/${TASK_UID}.md`]: CLASS_FM(null, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
    // First-wins: a second file claiming the same uid under a different label
    // must not displace the first one in scan order.
    await withVault(
      {
        "flow/def.md": V_DEF(`[[${TASK_UID}]]`),
        [`a-ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
        "z-ems/other.md": CLASS_FM(TASK_UID, "ems__Project", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
  });

  it("V8 @req:94b302e0-eecd-4809-a5b1-0d1677c38d9c loadFromVaultFS: an unusable label must not RESERVE a uid key — under first-wins a file carrying one would otherwise poison the entry and make the real class file lose, which is the asymmetry the graph-side buildUidClassIndex avoids by only setting a key once its classIRI resolved", async () => {
    // Class files precede the def in scan order on purpose: this axis isolates
    // KEY POISONING, not scan-order completeness (that is V3, and M8 must redden
    // V3 alone).
    // Two files share one exo__Asset_uid; the one visited FIRST carries a label
    // that can never yield an IRI. The admission guards must drop it before the
    // key is taken, so the real class file still wins the entry.
    await withVault(
      {
        "a-broken/x.md": CLASS_FM(TASK_UID, "not-a-key", "[[exo__Asset]]"),
        [`b-ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
        "z-flow/def.md": V_DEF(`[[${TASK_UID}]]`),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
    // Same shape, but the poisoning label is multi-word — the other admission
    // guard. `labelToIRI` would reject it on lookup, yet the damage is done at
    // WRITE time: the key is already spent.
    await withVault(
      {
        "a-broken/x.md": CLASS_FM(TASK_UID, "ems__Task (DEPRECATED)", "[[exo__Asset]]"),
        [`b-ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
        "z-flow/def.md": V_DEF(`[[${TASK_UID}]]`),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
  });

  // ── ticket efe993e1: a QUOTED exo__Asset_label ───────────────────────────
  //
  // parseFrontmatter keeps a value verbatim, quotes included, so a definition
  // written `exo__Asset_label: "flow__Stage_order"` used to reach labelToIRI
  // with the quotes still attached, fail `<prefix>__<Local>` parsing and get
  // dropped BEFORE the domain was parsed. registerCandidate now applies the
  // same strip the rest of the file already applies.

  const REQ_Q = "@req:78c46697-6d6f-4ad3-8c98-f8f3b3507231";

  /** A def typed `exo__Property` whose label line is given verbatim. */
  const B_DEF = (labelLine: string, uid = "9d2f1a11-0000-4000-8000-000000000001") =>
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      "exo__Instance_class:",
      '  - "[[exo__Property]]"',
      ...(labelLine ? [labelLine] : []),
      "exo__Property_domain:",
      `  - "[[${TASK_UID}]]"`,
      'exo__Property_range: "xsd:integer"',
      'exo__Property_cardinality: "[[59a37aa7-ffbe-4e0d-ba60-06ae370d880f]]"',
      "---",
      "",
    ].join("\n");

  it(`B1 ${REQ_Q} loadFromVaultFS: a DOUBLE-quoted exo__Asset_label registers the shape — the quotes are stripped before labelToIRI, so the definition is no longer dropped ahead of the domain`, async () => {
    await withVault(
      {
        "flow/def.md": B_DEF('exo__Asset_label: "flow__Stage_order"'),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        const shape = (await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI);
        expect(shape).toBeDefined();
        expect(shape!.propertyIRI).toBe(PROPERTY_IRI);
        expect(shape!.domain).toEqual([TASK_IRI]);
        expect(shape!.range).toEqual([`${XSD_NS}integer`]);
        expect(shape!.cardinality).toBe("Multiple");
      },
    );
  });

  it(`B2 ${REQ_Q} loadFromVaultFS: a SINGLE-quoted label registers identically — the stripped character class covers the apostrophe as well as the double quote`, async () => {
    await withVault(
      {
        "flow/def.md": B_DEF("exo__Asset_label: 'flow__Stage_order'"),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        const shape = (await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI);
        expect(shape).toBeDefined();
        expect(shape!.domain).toEqual([TASK_IRI]);
        expect(shape!.range).toEqual([`${XSD_NS}integer`]);
      },
    );
  });

  it(`B3 ${REQ_Q} loadFromVaultFS: the UNQUOTED path is a CONTROL — a bare label registers against LITERAL expectations with no reference to the quoted sibling, so it stays green even when the strip is removed entirely`, async () => {
    const OTHER_IRI = "https://exocortex.my/ontology/flow#Stage_other";
    await withVault(
      {
        "flow/bare.md": B_DEF(
          "exo__Asset_label: flow__Stage_other",
          "9d2f1a11-0000-4000-8000-000000000002",
        ),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        const bare = (await ShapeLoader.loadFromVaultFS(dir)).get(OTHER_IRI);
        expect(bare).toBeDefined();
        expect(bare!.propertyIRI).toBe(OTHER_IRI);
        expect(bare!.domain).toEqual([TASK_IRI]);
        expect(bare!.range).toEqual([`${XSD_NS}integer`]);
        expect(bare!.cardinality).toBe("Multiple");
      },
    );
  });

  it(`B3b ${REQ_Q} loadFromVaultFS: a quoted and a bare label in the SAME vault yield shapes identical in every field but the propertyIRI — this one covers the QUOTED side too, so it legitimately reddens with B1/B2 (the pure control is B3)`, async () => {
    const OTHER_IRI = "https://exocortex.my/ontology/flow#Stage_other";
    await withVault(
      {
        "flow/quoted.md": B_DEF('exo__Asset_label: "flow__Stage_order"'),
        "flow/bare.md": B_DEF(
          "exo__Asset_label: flow__Stage_other",
          "9d2f1a11-0000-4000-8000-000000000002",
        ),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        const reg = await ShapeLoader.loadFromVaultFS(dir);
        const quoted = reg.get(PROPERTY_IRI);
        const bare = reg.get(OTHER_IRI);
        expect(bare).toBeDefined();
        expect(quoted).toBeDefined();
        // Strip the only field that is meant to differ and compare the rest.
        expect({ ...quoted!, propertyIRI: "" }).toEqual({ ...bare!, propertyIRI: "" });
      },
    );
  });

  it(`B4 ${REQ_Q} loadFromVaultFS: the basename fallback is untouched — a definition with NO exo__Asset_label still registers through its filename stem, which cannot carry surrounding quotes`, async () => {
    await withVault(
      {
        "flow/flow__Stage_order.md": B_DEF(""),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        expect((await ShapeLoader.loadFromVaultFS(dir)).get(PROPERTY_IRI)?.domain).toEqual([
          TASK_IRI,
        ]);
      },
    );
  });

  it(`B5 ${REQ_Q} loadFromVaultFS: stripping quotes does NOT widen admission — a quoted HUMAN label still registers nothing, because what is left after the quotes is multi-word, exactly as the graph side rejects it`, async () => {
    await withVault(
      {
        "flow/def.md": B_DEF('exo__Asset_label: "Some Human Label"'),
        [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
      },
      async (dir) => {
        const reg = await ShapeLoader.loadFromVaultFS(dir);
        expect(reg.get(PROPERTY_IRI)).toBeUndefined();
        expect(reg.size).toBe(0);
      },
    );
  });

  it(`B6 ${REQ_Q} loader parity: the SAME files yield deep-equal shapes via loadFromRDFGraph and loadFromVaultFS when the label is a quoted scalar — the graph side always saw the bare label (YAML strips the quotes before NoteToRDFConverter), so this restores parity rather than introducing a divergence`, async () => {
    const { viaGraph, viaFS } = await parityShapes({
      "flow/def.md": B_DEF('exo__Asset_label: "flow__Stage_order"'),
      [`ems/${TASK_UID}.md`]: CLASS_FM(TASK_UID, "ems__Task", "[[exo__Asset]]"),
    });
    expect(viaFS).toBeDefined();
    expect(viaGraph).toBeDefined();
    expect(viaGraph).toEqual(viaFS);
  });
});

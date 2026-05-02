import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { ShapeLoader } from "../../src/services/ShapeLoader";
import { ShapeRegistry } from "../../src/services/ShapeRegistry";
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

  it("handles property with unknown label prefix (non-namespaced) — skips", async () => {
    const triples = [
      makeTriple(FILE_IRI, RDF_TYPE, OBJ_PROP_TYPE),
      makeTriple(FILE_IRI, RDFS_DOMAIN, `${EMS}Effort`),
      makeTriple(FILE_IRI, EXO_LABEL, { literal: "unknown__something" }),
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

  it("ignores range wikilink with unrecognized prefix (no IRI produced)", async () => {
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
    // range value with unknown prefix → wikilinkToIRI returns null → shape.range = undefined
    expect(shape).toBeDefined();
    expect(shape!.range).toBeUndefined();
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
});

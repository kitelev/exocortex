/**
 * Integration test: RFC v2 Phase 3b — CommandResolver → GroundingExecutor pipeline.
 *
 * Verifies the end-to-end handoff between Phase 3a parser output (`propertyDefault`
 * + `inheritanceRule` arrays on GroundingDefinition) and the Phase 3b executor's
 * 5-step precedence pipeline. Mirrors the Grounding `a6ef8fda-…` topology used
 * in production (Create Task under Area):
 *
 *   - PropertyDefault: `ems__Effort_status = "[[<EffortStatusDraft-UID>]]"`
 *   - InheritanceRule #1: `exo__Asset_uid → ems__Effort_area`,
 *       condition `ems__Area`, priority 100
 *   - InheritanceRule #2: `exo__Asset_uid → ems__Effort_parent`,
 *       exclusion `ems__Area`, priority 50
 *   - InheritanceRule #3: `exo__Asset_isDefinedBy → exo__Asset_isDefinedBy`,
 *       unconditional, priority 10
 *
 * Two scenarios:
 *   1. Target IS an `ems__Area` → resolved frontmatter has `ems__Effort_area`
 *      set to the target's UID, NO `ems__Effort_parent`.
 *   2. Target is a Project (NOT Area) → frontmatter has `ems__Effort_parent`,
 *      NO `ems__Effort_area`.
 *
 * Both scenarios MUST emit `ems__Effort_status = "[[<EffortStatusDraft-UID>]]"`
 * — the BLACKLIST-bypassing PropertyDefault path — and inherit `isDefinedBy`
 * unconditionally.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../../src/interfaces/IFileSystemAdapter";

// ───────────────────────────────────────────────────────────────────────────
// In-memory fs adapter (mirrors grounding-resolve-execute.test.ts)
// ───────────────────────────────────────────────────────────────────────────

class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>();

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [p, c] of Object.entries(initial)) this.files.set(p, c);
    }
  }

  async readFile(p: string): Promise<string> {
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`File not found: ${p}`);
    return c;
  }
  async fileExists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async getMarkdownFiles(): Promise<string[]> {
    return Array.from(this.files.keys()).filter((p) => p.endsWith(".md"));
  }
  async createFile(p: string, c: string): Promise<string> {
    this.files.set(p, c);
    return p;
  }
  async updateFile(p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
  async writeFile(p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
  async deleteFile(p: string): Promise<void> {
    this.files.delete(p);
  }
  async renameFile(o: string, n: string): Promise<void> {
    const c = this.files.get(o);
    if (c !== undefined) {
      this.files.set(n, c);
      this.files.delete(o);
    }
  }
  listCreated(): string[] {
    return Array.from(this.files.keys());
  }
  getContent(p: string): string | undefined {
    return this.files.get(p);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Fixture UIDs — match production Grounding a6ef8fda's topology shape
// ───────────────────────────────────────────────────────────────────────────

// Classes (TBox)
const CLASS_AREA_UID = "82c74542-1b14-4217-b852-d84730484b25";
const CLASS_PROJECT_UID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const CLASS_TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

// Properties (TBox)
const PROP_ASSET_UID = "fada7446-b0a4-4100-88f4-6d4421c175fb"; // exo__Asset_uid
const PROP_EFFORT_AREA = "9be36e9d-de67-4ed2-90b0-99cdf103e9bf"; // ems__Effort_area
const PROP_EFFORT_PARENT = "6528ecfa-a03d-47f1-a819-9ba5fea8fc28"; // ems__Effort_parent
const PROP_EFFORT_STATUS = "44c6e9e3-955f-4afc-9ca5-b4bd70667051"; // ems__Effort_status
const PROP_ISDEFINEDBY = "179d6b59-c7fc-4bdf-a32f-ace630884a8c"; // exo__Asset_isDefinedBy

// Value assets
const STATUS_DRAFT_UID = "c42245d0-01de-4c35-bfcf-d910445ea28e";
const ONTOLOGY_KITELEV_UID = "60967c6a-4e8a-4ee3-8922-db98b981e4f4";

// Grounding + DeclarativeRule assets
const GROUNDING_UID = "a6ef8fda-addb-40c3-940c-fe55fd7e8500";
const COMMAND_UID = "cmd-create-task-instance-test";
const BINDING_UID_AREA = "bind-create-task-area";
const BINDING_UID_PROJECT = "bind-create-task-project";

const PD_STATUS_UID = "d9aa9bb8-5676-4ba2-ba5e-fc8d9df02250";
const IR_AREA_UID = "3f08f5a8-df11-47e7-8519-7d8d84175951";
const IR_PARENT_UID = "43731bae-78cb-4ffe-9eaa-4c258cb1c493";
const IR_ISDEFINEDBY_UID = "cbe000c4-b29a-4405-876d-790fb2296121";

// Targets (ABox)
const TARGET_AREA_UID = "905cc587-0000-0000-0000-000000000aaa";
const TARGET_AREA_PATH = `03 Knowledge/areas/${TARGET_AREA_UID}.md`;
const TARGET_AREA_IRI = `obsidian://vault/${encodeURI(TARGET_AREA_PATH)}`;

const TARGET_PROJECT_UID = "4ef4acc6-0000-0000-0000-000000000bbb";
const TARGET_PROJECT_PATH = `03 Knowledge/projects/${TARGET_PROJECT_UID}.md`;
const TARGET_PROJECT_IRI = `obsidian://vault/${encodeURI(TARGET_PROJECT_PATH)}`;

// ───────────────────────────────────────────────────────────────────────────
// Helpers: seed TBox + ABox into triple store
// ───────────────────────────────────────────────────────────────────────────

async function seedClass(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<void> {
  const iri = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(iri, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(iri, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
}

async function seedProperty(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<void> {
  const iri = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(iri, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(iri, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
}

async function seedValueAsset(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<void> {
  const iri = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(iri, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(iri, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
}

async function seedPropertyDefault(
  store: InMemoryTripleStore,
  opts: { uid: string; propertyRefUid: string; valueRefUid: string },
): Promise<void> {
  const iri = new IRI(`obsidian://vault/${opts.uid}.md`);
  await store.addAll([
    new Triple(
      iri,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("PropertyDefault"),
    ),
    new Triple(iri, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      iri,
      Namespace.EXOCMD.term("PropertyDefault_property"),
      new IRI(`obsidian://vault/${opts.propertyRefUid}.md`),
    ),
    new Triple(
      iri,
      Namespace.EXOCMD.term("PropertyDefault_value"),
      new IRI(`obsidian://vault/${opts.valueRefUid}.md`),
    ),
  ]);
}

async function seedInheritanceRule(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    sourcePropUid: string;
    targetPropUid: string;
    conditionClassUid?: string;
    exclusionClassUids?: string[];
    priority: number;
  },
): Promise<void> {
  const iri = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(
      iri,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("InheritanceRule"),
    ),
    new Triple(iri, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      iri,
      Namespace.EXOCMD.term("InheritanceRule_sourceProperty"),
      new IRI(`obsidian://vault/${opts.sourcePropUid}.md`),
    ),
    new Triple(
      iri,
      Namespace.EXOCMD.term("InheritanceRule_targetProperty"),
      new IRI(`obsidian://vault/${opts.targetPropUid}.md`),
    ),
    new Triple(
      iri,
      Namespace.EXOCMD.term("InheritanceRule_priority"),
      new Literal(String(opts.priority)),
    ),
  ];
  if (opts.conditionClassUid) {
    triples.push(
      new Triple(
        iri,
        Namespace.EXOCMD.term("InheritanceRule_targetClassCondition"),
        new IRI(`obsidian://vault/${opts.conditionClassUid}.md`),
      ),
    );
  }
  for (const exUid of opts.exclusionClassUids ?? []) {
    triples.push(
      new Triple(
        iri,
        Namespace.EXOCMD.term("InheritanceRule_targetClassExclusion"),
        new IRI(`obsidian://vault/${exUid}.md`),
      ),
    );
  }
  await store.addAll(triples);
}

async function seedGrounding(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    propertyDefaultRefs: string[];
    inheritanceRuleRefs: string[];
  },
): Promise<void> {
  const iri = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(iri, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(iri, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      iri,
      Namespace.EXO.term("Asset_label"),
      new Literal("Create TaskPrototype instance"),
    ),
    new Triple(
      iri,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal("[[4367e2d6-6c92-450a-becb-abce1fb07682]]"),
    ),
    new Triple(
      iri,
      Namespace.EXOCMD.term("Grounding_targetClass"),
      new Literal("ems__Task"),
    ),
    new Triple(
      iri,
      Namespace.EXOCMD.term("Grounding_targetFolder"),
      new Literal("03 Knowledge/inbox"),
    ),
  ];
  for (const ref of opts.propertyDefaultRefs) {
    triples.push(
      new Triple(
        iri,
        Namespace.EXOCMD.term("Grounding_propertyDefault"),
        new IRI(`obsidian://vault/${ref}.md`),
      ),
    );
  }
  for (const ref of opts.inheritanceRuleRefs) {
    triples.push(
      new Triple(
        iri,
        Namespace.EXOCMD.term("Grounding_inheritanceRule"),
        new IRI(`obsidian://vault/${ref}.md`),
      ),
    );
  }
  await store.addAll(triples);
}

async function seedCommandAndBindings(
  store: InMemoryTripleStore,
): Promise<void> {
  const cmd = new IRI(`obsidian://vault/${COMMAND_UID}.md`);
  const gnd = new IRI(`obsidian://vault/${GROUNDING_UID}.md`);
  await store.addAll([
    new Triple(cmd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmd, Namespace.EXO.term("Asset_uid"), new Literal(COMMAND_UID)),
    new Triple(
      cmd,
      Namespace.EXO.term("Asset_label"),
      new Literal("Create Task"),
    ),
    new Triple(cmd, Namespace.EXOCMD.term("Command_grounding"), gnd),
  ]);

  for (const [bindUid, targetClassLabel] of [
    [BINDING_UID_AREA, "ems__Area"],
    [BINDING_UID_PROJECT, "ems__Project"],
  ] as const) {
    const bind = new IRI(`obsidian://vault/${bindUid}.md`);
    await store.addAll([
      new Triple(
        bind,
        Namespace.RDF.term("type"),
        Namespace.EXOCMD.term("CommandBinding"),
      ),
      new Triple(bind, Namespace.EXO.term("Asset_uid"), new Literal(bindUid)),
      new Triple(bind, Namespace.EXOCMD.term("CommandBinding_command"), cmd),
      new Triple(
        bind,
        Namespace.EXOCMD.term("CommandBinding_targetClass"),
        new Literal(targetClassLabel),
      ),
    ]);
  }
}

function buildTargetMd(
  uid: string,
  classRefs: string[],
  extras: Record<string, string> = {},
): string {
  const classLines = classRefs.map((c) => `  - "[[${c}]]"`).join("\n");
  const extraLines = Object.entries(extras)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    "exo__Instance_class:",
    classLines,
    extraLines,
    "---",
    "Body",
  ].join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// Suite
// ───────────────────────────────────────────────────────────────────────────

describe("RFC v2 Phase 3b — CommandResolver → GroundingExecutor pipeline integration", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;
  let fs: InMemoryFileSystem;
  let executor: GroundingExecutor;

  /**
   * ClassLabelToUidResolver stub: maps the three class labels used in tests
   * to their UIDs so the executor's InheritanceRule class-match supports
   * UID-canon target wikilinks (matches production vault shape).
   */
  const classLabelToUid = (label: string): string | null => {
    if (label === "ems__Area") return CLASS_AREA_UID;
    if (label === "ems__Project") return CLASS_PROJECT_UID;
    if (label === "ems__Task") return CLASS_TASK_UID;
    return null;
  };

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
    fs = new InMemoryFileSystem();
    executor = new GroundingExecutor(fs, fs, new ServiceRegistry(), classLabelToUid);

    // Seed TBox
    await seedClass(store, CLASS_AREA_UID, "ems__Area");
    await seedClass(store, CLASS_PROJECT_UID, "ems__Project");
    await seedClass(store, CLASS_TASK_UID, "ems__Task");
    await seedProperty(store, PROP_ASSET_UID, "exo__Asset_uid");
    await seedProperty(store, PROP_EFFORT_AREA, "ems__Effort_area");
    await seedProperty(store, PROP_EFFORT_PARENT, "ems__Effort_parent");
    await seedProperty(store, PROP_EFFORT_STATUS, "ems__Effort_status");
    await seedProperty(store, PROP_ISDEFINEDBY, "exo__Asset_isDefinedBy");
    await seedValueAsset(store, STATUS_DRAFT_UID, "ems__EffortStatusDraft");
    await seedValueAsset(store, ONTOLOGY_KITELEV_UID, "kitelev");

    // Seed DeclarativeRule assets
    await seedPropertyDefault(store, {
      uid: PD_STATUS_UID,
      propertyRefUid: PROP_EFFORT_STATUS,
      valueRefUid: STATUS_DRAFT_UID,
    });
    await seedInheritanceRule(store, {
      uid: IR_AREA_UID,
      sourcePropUid: PROP_ASSET_UID,
      targetPropUid: PROP_EFFORT_AREA,
      conditionClassUid: CLASS_AREA_UID,
      priority: 100,
    });
    await seedInheritanceRule(store, {
      uid: IR_PARENT_UID,
      sourcePropUid: PROP_ASSET_UID,
      targetPropUid: PROP_EFFORT_PARENT,
      exclusionClassUids: [CLASS_AREA_UID],
      priority: 50,
    });
    await seedInheritanceRule(store, {
      uid: IR_ISDEFINEDBY_UID,
      sourcePropUid: PROP_ISDEFINEDBY,
      targetPropUid: PROP_ISDEFINEDBY,
      priority: 10,
    });

    // Seed Grounding + Command + Bindings
    await seedGrounding(store, {
      uid: GROUNDING_UID,
      propertyDefaultRefs: [PD_STATUS_UID],
      inheritanceRuleRefs: [IR_AREA_UID, IR_PARENT_UID, IR_ISDEFINEDBY_UID],
    });
    await seedCommandAndBindings(store);
  });

  it("@req:a863ecc1-9230-4457-880b-d3a18b33494f Area target: produces Task with Draft status + Effort_area set + no Effort_parent + isDefinedBy inherited", async () => {
    // Seed target Area asset (file + triples for resolver class-lookup).
    fs = new InMemoryFileSystem({
      [TARGET_AREA_PATH]: buildTargetMd(TARGET_AREA_UID, [CLASS_AREA_UID], {
        exo__Asset_isDefinedBy: `"[[${ONTOLOGY_KITELEV_UID}]]"`,
      }),
    });
    executor = new GroundingExecutor(fs, fs, new ServiceRegistry(), classLabelToUid);
    const targetIRI = new IRI(TARGET_AREA_IRI);
    await store.addAll([
      new Triple(
        targetIRI,
        Namespace.EXO.term("Asset_uid"),
        new Literal(TARGET_AREA_UID),
      ),
      new Triple(
        targetIRI,
        Namespace.EXO.term("Instance_class"),
        new Literal(`[[${CLASS_AREA_UID}]]`),
      ),
    ]);

    // Resolve grounding through the Command → CommandBinding path.
    const resolved = await resolver.resolveForAssetMulti(
      TARGET_AREA_IRI,
      ["ems__Area"],
      undefined,
    );
    expect(resolved.length).toBeGreaterThan(0);
    const grounding = resolved[0]!.command.grounding;
    // Parser produced typed ref-form outputs.
    expect(grounding.propertyDefault?.length).toBe(1);
    expect(grounding.propertyDefault?.[0]?.propertyName).toBe("ems__Effort_status");
    expect(grounding.inheritanceRule?.length).toBe(3);

    // Execute end-to-end.
    const result = await executor.execute(
      grounding,
      TARGET_AREA_IRI,
      TARGET_AREA_PATH,
      { label: "Buy groceries" },
    );
    expect(result.success).toBe(true);

    const createdPath = fs
      .listCreated()
      .find((p) => p !== TARGET_AREA_PATH && p.endsWith(".md"));
    expect(createdPath).toBeDefined();
    const content = fs.getContent(createdPath!)!;

    // PropertyDefault: status (BLACKLIST-bypassing).
    expect(content).toContain(`ems__Effort_status: "[[${STATUS_DRAFT_UID}]]"`);
    // InheritanceRule #1 (Area condition, prio 100): area = target UID.
    expect(content).toContain(`ems__Effort_area: "[[${TARGET_AREA_UID}]]"`);
    // InheritanceRule #2 (Area exclusion, prio 50): NOT applied.
    expect(content).not.toContain("ems__Effort_parent:");
    // InheritanceRule #3 (unconditional, prio 10): isDefinedBy inherited.
    expect(content).toContain(
      `exo__Asset_isDefinedBy: "[[${ONTOLOGY_KITELEV_UID}]]"`,
    );
    // Class is ems__Task (UID-canon when ClassLabelToUidResolver is wired).
    expect(content).toContain(`exo__Instance_class:`);
    expect(content).toMatch(
      new RegExp(`\\[\\[(ems__Task|${CLASS_TASK_UID})\\]\\]`),
    );
  });

  it("Project target: produces Task with Draft status + Effort_parent set + no Effort_area + isDefinedBy inherited", async () => {
    fs = new InMemoryFileSystem({
      [TARGET_PROJECT_PATH]: buildTargetMd(
        TARGET_PROJECT_UID,
        [CLASS_PROJECT_UID],
        {
          exo__Asset_isDefinedBy: `"[[${ONTOLOGY_KITELEV_UID}]]"`,
        },
      ),
    });
    executor = new GroundingExecutor(fs, fs, new ServiceRegistry(), classLabelToUid);
    const targetIRI = new IRI(TARGET_PROJECT_IRI);
    await store.addAll([
      new Triple(
        targetIRI,
        Namespace.EXO.term("Asset_uid"),
        new Literal(TARGET_PROJECT_UID),
      ),
      new Triple(
        targetIRI,
        Namespace.EXO.term("Instance_class"),
        new Literal(`[[${CLASS_PROJECT_UID}]]`),
      ),
    ]);

    const resolved = await resolver.resolveForAssetMulti(
      TARGET_PROJECT_IRI,
      ["ems__Project"],
      undefined,
    );
    expect(resolved.length).toBeGreaterThan(0);
    const grounding = resolved[0]!.command.grounding;

    const result = await executor.execute(
      grounding,
      TARGET_PROJECT_IRI,
      TARGET_PROJECT_PATH,
      { label: "Sub-task" },
    );
    expect(result.success).toBe(true);

    const createdPath = fs
      .listCreated()
      .find((p) => p !== TARGET_PROJECT_PATH && p.endsWith(".md"));
    expect(createdPath).toBeDefined();
    const content = fs.getContent(createdPath!)!;

    // PropertyDefault: status.
    expect(content).toContain(`ems__Effort_status: "[[${STATUS_DRAFT_UID}]]"`);
    // InheritanceRule #1 (Area condition NOT matched): NO area.
    expect(content).not.toContain("ems__Effort_area:");
    // InheritanceRule #2 (Area exclusion not matched): parent = target UID.
    expect(content).toContain(`ems__Effort_parent: "[[${TARGET_PROJECT_UID}]]"`);
    // InheritanceRule #3 (unconditional): isDefinedBy.
    expect(content).toContain(
      `exo__Asset_isDefinedBy: "[[${ONTOLOGY_KITELEV_UID}]]"`,
    );
  });
});

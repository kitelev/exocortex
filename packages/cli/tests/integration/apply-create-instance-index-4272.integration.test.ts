/**
 * #4272 — req 5ab3d237-cae9-498c-925c-6951b9c9c5db AC1 / AC3.
 *
 * Drives the REAL `applyCommand().parseAsync([...])` against a temp vault whose
 * create-instance grounding exercises every resolver `apply.ts` wires on the
 * index-backed adapter:
 *   - label-form `targetClass: "ems__Task"`            → classLabelToUid
 *   - `targetFolder: "$isDefinedByFolder"`              → refToFolder
 *   - inheritance rule conditioned on `[[ems__TaskPrototype]]` (label form)
 *     → classRefMatchesAny → classLabelToUid, a second rule conditioned on
 *     `[[ems__Task]]` that must NOT match the prototype target, and a third
 *     conditioned on `TaskProto` — an ALIAS-only name (no class has it as a
 *     label) so the resolver's alias pass runs; the target prototype carries
 *     that alias and every noise instance INHERITS it through the prototype
 *     chain (`exo__Asset_prototype`) once `index` materialises the inferred
 *     layer into the cache
 * plus N = 60 unrelated assets that the scan would read on every lookup — and
 * that an index built from the store (explicit + inferred in one default
 * graph, the CLI's shape) would read on the alias lookup.
 *
 * Axes (mutant-driver key: `› (I\d+\w*) `):
 *   I1  apply reads only the files it is about: `getMarkdownFiles` (the scan's
 *       first step) is never called, no unrelated asset's frontmatter is read,
 *       total frontmatter reads are bounded by targets + refs — AND the
 *       resolvers actually resolved (UID-form class, co-located folder,
 *       inherited isDefinedBy, non-inherited area); I1c the same under
 *       --use-cache on a cache `index` built WITH the inferred layer (AC4:
 *       the 60 inherited aliases must not become candidates)
 *   I2  the three core resolver factories return the same answer on the
 *       indexed adapter as on the plain NodeFsAdapter for the grounding's own
 *       inputs (label / isDefinedBy ref / alias), i.e. the create's inputs are
 *       byte-identical by construction
 */
import "reflect-metadata";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  NoteToRDFConverter,
  createVaultFrontmatterClassLabelResolver,
  createVaultFrontmatterRefToFolderResolver,
  createVaultFrontmatterRefToFrontmatterResolver,
} from "@kitelev/exocortex-core";
import { NodeFsAdapter } from "../../src/adapters/NodeFsAdapter.js";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";
import { TripleStoreIndexedFsAdapter } from "../../src/adapters/TripleStoreIndexedFsAdapter.js";

const { applyCommand } = await import("../../src/commands/apply.js");
const { sparqlIndexCommand } = await import("../../src/commands/sparql-index.js");

const COMMAND_UID = "dddddddd-4272-4000-8000-000000000001";
const GROUNDING_UID = "dddddddd-4272-4000-8000-000000000002";
const TARGET_UID = "dddddddd-4272-4000-8000-000000000003";
const ONTO_UID = "dddddddd-4272-4000-8000-000000000004";
const AREA_UID = "dddddddd-4272-4000-8000-000000000005";
const RULE_ISDEFINEDBY_UID = "dddddddd-4272-4000-8000-000000000006";
const RULE_AREA_UID = "dddddddd-4272-4000-8000-000000000007";
const PROP_ISDEFINEDBY_UID = "dddddddd-4272-4000-8000-000000000008";
const PROP_AREA_UID = "dddddddd-4272-4000-8000-000000000009";
const CLASS_TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // canonical ems__Task
const CLASS_PROTO_UID = "dddddddd-4272-4000-8000-00000000000a";
const RULE_PROTO_ALIAS_UID = "dddddddd-4272-4000-8000-00000000000b";
const PROP_LABEL_UID = "dddddddd-4272-4000-8000-00000000000c";
const GT_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";
const SEED = "99999999-8888-7777-6666-555555555555";
const FROZEN_CLOCK = "2026-01-01T00:00:00Z";
const NOISE_COUNT = 60;

const fm = (...lines: string[]) => ["---", ...lines, "---", ""].join("\n");

function seedVault(root: string): void {
  const w = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content, "utf-8");
  };
  w(
    `tbox/${CLASS_TASK_UID}.md`,
    fm(
      `exo__Asset_uid: ${CLASS_TASK_UID}`,
      `exo__Asset_label: ems__Task`,
      `aliases:`,
      `  - ems__Task`,
      `  - Task`,
      `exo__Instance_class:`,
      `  - "[[exo__Class]]"`,
    ),
  );
  w(
    `tbox/${CLASS_PROTO_UID}.md`,
    fm(
      `exo__Asset_uid: ${CLASS_PROTO_UID}`,
      `exo__Asset_label: ems__TaskPrototype`,
      `exo__Instance_class:`,
      `  - "[[exo__Class]]"`,
    ),
  );
  w(
    `tbox/${PROP_ISDEFINEDBY_UID}.md`,
    fm(
      `exo__Asset_uid: ${PROP_ISDEFINEDBY_UID}`,
      `exo__Asset_label: exo__Asset_isDefinedBy`,
      `exo__Instance_class:`,
      `  - "[[exo__Property]]"`,
    ),
  );
  w(
    `tbox/${PROP_AREA_UID}.md`,
    fm(
      `exo__Asset_uid: ${PROP_AREA_UID}`,
      `exo__Asset_label: ems__Effort_area`,
      `exo__Instance_class:`,
      `  - "[[exo__Property]]"`,
    ),
  );
  w(
    `tbox/${PROP_LABEL_UID}.md`,
    fm(
      `exo__Asset_uid: ${PROP_LABEL_UID}`,
      `exo__Asset_label: exo__Asset_label`,
      `exo__Instance_class:`,
      `  - "[[exo__Property]]"`,
    ),
  );
  // Rule 3: conditioned on an ALIAS-only name — the label pass misses, the alias pass runs.
  // The target prototype carries the alias, so the rule does not apply to it either way
  // (its own uid is not one of its classes); the axis is in WHICH files the alias pass reads.
  w(
    `cmd/${RULE_PROTO_ALIAS_UID}.md`,
    fm(
      `exo__Asset_uid: ${RULE_PROTO_ALIAS_UID}`,
      `exo__Asset_label: "Inherit label when the target is a TaskProto"`,
      `exo__Instance_class:`,
      `  - "[[exocmd__InheritanceRule]]"`,
      `exocmd__InheritanceRule_sourceProperty: "[[${PROP_LABEL_UID}]]"`,
      `exocmd__InheritanceRule_targetProperty: "[[${PROP_LABEL_UID}]]"`,
      `exocmd__InheritanceRule_priority: 30`,
      // Bare (not a wikilink): a `[[TaskProto]]` link would be RESOLVED by the converter
      // through the prototype's alias to the prototype file and arrive as its label.
      `exocmd__InheritanceRule_targetClassCondition: TaskProto`,
    ),
  );
  // Ontology anchor — the created instance must be co-located in THIS folder.
  // Deliberately a LOADER-SKIPPED asset (an optional property present but empty
  // is an invariant violation, two-phase commit #2997): it has no triples in
  // the store or the cache, so `$isDefinedByFolder` resolves to `onto` ONLY
  // because the loader hands the adapter its `zeroTriplePaths` (HIGH-1 of the
  // orchestrator review; the scan would have found it all along).
  w(
    `onto/${ONTO_UID}.md`,
    fm(
      `exo__Asset_uid: ${ONTO_UID}`,
      `exo__Asset_label: "My efforts ontology"`,
      `ems__Effort_parent:`,
      `exo__Instance_class:`,
      `  - "[[exo__Ontology]]"`,
    ),
  );
  w(
    `areas/${AREA_UID}.md`,
    fm(
      `exo__Asset_uid: ${AREA_UID}`,
      `exo__Asset_label: "Some area"`,
      `exo__Instance_class:`,
      `  - "[[ems__Area]]"`,
    ),
  );
  // Rule 1: copy isDefinedBy from the target IFF the target is an ems__TaskPrototype (label-form condition).
  w(
    `cmd/${RULE_ISDEFINEDBY_UID}.md`,
    fm(
      `exo__Asset_uid: ${RULE_ISDEFINEDBY_UID}`,
      `exo__Asset_label: "Inherit isDefinedBy from prototype"`,
      `exo__Instance_class:`,
      `  - "[[exocmd__InheritanceRule]]"`,
      `exocmd__InheritanceRule_sourceProperty: "[[${PROP_ISDEFINEDBY_UID}]]"`,
      `exocmd__InheritanceRule_targetProperty: "[[${PROP_ISDEFINEDBY_UID}]]"`,
      `exocmd__InheritanceRule_priority: 50`,
      `exocmd__InheritanceRule_targetClassCondition: "[[ems__TaskPrototype]]"`,
    ),
  );
  // Rule 2: copy area IFF the target is an ems__Task (label-form) — the prototype is NOT one.
  w(
    `cmd/${RULE_AREA_UID}.md`,
    fm(
      `exo__Asset_uid: ${RULE_AREA_UID}`,
      `exo__Asset_label: "Inherit area from a task"`,
      `exo__Instance_class:`,
      `  - "[[exocmd__InheritanceRule]]"`,
      `exocmd__InheritanceRule_sourceProperty: "[[${PROP_AREA_UID}]]"`,
      `exocmd__InheritanceRule_targetProperty: "[[${PROP_AREA_UID}]]"`,
      `exocmd__InheritanceRule_priority: 40`,
      `exocmd__InheritanceRule_targetClassCondition: "[[ems__Task]]"`,
    ),
  );
  w(
    `cmd/${GROUNDING_UID}.md`,
    fm(
      `exo__Asset_uid: ${GROUNDING_UID}`,
      `exo__Asset_label: "Create task instance grounding (4272)"`,
      `exo__Instance_class:`,
      `  - "[[exocmd__Grounding]]"`,
      `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
      `exocmd__Grounding_targetClass: "ems__Task"`,
      `exocmd__Grounding_targetFolder: "$isDefinedByFolder"`,
      `exocmd__Grounding_inheritanceRule:`,
      `  - "[[${RULE_ISDEFINEDBY_UID}]]"`,
      `  - "[[${RULE_AREA_UID}]]"`,
      `  - "[[${RULE_PROTO_ALIAS_UID}]]"`,
    ),
  );
  w(
    `cmd/${COMMAND_UID}.md`,
    fm(
      `exo__Asset_uid: ${COMMAND_UID}`,
      `exo__Asset_label: "Create task instance (4272)"`,
      `exo__Instance_class:`,
      `  - "[[exocmd__Command]]"`,
      `exocmd__Command_grounding: "[[${GROUNDING_UID}]]"`,
      `exocmd__Command_successMessage: "Created"`,
    ),
  );
  w(
    `proto/${TARGET_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${TARGET_UID}`,
      `exo__Asset_label: "Breakfast prototype"`,
      `aliases:`,
      `  - TaskProto`,
      `exo__Asset_isDefinedBy: "[[${ONTO_UID}]]"`,
      `ems__Effort_area: "[[${AREA_UID}]]"`,
      `exo__Instance_class:`,
      `  - "[[${CLASS_PROTO_UID}]]"`,
      "---",
      "",
      "body",
      "",
    ].join("\n"),
  );
  for (let i = 0; i < NOISE_COUNT; i++) {
    const uid = `eeeeeeee-4272-4000-8000-${String(i).padStart(12, "0")}`;
    w(
      `noise/${uid}.md`,
      fm(
        `exo__Asset_uid: ${uid}`,
        `exo__Asset_label: "Unrelated asset ${i}"`,
        // Instances of the target prototype with NO aliases of their own: `index`
        // materialises the prototype's `TaskProto` alias onto every one of them
        // (inferred layer — own values are never overridden, missing ones inherit).
        `exo__Asset_prototype: "[[${TARGET_UID}]]"`,
        `exo__Instance_class:`,
        `  - "[[${CLASS_TASK_UID}]]"`,
      ),
    );
  }
}

describe("#4272 apply create-instance resolvers answer from the store index (req 5ab3d237)", () => {
  let root: string;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-apply-index-4272-"));
    seedVault(root);
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function runApply(extra: string[] = []): Promise<void> {
    const cmd = applyCommand();
    const args = [
      "node",
      "apply",
      COMMAND_UID,
      `proto/${TARGET_UID}.md`,
      "--vault",
      root,
      "--input",
      JSON.stringify({ label: "Breakfast instance" }),
      "--seed",
      SEED,
      "--frozen-clock",
      FROZEN_CLOCK,
      ...extra,
    ];
    try {
      await cmd.parseAsync(args);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  function createdIn(dir: string): string[] {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) return [];
    return fs
      .readdirSync(full)
      .filter((f) => f.endsWith(".md") && !f.startsWith(ONTO_UID) && !f.startsWith(TARGET_UID));
  }

  async function assertCreateReadsOnlyItsFiles(extra: string[]): Promise<string> {
    const walk = jest.spyOn(NodeFsAdapter.prototype, "getMarkdownFiles");
    const meta = jest.spyOn(NodeFsAdapter.prototype, "getFileMetadata");
    const look = jest.spyOn(TripleStoreIndexedFsAdapter.prototype, "findFilesByMetadata");
    await runApply(extra);
    // The alias-only condition forces the resolver's ALIAS pass (label pass misses).
    expect(look.mock.calls.map((c) => c[0])).toContainEqual({ aliases: "TaskProto" });

    // The resolvers RESOLVED — through the index, not by falling back to label-form.
    const created = createdIn("onto");
    expect(created).toHaveLength(1);
    const content = fs.readFileSync(path.join(root, "onto", created[0]), "utf-8");
    expect(content).toContain(`exo__Instance_class:\n  - "[[${CLASS_TASK_UID}]]"`); // classLabelToUid
    expect(content).toContain(`exo__Asset_isDefinedBy: "[[${ONTO_UID}]]"`); // rule 1 matched via label → uid
    expect(content).not.toContain("ems__Effort_area"); // rule 2 (ems__Task) must NOT match a prototype
    expect(createdIn("proto")).toEqual([]); // co-located by refToFolder, not the host folder

    // … and read only the files they are about.
    expect(walk).not.toHaveBeenCalled();
    const readPaths = meta.mock.calls.map((c) => String(c[0]));
    expect(readPaths.filter((p) => p.startsWith("noise/"))).toEqual([]);
    expect(readPaths.length).toBeLessThan(NOISE_COUNT / 2);
    return content;
  }

  it("I1 apply create-instance reads only target + resolved refs (getMarkdownFiles never, no noise reads) — full parse", async () => {
    await assertCreateReadsOnlyItsFiles([]);
  });

  it("I1c apply create-instance reads only target + resolved refs — --use-cache on a cache built WITH the inferred layer (AC4)", async () => {
    // The real `index` command: explicit triples + the materialised inferred layer
    // (60 inherited `TaskProto` aliases) persisted into the cache.
    await sparqlIndexCommand().parseAsync(["node", "index", "--vault", root]);
    const cache = JSON.parse(fs.readFileSync(path.join(root, ".exocortex", "cache", "triples.json"), "utf-8")) as {
      inferred: Array<{ predicate: { value: string }; object: { value: string } }>;
    };
    const inheritedAliases = cache.inferred.filter(
      (t) => t.predicate.value.endsWith("#Asset_aliases") && t.object.value === "TaskProto",
    );
    expect(inheritedAliases).toHaveLength(NOISE_COUNT);
    await assertCreateReadsOnlyItsFiles(["--use-cache"]);
  });

  it("I2 the three resolver factories answer identically on the indexed adapter and on the scan", async () => {
    const converter = new NoteToRDFConverter(new FileSystemVaultAdapter(root));
    const zeroTriplePaths: string[] = [];
    const explicitTriples = await converter.convertVault({
      onSkippedFiles: (skipped) => {
        for (const f of skipped) zeroTriplePaths.push(f.path);
      },
    });
    const scan = new NodeFsAdapter(root);
    const idx = new TripleStoreIndexedFsAdapter(root, { explicitTriples, zeroTriplePaths });

    const labelScan = createVaultFrontmatterClassLabelResolver(scan);
    const labelIdx = createVaultFrontmatterClassLabelResolver(idx);
    for (const label of ["ems__Task", "Task", "TaskProto", "ems__TaskPrototype", "ems__Area", "nope", ""]) {
      expect(await labelIdx(label)).toBe(await labelScan(label));
    }
    expect(await labelIdx("ems__Task")).toBe(CLASS_TASK_UID);
    expect(await labelIdx("Task")).toBe(CLASS_TASK_UID); // alias pass

    const folderScan = createVaultFrontmatterRefToFolderResolver(scan);
    const folderIdx = createVaultFrontmatterRefToFolderResolver(idx);
    for (const ref of [ONTO_UID, AREA_UID, TARGET_UID, "00000000-0000-4000-8000-000000000000", ""]) {
      expect(await folderIdx(ref)).toBe(await folderScan(ref));
    }
    expect(await folderIdx(ONTO_UID)).toBe("onto");

    const fmScan = createVaultFrontmatterRefToFrontmatterResolver(scan);
    const fmIdx = createVaultFrontmatterRefToFrontmatterResolver(idx);
    for (const ref of [ONTO_UID, TARGET_UID, "00000000-0000-4000-8000-000000000000"]) {
      expect(await fmIdx(ref)).toEqual(await fmScan(ref));
    }
    expect((await fmIdx(ONTO_UID))?.exo__Asset_label).toBe("My efforts ontology");
    expect(idx.stats.scanFallbacks).toBe(0);
    expect(idx.stats.indexedLookups).toBeGreaterThan(0);
  });
});

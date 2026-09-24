/**
 * req 1848dff9-bb2e-43a9-95e7-d917d6cef552 (issue #4347) — `cli create-batch`
 * creates many assets from one JSON file in ONE invocation.
 *
 * Every axis drives the REAL `createBatchCommand()` action against a temp
 * fixture vault and asserts the DISK effect (files written or not, their
 * bytes), never the command's own report of what it did.
 *
 *   B1   a batch writes every item; stdout = one JSON array in input order
 *   B2   parity: an item's file equals what `create` writes for the equivalent
 *        flags, apart from uid / filename / timestamps (5 shapes)
 *   B3   all-or-nothing: invalid items → nothing written, EVERY failure named
 *   B4   an item links to another item of the same batch through its uid
 *   B4b  control: the same link to a uid in neither the batch nor the vault is
 *        refused — the wikilink check is live, B4 passes because of the batch
 *   B5a  a malformed caller uid is refused
 *   B5b  a uid repeated within the batch is refused
 *   B5c  re-running the same file is refused instead of duplicating
 *   B6a  each vault-scanning service is instantiated once per invocation
 *   B6b  a vault file is read — and the vault listed — no more often for 20
 *        items than for 2
 *   B6c  per-item metadata lookups stay far below one vault pass
 *   B7   --dry-run writes nothing, reports the mapping, previews every item
 *   B8   malformed input is refused by name (4 shapes)
 *   B9   stdin (`-`) is read as the input document
 *   B10  --created-by is the default for items that set no createdBy
 *
 * B6 observes service INSTANCES through prototype spies (the `this` of each
 * call) and the underlying reads through `NodeFsAdapter.prototype` — never a
 * counter the batch reports about itself.
 *
 * Revert-verify: the mutant matrices beside this file
 * (`create-batch-1848dff9*.spec.json`) — one mutant per guarantee, control
 * 0 red.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Readable } from "stream";

const { createBatchCommand } =
  await import("../../src/commands/create-batch.js");
const { createCommand } = await import("../../src/commands/create.js");
const { NodeFsAdapter } = await import("../../src/adapters/NodeFsAdapter.js");
const { PlanningFsAdapter } =
  await import("../../src/adapters/PlanningFsAdapter.js");
const { ClassResolverService } =
  await import("../../src/services/ClassResolverService.js");
const { PropertyNameValidator } =
  await import("../../src/services/PropertyNameValidator.js");
const { EffortStatusResolver } =
  await import("../../src/services/EffortStatusResolver.js");
const { ShapeLoader } = await import("@kitelev/exocortex-core");

const EFFORT_CLASS_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const CONCEPT_CLASS_UID = "c0c0c0c0-1111-2222-3333-444444444444";
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const DRAFT_UID = "c42245d0-01de-4c35-bfcf-d910445ea28e";
const EXOASSISTANT_UID = "4ef3962d-b8a7-42b5-bd28-88ec846f1d13";
const ONTOLOGY_UID = "5a5a5a5a-0000-4000-8000-000000000001";
// The real exo__Class metaclass uid: class defs are its instances, which is
// how ClassResolverService finds a class by its short name.
const CLASS_METACLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";

const EMS_DIR = "assetspaces/kitelev/exoas-public/ems";
const PROPS_DIR = "assetspaces/kitelev/exoas-exo/exo";
const ONTOLOGY_DIR = "assetspaces/kitelev/exoas-test/test";
const CONCEPTS_DIR =
  "assetspaces/kitelev/exoas-shared-private/concepts/general";
const FILLER_COUNT = 60;

const fillerUid = (n: number): string =>
  `f1110000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - "${item}"`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function write(
  vault: string,
  dir: string,
  uid: string,
  fm: Record<string, string | string[]>,
): void {
  fs.mkdirSync(path.join(vault, dir), { recursive: true });
  fs.writeFileSync(path.join(vault, dir, `${uid}.md`), md(fm));
}

function buildVault(vault: string): void {
  // Classes are instances of the exo__Class metaclass, as in the live TBox:
  // ems__Task ⊂ ems__Effort (status-bearing); concept__Concept is not.
  write(vault, PROPS_DIR, CLASS_METACLASS_UID, {
    exo__Asset_uid: CLASS_METACLASS_UID,
    exo__Asset_label: "exo__Class",
  });
  const isClass = [`[[${CLASS_METACLASS_UID}]]`];
  write(vault, EMS_DIR, EFFORT_CLASS_UID, {
    exo__Asset_uid: EFFORT_CLASS_UID,
    exo__Instance_class: isClass,
    exo__Asset_label: "ems__Effort",
  });
  write(vault, EMS_DIR, TASK_CLASS_UID, {
    exo__Asset_uid: TASK_CLASS_UID,
    exo__Instance_class: isClass,
    exo__Asset_label: "ems__Task",
    exo__Class_superClass: [`[[${EFFORT_CLASS_UID}]]`],
  });
  write(vault, EMS_DIR, CONCEPT_CLASS_UID, {
    exo__Asset_uid: CONCEPT_CLASS_UID,
    exo__Instance_class: isClass,
    exo__Asset_label: "concept__Concept",
    exo__Class_superClass: ["[[exo__Asset]]"],
  });
  write(vault, EMS_DIR, BACKLOG_UID, {
    exo__Asset_uid: BACKLOG_UID,
    exo__Asset_label: "ems__EffortStatusBacklog",
  });
  write(vault, EMS_DIR, DRAFT_UID, {
    exo__Asset_uid: DRAFT_UID,
    exo__Asset_label: "ems__EffortStatusDraft",
  });
  write(vault, EMS_DIR, EXOASSISTANT_UID, {
    exo__Asset_uid: EXOASSISTANT_UID,
    exo__Asset_label: "ExoAssistant",
  });

  // A mounted property TBox — so property NAMES are validated (fail-open when
  // none is mounted, which would make B3's unknown-name case vacuous).
  let n = 0;
  for (const name of [
    "exo__Asset_isDefinedBy",
    "exo__Asset_relates",
    "ems__Effort_parent",
    "ems__Effort_status",
  ]) {
    n += 1;
    write(vault, PROPS_DIR, `0000000${n}-0000-4000-8000-00000000000${n}`, {
      exo__Asset_uid: `0000000${n}-0000-4000-8000-00000000000${n}`,
      exo__Instance_class: '"[[exo__ObjectProperty]]"',
      exo__Asset_label: name,
    });
  }

  // The co-location anchor (an ontology file; no class → the range guard
  // accepts it, as it does for the real anchors in create's own suites).
  write(vault, ONTOLOGY_DIR, ONTOLOGY_UID, {
    exo__Asset_uid: ONTOLOGY_UID,
    exo__Asset_label: "$test",
  });

  // Concept instances WITHOUT an anchor: the neighbour home of an anchorless
  // concept item, and the bulk that makes one vault pass measurable (B6).
  for (let i = 0; i < FILLER_COUNT; i += 1) {
    write(vault, CONCEPTS_DIR, fillerUid(i), {
      exo__Asset_uid: fillerUid(i),
      exo__Instance_class: [`[[${CONCEPT_CLASS_UID}]]`],
      exo__Asset_label: `Filler ${i}`,
    });
  }

  fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });
}

function countMd(dir: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countMd(full);
    else if (entry.name.endsWith(".md")) count += 1;
  }
  return count;
}

/** Normalise the per-run identity (uid, filename) and the clock out of a file. */
function normalise(content: string, uid: string): string {
  return content
    .split(uid)
    .join("<UID>")
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g,
      "<TS>",
    );
}

describe("req 1848dff9: `cli create-batch` — many assets, one invocation", () => {
  let vault: string;
  let scratch: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-batch-vault-"));
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cli-batch-input-"));
    buildVault(vault);
    stdoutChunks = [];
    stderrChunks = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as never);
    stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    // ErrorHandler reports through console.error — collected with stderr.
    errorSpy = jest.spyOn(console, "error").mockImplementation(((
      ...args: unknown[]
    ) => {
      stderrChunks.push(`${args.map(String).join(" ")}\n`);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  interface Run {
    exit: number[];
    stderr: string;
    out: { uuid: string; path: string; label: string }[] | null;
  }

  function reset(): void {
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    exitCodes.length = 0;
  }

  function collect(): Run {
    const json = stdoutChunks.join("").trim();
    return {
      exit: [...exitCodes],
      stderr: stderrChunks.join(""),
      out: json ? (JSON.parse(json) as Run["out"]) : null,
    };
  }

  /** Run the REAL create-batch action on `items` (written to a JSON file). */
  async function runBatch(
    items: unknown,
    extraArgs: string[] = [],
  ): Promise<Run> {
    reset();
    const file = path.join(
      scratch,
      `batch-${Math.random().toString(16).slice(2)}.json`,
    );
    fs.writeFileSync(
      file,
      typeof items === "string" ? items : JSON.stringify(items),
    );
    await createBatchCommand().parseAsync(
      [file, "--vault", vault, ...extraArgs],
      {
        from: "user",
      },
    );
    return collect();
  }

  /** Run the REAL single create action. */
  async function runCreate(args: string[]): Promise<Run> {
    reset();
    await createCommand().parseAsync([...args, "--vault", vault], {
      from: "user",
    });
    const json = stdoutChunks.join("").trim();
    return {
      exit: [...exitCodes],
      stderr: stderrChunks.join(""),
      out: json
        ? [JSON.parse(json) as { uuid: string; path: string; label: string }]
        : null,
    };
  }

  const read = (rel: string): string =>
    fs.readFileSync(path.join(vault, rel), "utf-8");

  it("B1: every item is written; stdout is one JSON array of {uuid, path, label} in input order @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const before = countMd(vault);
    const r = await runBatch([
      { class: TASK_CLASS_UID, label: "First" },
      { class: "concept__Concept", label: "Second" },
      { class: TASK_CLASS_UID, label: "Third" },
    ]);

    expect(r.exit).toEqual([0]);
    expect(r.out?.map((o) => o.label)).toEqual(["First", "Second", "Third"]);
    expect(countMd(vault)).toBe(before + 3);
    for (const entry of r.out ?? []) {
      expect(path.basename(entry.path)).toBe(`${entry.uuid}.md`);
      expect(read(entry.path)).toContain(`exo__Asset_uid: ${entry.uuid}`);
      expect(read(entry.path)).toContain(entry.label);
    }
  });

  it("B2: an item's file equals what `create` writes for the equivalent flags, apart from uid / filename / timestamps @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    // A literal backslash-n (authored text) AND a real newline: a verbatim body
    // keeps the first; an expanded one would turn it into a line break.
    const body = "First line with a literal \\n escape\nSecond line\n";
    const bodyFile = path.join(scratch, "body.md");
    fs.writeFileSync(bodyFile, body);

    const cases: {
      name: string;
      item: Record<string, unknown>;
      flags: string[];
    }[] = [
      {
        name: "status-bearing default + aliases + multi-value property + verbatim body",
        item: {
          class: TASK_CLASS_UID,
          label: "Parity task",
          aliases: ["Parity alias"],
          properties: {
            exo__Asset_relates: [`[[${fillerUid(1)}]]`, `[[${fillerUid(2)}]]`],
          },
          body,
        },
        flags: [
          "--class",
          TASK_CLASS_UID,
          "--label",
          "Parity task",
          "--aliases",
          "Parity alias",
          "--property",
          `exo__Asset_relates=[[${fillerUid(1)}]]`,
          "--property",
          `exo__Asset_relates=[[${fillerUid(2)}]]`,
          "--body-file",
          bodyFile,
        ],
      },
      {
        name: "isDefinedBy anchor → co-located",
        item: {
          class: "concept__Concept",
          label: "Anchored concept",
          properties: { exo__Asset_isDefinedBy: `[[${ONTOLOGY_UID}]]` },
        },
        flags: [
          "--class",
          "concept__Concept",
          "--label",
          "Anchored concept",
          "--property",
          `exo__Asset_isDefinedBy=[[${ONTOLOGY_UID}]]`,
        ],
      },
      {
        name: "explicit status",
        item: { class: TASK_CLASS_UID, label: "Draft task", status: "Draft" },
        flags: [
          "--class",
          TASK_CLASS_UID,
          "--label",
          "Draft task",
          "--status",
          "Draft",
        ],
      },
      {
        name: "status false ⇔ --no-status",
        item: { class: TASK_CLASS_UID, label: "Statusless", status: false },
        flags: [
          "--class",
          TASK_CLASS_UID,
          "--label",
          "Statusless",
          "--no-status",
        ],
      },
      {
        name: "no anchor → neighbour home",
        item: { class: "concept__Concept", label: "Neighbour concept" },
        flags: ["--class", "concept__Concept", "--label", "Neighbour concept"],
      },
    ];

    for (const c of cases) {
      const single = await runCreate(c.flags);
      expect(single.exit).toEqual([0]);
      const s = single.out![0];

      const batch = await runBatch([c.item]);
      expect(batch.exit).toEqual([0]);
      const b = batch.out![0];

      expect({ case: c.name, folder: path.dirname(b.path) }).toEqual({
        case: c.name,
        folder: path.dirname(s.path),
      });
      expect({
        case: c.name,
        content: normalise(read(b.path), b.uuid),
      }).toEqual({
        case: c.name,
        content: normalise(read(s.path), s.uuid),
      });
    }
    // Non-vacuity of the shapes above: the cases really differ from each other.
    const first = await runBatch([cases[0].item]);
    expect(read(first.out![0].path)).toContain("literal \\n escape");
    expect(read(first.out![0].path)).toContain(
      `ems__Effort_status: "[[${BACKLOG_UID}]]"`,
    );
  });

  it("B3: one invalid item → NOTHING is written, every failing item is named, exit 2 @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const before = countMd(vault);
    const r = await runBatch([
      { class: TASK_CLASS_UID, label: "Valid zero" },
      {
        class: TASK_CLASS_UID,
        label: "Typo",
        properties: { ems__Effort_parentEffort: "x" },
      },
      { class: TASK_CLASS_UID, label: "Valid two" },
      // A COPY carries a real uid; a placeholder (`x`, `$randomUUIDv4`) is a
      // legal template body and is accepted by create's guard as well.
      {
        class: TASK_CLASS_UID,
        label: "Frontmatter copy",
        body: "---\nexo__Asset_uid: 11111111-2222-4333-8444-555555555555\n---\nbody\n",
      },
      { class: TASK_CLASS_UID, label: "Joined alias", aliases: ["a,b,c"] },
      {
        class: "concept__Concept",
        label: "Status on concept",
        status: "Draft",
      },
    ]);

    expect(r.exit).toEqual([2]);
    expect(r.out).toBeNull();
    expect(countMd(vault)).toBe(before);
    for (const [index, label] of [
      [1, "Typo"],
      [3, "Frontmatter copy"],
      [4, "Joined alias"],
      [5, "Status on concept"],
    ] as const) {
      expect(r.stderr).toContain(`item[${index}] "${label}"`);
    }
    expect(r.stderr).not.toContain('item[0] "Valid zero"');
    expect(r.stderr).toContain("Unknown property 'ems__Effort_parentEffort'");
    expect(r.stderr).toContain(
      "4 of 6 item(s) failed validation — nothing was written",
    );
  });

  it("B4: an item links to another item of the same batch through its caller-supplied uid @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const exerciseUid = "aaaa0000-0000-4000-8000-000000000001";
    const r = await runBatch([
      {
        class: TASK_CLASS_UID,
        label: "Exercise",
        uid: exerciseUid,
        properties: { exo__Asset_isDefinedBy: `[[${ONTOLOGY_UID}]]` },
      },
      {
        class: TASK_CLASS_UID,
        label: "Step one",
        properties: {
          exo__Asset_isDefinedBy: `[[${ONTOLOGY_UID}]]`,
          ems__Effort_parent: `[[${exerciseUid}]]`,
        },
      },
    ]);

    expect(r.exit).toEqual([0]);
    const [exercise, step] = r.out!;
    expect(exercise.uuid).toBe(exerciseUid);
    expect(path.basename(exercise.path)).toBe(`${exerciseUid}.md`);
    expect(read(exercise.path)).toContain(`exo__Asset_uid: ${exerciseUid}`);
    expect(read(step.path)).toContain(
      `ems__Effort_parent: "[[${exerciseUid}]]"`,
    );
  });

  it("B4b: control — the same link to a uid in neither the batch nor the vault is refused @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const before = countMd(vault);
    const r = await runBatch([
      {
        class: TASK_CLASS_UID,
        label: "Exercise",
        uid: "aaaa0000-0000-4000-8000-000000000001",
      },
      {
        class: TASK_CLASS_UID,
        label: "Orphan step",
        properties: {
          ems__Effort_parent: "[[aaaa0000-0000-4000-8000-00000000dead]]",
        },
      },
    ]);

    expect(r.exit).toEqual([2]);
    expect(countMd(vault)).toBe(before);
    expect(r.stderr).toContain('item[1] "Orphan step"');
    expect(r.stderr).toContain("file not found in vault");
  });

  it("B5a: a malformed caller uid is refused by name @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const before = countMd(vault);
    const r = await runBatch([
      {
        class: TASK_CLASS_UID,
        label: "Upper",
        uid: "AAAA0000-0000-4000-8000-000000000001",
      },
    ]);
    expect(r.exit).toEqual([2]);
    expect(countMd(vault)).toBe(before);
    expect(r.stderr).toContain(
      'item[0] "Upper": "uid" must be a canonical lower-case UUID',
    );
  });

  it("B5b: a uid repeated within the batch is refused @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const before = countMd(vault);
    const uid = "bbbb0000-0000-4000-8000-000000000001";
    const r = await runBatch([
      { class: TASK_CLASS_UID, label: "One", uid },
      { class: TASK_CLASS_UID, label: "Two", uid },
    ]);
    expect(r.exit).toEqual([2]);
    expect(countMd(vault)).toBe(before);
    expect(r.stderr).toContain(
      `item[1] "Two": uid ${uid} repeats item[0]'s uid`,
    );
  });

  it("B5c: re-running the same file is refused instead of creating duplicates @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const items = [
      {
        class: TASK_CLASS_UID,
        label: "Once",
        uid: "cccc0000-0000-4000-8000-000000000001",
      },
    ];
    const first = await runBatch(items);
    expect(first.exit).toEqual([0]);
    const afterFirst = countMd(vault);

    const second = await runBatch(items);
    expect(second.exit).toEqual([2]);
    expect(countMd(vault)).toBe(afterFirst);
    expect(second.stderr).toContain("already names an asset in the vault");
  });

  describe("vault scans are not repeated per item", () => {
    const mixed = (n: number): Record<string, unknown>[] =>
      Array.from({ length: n }, (_, i) =>
        i % 2 === 0
          ? {
              class: TASK_CLASS_UID,
              label: `Task ${i}`,
              properties: { exo__Asset_isDefinedBy: `[[${ONTOLOGY_UID}]]` },
            }
          : { class: "concept__Concept", label: `Concept ${i}` },
      );

    it("B6a: each vault-scanning service is instantiated once per invocation @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
      const classResolve = jest.spyOn(
        ClassResolverService.prototype,
        "resolve",
      );
      const nameValidate = jest.spyOn(
        PropertyNameValidator.prototype,
        "validate",
      );
      const statusWalk = jest.spyOn(
        EffortStatusResolver.prototype,
        "isStatusBearing",
      );
      const shapeLoad = jest.spyOn(ShapeLoader, "loadFromVaultFS");

      const r = await runBatch(mixed(20), ["--dry-run"]);
      expect(r.exit).toEqual([0]);

      // Called for every item …
      expect(classResolve).toHaveBeenCalledTimes(20);
      expect(nameValidate).toHaveBeenCalledTimes(20);
      // … on ONE instance each: its index / walk is built once.
      expect(new Set(classResolve.mock.contexts).size).toBe(1);
      expect(new Set(nameValidate.mock.contexts).size).toBe(1);
      expect(new Set(statusWalk.mock.contexts).size).toBe(1);
      expect(shapeLoad).toHaveBeenCalledTimes(1);
    });

    it("B6b: a vault file is read — and the vault listed — no more often for 20 items than for 2 @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
      // Every item carries its OWN (unresolvable, `!`-prefixed) anchor, so each
      // one is a distinct neighbour-scan key: the per-key scan memo cannot
      // absorb the repeats, and what keeps the vault from being listed and read
      // once per item is the read memo of the planning adapter alone. (With one
      // shared key the listing is requested once anyway — that input could not
      // tell a working listing memo from a missing one.)
      const distinctAnchors = (n: number): Record<string, unknown>[] =>
        Array.from({ length: n }, (_, i) => ({
          class: "concept__Concept",
          label: `Anchor ${i}`,
          properties: { exo__Asset_isDefinedBy: `[[!anchor-${i}]]` },
        }));
      // Spied on the BASE class: the planning adapter's memo calls through to
      // it, so these are the reads and walks that actually touch the disk.
      const measure = async (
        n: number,
      ): Promise<{ maxReads: number; listings: number }> => {
        const reads = jest.spyOn(NodeFsAdapter.prototype, "getFileMetadata");
        const listings = jest.spyOn(
          NodeFsAdapter.prototype,
          "getMarkdownFiles",
        );
        const r = await runBatch(distinctAnchors(n), [
          "--dry-run",
          "--skip-wikilink-validation",
        ]);
        expect(r.exit).toEqual([0]);
        const perFile = new Map<string, number>();
        for (const [file] of reads.mock.calls) {
          perFile.set(String(file), (perFile.get(String(file)) ?? 0) + 1);
        }
        const result = {
          maxReads: Math.max(...perFile.values()),
          listings: listings.mock.calls.length,
        };
        reads.mockRestore();
        listings.mockRestore();
        // Non-vacuity: the run really read and listed the vault.
        expect(perFile.size).toBeGreaterThanOrEqual(FILLER_COUNT);
        expect(result.listings).toBeGreaterThan(0);
        return result;
      };

      const small = await measure(2);
      const large = await measure(20);
      expect(large).toEqual(small);
    });

    it("B6c: per-item metadata lookups stay far below one vault pass @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
      // Anchorless concepts take the neighbour-scan path — the one that walks
      // the whole vault per call. Counted on the memo layer itself, so a
      // per-item re-scan shows up even though the reads under it are cached.
      const concepts = (n: number): Record<string, unknown>[] =>
        Array.from({ length: n }, (_, i) => ({
          class: "concept__Concept",
          label: `C ${i}`,
        }));
      const lookups = async (n: number): Promise<number> => {
        const spy = jest.spyOn(PlanningFsAdapter.prototype, "getFileMetadata");
        const r = await runBatch(concepts(n), ["--dry-run"]);
        expect(r.exit).toEqual([0]);
        const calls = spy.mock.calls.length;
        spy.mockRestore();
        return calls;
      };

      const one = await lookups(1);
      const ten = await lookups(10);
      // Non-vacuity: a single item does pay a full pass (> FILLER_COUNT).
      expect(one).toBeGreaterThan(FILLER_COUNT);
      // Nine more items add a small constant each — not another pass each.
      expect((ten - one) / 9).toBeLessThan(FILLER_COUNT / 4);
    });
  });

  it("B7: --dry-run writes nothing, reports the mapping and previews every item @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const before = countMd(vault);
    const r = await runBatch(
      [
        { class: TASK_CLASS_UID, label: "Dry one" },
        { class: "concept__Concept", label: "Dry two" },
      ],
      ["--dry-run"],
    );
    expect(r.exit).toEqual([0]);
    expect(countMd(vault)).toBe(before);
    expect(r.out?.map((o) => o.label)).toEqual(["Dry one", "Dry two"]);
    expect(r.stderr).toContain(
      `--- DRY RUN PREVIEW [item 0] ${r.out![0].path} ---`,
    );
    expect(r.stderr).toContain(
      `--- DRY RUN PREVIEW [item 1] ${r.out![1].path} ---`,
    );
    expect(r.stderr).toContain(`exo__Asset_uid: ${r.out![1].uuid}`);
  });

  it("B8: malformed input is refused by name and nothing is written @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const before = countMd(vault);
    const shapes: [unknown, string][] = [
      [
        { class: TASK_CLASS_UID, label: "Not an array" },
        "must be a JSON array of items, got an object",
      ],
      [[], "empty array — nothing to create"],
      [[{ label: "No class" }], 'item[0] "No class": "class" is required'],
      [
        [{ class: TASK_CLASS_UID, label: "Typo key", propeties: {} }],
        'unknown key(s) "propeties"',
      ],
    ];
    for (const [items, message] of shapes) {
      const r = await runBatch(items);
      expect({ message, exit: r.exit }).toEqual({ message, exit: [2] });
      expect(r.stderr).toContain(message);
    }
    expect(countMd(vault)).toBe(before);
  });

  it("B9: `-` reads the input document from stdin @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([
        Buffer.from(
          JSON.stringify([{ class: TASK_CLASS_UID, label: "From stdin" }]),
        ),
      ]),
    });
    try {
      reset();
      await createBatchCommand().parseAsync(["-", "--vault", vault], {
        from: "user",
      });
    } finally {
      Object.defineProperty(process, "stdin", realStdin);
    }
    const r = collect();
    expect(r.exit).toEqual([0]);
    expect(r.out?.[0].label).toBe("From stdin");
    expect(read(r.out![0].path)).toContain("From stdin");
  });

  it("B10: --created-by is the default for items without createdBy; an item's own createdBy wins @req:1848dff9-bb2e-43a9-95e7-d917d6cef552", async () => {
    const batchCreator = "dddd0000-0000-4000-8000-000000000001";
    const ownCreator = "eeee0000-0000-4000-8000-000000000001";
    const r = await runBatch(
      [
        { class: TASK_CLASS_UID, label: "Batch creator" },
        { class: TASK_CLASS_UID, label: "Own creator", createdBy: ownCreator },
      ],
      ["--created-by", batchCreator],
    );
    expect(r.exit).toEqual([0]);
    expect(read(r.out![0].path)).toContain(
      `exo__Asset_createdBy: "[[${batchCreator}]]"`,
    );
    expect(read(r.out![1].path)).toContain(
      `exo__Asset_createdBy: "[[${ownCreator}]]"`,
    );
  });
});

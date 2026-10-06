/**
 * req f5b79260-f87c-4e73-8a34-19da341c7ec9 (ticket 316dd2be, onto-RFC 4a8d887a)
 * — the creation gate at every new-file write point of the CLI.
 *
 * Every axis drives the REAL command (`create`, `create-batch`, `apply`)
 * against a temp vault laid out like vault-exodev — real class / property /
 * status UIDs, the rule asset in the shape Appendix B of the ticket creates —
 * and reads the disk back. No hand-built candidate: the gate is exercised
 * through the commands that write.
 *
 * Axis names (S<n>) lead each title: they are the machine key the mutant
 * driver reads (`creation-gate-f5b79260.*.spec.json`).
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
import { fileURLToPath } from "url";
import { expectNaturalExit } from "./helpers/exit-assertions.js";

const { createCommand } = await import("../../src/commands/create.js");
const { createBatchCommand } = await import("../../src/commands/create-batch.js");
const { applyCommand } = await import("../../src/commands/apply.js");
const { CacheManager } = await import("../../src/cache/CacheManager.js");
const { PlanningFsAdapter } = await import("../../src/adapters/PlanningFsAdapter.js");
const { createFsPolicySource, isCreationGateClassObject } = await import(
  "../../src/services/CreationGateCli.js"
);

const REQ = "@req:f5b79260-f87c-4e73-8a34-19da341c7ec9";

// ── TBox: real UIDs of vault-exodev ──────────────────────────────────────
const META = {
  klass: "8619c4fc-64f1-4869-b17e-e34186cacca9",
  objectProperty: "9a1cf31c-9d41-4ef3-9023-584a8d087d16",
};
const C = {
  effort: "086f71fa-dd30-4284-90cf-e609f2a6c461",
  task: "1b20a8f0-d745-4e93-91db-4531b3df120e",
  project: "7db5eeff-718a-49b0-8d2b-39b084a356e3",
  bug: "f25e8c45-7cc5-48a0-b814-30d1ba867525",
  effortPrototype: "a5c6d3aa-a47a-4f5f-99e6-4d932b0a2d49",
  taskPrototype: "df7e579d-02d4-4f3a-971f-3d1d785b689b",
  projectPrototype: "b2a49bb7-3a0f-4984-aa18-38832dc967bc",
  emsIdea: "6c0dab0c-c15f-4d08-b522-2b32d874755e",
  gate: "d4cde00a-c211-437b-9ba1-71223a15551b",
};
const GATE_PROPS: Record<string, string> = {
  guardedClass: "6c16eb5b-28da-4182-a692-6450731dcf7e",
  excludedClass: "30340ea7-036c-4050-bc8d-84b14830498a",
  exemptClass: "5a9aff21-f1da-4e7b-a7b7-0b0c98000dde",
  exemptEvidence: "3cee39fa-9aee-4cf8-9015-0e954465acd6",
  chainProperty: "42f9721a-844a-495b-ad68-3c41b6dbc7dc",
  anchorClass: "b7b2749e-bfeb-48a4-9698-25cc981a9e86",
  directionProperty: "f827a1ad-6936-4da1-b33a-388b59e81642",
  statusProperty: "9f817e90-6353-4214-ac9a-ec0053be4980",
  allowedStatus: "16035576-ed4a-42d4-bddf-27edd50d5f98",
};
const PROP = {
  effortParent: "6528ecfa-a03d-47f1-a819-9ba5fea8fc28",
  relates: "e3a71d16-14b3-4aff-adf7-c9eccd1077b4",
  rfcStatus: "20a40d7f-fdd0-4707-a550-88ad793b507f",
  instanceClass: "ab0a3c2c-0000-4000-8000-000000000001",
};
const APPROVED = "985dca1d-6bf7-4f30-98f6-204ffcf650ff";
const PROPOSED = "9119367e-5744-4e20-89e0-119736602579";
const BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const DRAFT = "c42245d0-01de-4c35-bfcf-d910445ea28e";
const EXOASSISTANT = "4ef3962d-b8a7-42b5-bd28-88ec846f1d13";
const EVIDENCE =
  "github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(?:pull|issues|releases)/|(?:^|[^A-Za-z0-9_А-Яа-яЁё])(?:PR|issue|релиз)\\s*#?[0-9]+|(?:^|[^A-Za-z0-9_])v[0-9]+\\.[0-9]+\\.[0-9]+(?![0-9])";

// ── ABox ──────────────────────────────────────────────────────────────────
const RFC_A = "aaaa0000-0000-4000-8000-0000000000a1";
const RFC_P = "aaaa0000-0000-4000-8000-0000000000b1";
const PRJ_OK = "bbbb0000-0000-4000-8000-000000000001";
const PRJ_ALP = "bbbb0000-0000-4000-8000-000000000002";
const RULE = "eeee0000-0000-4000-8000-000000000001";
const BATCH_PRJ = "bbbb0000-0000-4000-8000-0000000000f1";
const PROTO_ROOT = "dddd0000-0000-4000-8000-000000000001";
const PROTO_CHILD = "dddd0000-0000-4000-8000-000000000002";

// ── apply commands (the shapes of the live create-task / service calls) ───
const GT_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";
const GT_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";
const CMD = {
  createTask: "ac000001-0000-4000-8000-000000000001",
  relatedTask: "ac000002-0000-4000-8000-000000000002",
  createAsset: "ac000003-0000-4000-8000-000000000003",
  subtree: "ac000004-0000-4000-8000-000000000004",
};
const GR = {
  createTask: "ac000011-0000-4000-8000-000000000011",
  relatedTask: "ac000012-0000-4000-8000-000000000012",
  createAsset: "ac000013-0000-4000-8000-000000000013",
  subtree: "ac000014-0000-4000-8000-000000000014",
};

const RULE_LABEL = "Гейт Double Diamond: новый эффорт только под одобренное направление";

type Fm = Record<string, string | string[]>;

function md(frontmatter: Fm, body = ""): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "", body);
  return lines.join("\n");
}

const link = (uid: string): string => `"[[${uid}]]"`;

interface VaultOptions {
  rule?: boolean;
  /** Mount the TBox of the rule class and its nine properties. */
  gateTbox?: boolean;
}

function writeAsset(root: string, rel: string, frontmatter: Fm, body = ""): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, md(frontmatter, body), "utf-8");
}

function buildVault({ rule = true, gateTbox = true }: VaultOptions = {}): string {
  // realpath: the persistent cache is keyed on the resolved vault path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cli-gate-f5b79260-")));
  const ems = "assetspaces/kitelev/exoas-public/ems";
  const exo = "assetspaces/kitelev/exoas-exo/exo";
  const exocmd = "assetspaces/kitelev/exoas-exocmd/exocmd";
  const exodev = "assetspaces/kitelev/exoas-exodev/exodev";
  const isClass = [link(META.klass)];
  const cls = (uid: string, label: string, supers: string[] = []): void => {
    const fm: Fm = { exo__Asset_uid: uid, exo__Asset_label: label, exo__Instance_class: isClass };
    if (supers.length > 0) fm.exo__Class_superClass = supers.map(link);
    writeAsset(root, `${uid.startsWith("d4cde00a") ? exocmd : ems}/${uid}.md`, fm);
  };
  const prop = (dir: string, uid: string, label: string): void =>
    writeAsset(root, `${dir}/${uid}.md`, {
      exo__Asset_uid: uid,
      exo__Asset_label: label,
      aliases: [label],
      exo__Instance_class: [link(META.objectProperty)],
    });

  writeAsset(root, `${exo}/${META.klass}.md`, { exo__Asset_uid: META.klass, exo__Asset_label: "exo__Class" });
  writeAsset(root, `${exo}/${META.objectProperty}.md`, {
    exo__Asset_uid: META.objectProperty,
    exo__Asset_label: "exo__ObjectProperty",
  });
  cls(C.effort, "ems__Effort");
  cls(C.task, "ems__Task", [C.effort]);
  cls(C.project, "ems__Project", [C.effort]);
  cls(C.bug, "ems__Bug", [C.project]);
  cls(C.effortPrototype, "ems__EffortPrototype");
  cls(C.taskPrototype, "ems__TaskPrototype", [C.effortPrototype, C.task]);
  cls(C.projectPrototype, "ems__ProjectPrototype", [C.project, C.effortPrototype]);
  cls(C.emsIdea, "ems__Idea", [C.effort]);
  prop(ems, PROP.effortParent, "ems__Effort_parent");
  prop(exo, PROP.relates, "exo__Asset_relates");
  prop(exo, PROP.instanceClass, "exo__Instance_class");
  prop(exodev, PROP.rfcStatus, "exodev__RFC_status");
  if (gateTbox) {
    cls(C.gate, "exocmd__CreationGate");
    for (const [field, uid] of Object.entries(GATE_PROPS)) {
      prop(exocmd, uid, `exocmd__CreationGate_${field}`);
    }
  }
  writeAsset(root, `${ems}/${BACKLOG}.md`, { exo__Asset_uid: BACKLOG, exo__Asset_label: "ems__EffortStatusBacklog" });
  writeAsset(root, `${ems}/${DRAFT}.md`, { exo__Asset_uid: DRAFT, exo__Asset_label: "ems__EffortStatusDraft" });
  writeAsset(root, `${exodev}/${APPROVED}.md`, { exo__Asset_uid: APPROVED, exo__Asset_label: "exodev__RFCStatusApproved" });
  writeAsset(root, `${exodev}/${PROPOSED}.md`, { exo__Asset_uid: PROPOSED, exo__Asset_label: "exodev__RFCStatusProposed" });
  writeAsset(root, `assetspaces/kitelev/exoas-shared-identities/shared-identities/${EXOASSISTANT}.md`, {
    exo__Asset_uid: EXOASSISTANT,
    exo__Asset_label: "ExoAssistant",
  });
  writeAsset(root, `${exodev}/inbox/${RFC_A}.md`, {
    exo__Asset_uid: RFC_A,
    exo__Asset_label: '"RFC одобренный"',
    exodev__RFC_status: link(APPROVED),
  });
  writeAsset(root, `${exodev}/inbox/${RFC_P}.md`, {
    exo__Asset_uid: RFC_P,
    exo__Asset_label: '"RFC предложенный"',
    exodev__RFC_status: link(PROPOSED),
  });
  writeAsset(root, `${exodev}/${PRJ_OK}.md`, {
    exo__Asset_uid: PRJ_OK,
    exo__Asset_label: '"Проект под одобренным"',
    exo__Instance_class: [link(C.project)],
    exo__Asset_relates: link(RFC_A),
    ems__Effort_status: link(BACKLOG),
  });
  writeAsset(root, `${exodev}/${PRJ_ALP}.md`, {
    exo__Asset_uid: PRJ_ALP,
    exo__Asset_label: '"Проект без одобренного направления"',
    exo__Instance_class: [link(C.project)],
    exo__Asset_relates: link(RFC_P),
    ems__Effort_status: link(BACKLOG),
  });
  // A two-node prototype subtree: a project prototype with one task under it.
  writeAsset(root, `${exodev}/protos/${PROTO_ROOT}.md`, {
    exo__Asset_uid: PROTO_ROOT,
    exo__Asset_label: '"Прототип проекта"',
    exo__Instance_class: [link(C.projectPrototype)],
  });
  writeAsset(root, `${exodev}/protos/${PROTO_CHILD}.md`, {
    exo__Asset_uid: PROTO_CHILD,
    exo__Asset_label: '"Прототип задачи"',
    exo__Instance_class: [link(C.taskPrototype)],
    ems__EffortPrototype_parentEffortPrototype: link(PROTO_ROOT),
  });
  if (rule) {
    writeAsset(root, `${exodev}/${RULE}.md`, {
      exo__Asset_uid: RULE,
      exo__Asset_label: `"${RULE_LABEL}"`,
      exo__Instance_class: [link(C.gate)],
      exocmd__CreationGate_guardedClass: [link(C.task), link(C.project)],
      exocmd__CreationGate_excludedClass: [link(C.effortPrototype)],
      exocmd__CreationGate_exemptClass: [link(C.bug)],
      exocmd__CreationGate_exemptEvidence: `'${EVIDENCE}'`,
      exocmd__CreationGate_chainProperty: link(PROP.effortParent),
      exocmd__CreationGate_anchorClass: [link(C.project)],
      exocmd__CreationGate_directionProperty: link(PROP.relates),
      exocmd__CreationGate_statusProperty: link(PROP.rfcStatus),
      exocmd__CreationGate_allowedStatus: [link(APPROVED)],
      exo__Asset_description: '"Новая работа начинается с идеи; задача — под проект с одобренным направлением."',
    });
  }
  // Commands for `apply`.
  const cmdDir = "commands";
  const command = (uid: string, label: string, grounding: string): void =>
    writeAsset(root, `${cmdDir}/${uid}.md`, {
      exo__Asset_uid: uid,
      exo__Asset_label: `"${label}"`,
      exo__Asset_isDefinedBy: '"[[!kitelev]]"',
      exo__Instance_class: ['"[[exocmd__Command]]"'],
      exocmd__Command_grounding: link(grounding),
    });
  const grounding = (uid: string, fm: Fm): void =>
    writeAsset(root, `${cmdDir}/${uid}.md`, {
      exo__Asset_uid: uid,
      exo__Asset_label: `"grounding ${uid.slice(0, 8)}"`,
      exo__Asset_isDefinedBy: '"[[!kitelev]]"',
      exo__Instance_class: ['"[[exocmd__Grounding]]"'],
      ...fm,
    });
  command(CMD.createTask, "Create task (gate test)", GR.createTask);
  grounding(GR.createTask, {
    exocmd__Grounding_type: link(GT_CREATE_INSTANCE),
    exocmd__Grounding_targetClass: '"ems__Task"',
    exocmd__Grounding_targetFolder: '"Inbox"',
    exocmd__Grounding_linkBackProperty: '"ems__Effort_parent"',
  });
  command(CMD.relatedTask, "Create related task (gate test)", GR.relatedTask);
  grounding(GR.relatedTask, {
    exocmd__Grounding_type: link(GT_SERVICE_CALL),
    exocmd__Grounding_serviceId: '"createRelatedTask"',
  });
  command(CMD.createAsset, "Create asset from prototype (gate test)", GR.createAsset);
  grounding(GR.createAsset, {
    exocmd__Grounding_type: link(GT_SERVICE_CALL),
    exocmd__Grounding_serviceId: '"createAsset"',
  });
  command(CMD.subtree, "Instantiate subtree (gate test)", GR.subtree);
  grounding(GR.subtree, {
    exocmd__Grounding_type: link(GT_SERVICE_CALL),
    exocmd__Grounding_serviceId: '"instantiatePrototypeSubtree"',
  });
  fs.mkdirSync(path.join(root, "01 Inbox"), { recursive: true });
  fs.mkdirSync(path.join(root, "Inbox"), { recursive: true });
  return root;
}

/** Every markdown file under `dir` (the "nothing was written" oracle). */
function listMd(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMd(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

describe("creation gate at the CLI write points (req f5b79260)", () => {
  jest.setTimeout(60_000);

  const vaults: string[] = [];
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    exitCodes = [];
    jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    const writeTo = (sink: string[]) =>
      ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
        sink.push(String(chunk));
        const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        if (typeof done === "function") (done as () => void)();
        return true;
      }) as never;
    jest.spyOn(process.stdout, "write").mockImplementation(writeTo(stdoutChunks));
    jest.spyOn(process.stderr, "write").mockImplementation(writeTo(stderrChunks));
    jest.spyOn(console, "log").mockImplementation(((...args: unknown[]) => {
      stdoutChunks.push(`${args.map(String).join(" ")}\n`);
    }) as never);
    jest.spyOn(console, "error").mockImplementation(((...args: unknown[]) => {
      stderrChunks.push(`${args.map(String).join(" ")}\n`);
    }) as never);
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const v of vaults.splice(0)) fs.rmSync(v, { recursive: true, force: true });
  });

  function vault(options?: VaultOptions): string {
    const v = buildVault(options);
    vaults.push(v);
    return v;
  }

  interface Run {
    exit: number[];
    stderr: string;
    stdout: string;
  }

  function reset(): void {
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    exitCodes.length = 0;
  }

  function snapshot(): Run {
    return { exit: [...exitCodes], stderr: stderrChunks.join(""), stdout: stdoutChunks.join("") };
  }

  async function runCreate(v: string, args: string[]): Promise<Run> {
    reset();
    await createCommand().parseAsync(["--vault", v, ...args], { from: "user" });
    return snapshot();
  }

  async function runBatch(v: string, items: unknown[]): Promise<Run> {
    reset();
    const input = path.join(v, "..", `batch-${path.basename(v)}.json`);
    fs.writeFileSync(input, JSON.stringify(items), "utf-8");
    try {
      await createBatchCommand().parseAsync([input, "--vault", v], { from: "user" });
    } finally {
      fs.rmSync(input, { force: true });
    }
    return snapshot();
  }

  async function runApply(v: string, cmdUid: string, target: string, input: Record<string, unknown>): Promise<Run> {
    reset();
    await applyCommand().parseAsync(
      [cmdUid, target, "--vault", v, "--input", JSON.stringify(input), "--yes"],
      { from: "user" },
    );
    return snapshot();
  }

  /**
   * The gate refused: its text is on stderr. The EXIT CODE is asserted by its
   * own axes (S1, S10) so a mutant that only re-routes the code reds those
   * alone — the refusal and the code are separate deliverables.
   */
  function expectRefusedByGate(run: Run): void {
    expect(run.exit.some((code) => code !== 0)).toBe(true);
    expect(run.stderr).toContain("CREATION_GATE_REFUSED:");
    expect(run.stderr).toContain(RULE_LABEL);
  }

  const prj = (uid: string): string => `assetspaces/kitelev/exoas-exodev/exodev/${uid}.md`;

  // ── create ──────────────────────────────────────────────────────────────
  it(`S1 ${REQ} create --class ems__Task without a parent exits 4, names the rule, writes nothing`, async () => {
    const v = vault();
    const before = listMd(v);
    const run = await runCreate(v, ["--class", "ems__Task", "--label", "Задача без родителя"]);
    expectRefusedByGate(run);
    expect(run.exit).toContain(4);
    // The refusal LINE starts with the stable ASCII prefix (scripts and the
    // published-bundle grep key on it) — other diagnostics may precede it.
    expect(run.stderr.split("\n").some((line) => line.startsWith("CREATION_GATE_REFUSED: ⛔ Правило допуска"))).toBe(true);
    expect(listMd(v)).toEqual(before);
  });

  it(`S1d ${REQ} the same refusal on --dry-run and on --validate`, async () => {
    const v = vault();
    const before = listMd(v);
    expectRefusedByGate(
      await runCreate(v, ["--class", "ems__Task", "--label", "Проба", "--dry-run"]),
    );
    expectRefusedByGate(
      await runCreate(v, ["--class", "ems__Task", "--label", "Проба", "--validate"]),
    );
    expect(listMd(v)).toEqual(before);
  });

  it(`S1m ${REQ} a second class passed through --property is part of the judged file`, async () => {
    const v = vault();
    const run = await runCreate(v, [
      "--class",
      "ems__Task",
      "--label",
      "Задача-идея",
      "--property",
      `exo__Instance_class=[[${C.emsIdea}]]`,
    ]);
    expectRefusedByGate(run);
  });

  it(`S2 ${REQ} create under a project with an Approved direction writes the task`, async () => {
    const v = vault();
    const run = await runCreate(v, [
      "--class",
      "ems__Task",
      "--label",
      "Задача под одобренным",
      "--property",
      `ems__Effort_parent=[[${PRJ_OK}]]`,
    ]);
    expectNaturalExit(run.exit);
    const created = JSON.parse(run.stdout.trim()) as { path: string };
    expect(fs.existsSync(path.join(v, created.path))).toBe(true);
  });

  it(`S3 ${REQ} a vault without a rule asset creates as before`, async () => {
    const v = vault({ rule: false });
    const run = await runCreate(v, ["--class", "ems__Task", "--label", "Без правила"]);
    expectNaturalExit(run.exit);
    const created = JSON.parse(run.stdout.trim()) as { path: string };
    expect(fs.existsSync(path.join(v, created.path))).toBe(true);
  });

  it(`S4 ${REQ} a bug whose label carries evidence (PR #N) is created without a parent`, async () => {
    const v = vault();
    const run = await runCreate(v, ["--class", "ems__Bug", "--label", "Кнопка пропала после PR #4534"]);
    expectNaturalExit(run.exit);
    expect(run.stderr).not.toContain("CREATION_GATE_REFUSED:");
  });

  it(`S4b ${REQ} create judges the properties it writes — a parent given by --property is part of the file`, async () => {
    const v = vault();
    const run = await runCreate(v, [
      "--class",
      "ems__Bug",
      "--label",
      "Баг без ссылки",
      "--property",
      `ems__Effort_parent=[[${PRJ_OK}]]`,
    ]);
    expectNaturalExit(run.exit);
  });

  // ── create-batch ────────────────────────────────────────────────────────
  it(`S5 ${REQ} create-batch: a task whose project comes LATER in the same batch — both written`, async () => {
    const v = vault();
    const run = await runBatch(v, [
      {
        class: "ems__Task",
        label: "Задача под проектом из пачки",
        properties: { ems__Effort_parent: `[[${BATCH_PRJ}]]` },
      },
      {
        class: "ems__Project",
        label: "Проект из пачки",
        uid: BATCH_PRJ,
        properties: { exo__Asset_relates: `[[${RFC_A}]]` },
      },
    ]);
    expect(run.exit).toEqual([0]);
    const written = JSON.parse(run.stdout.trim()) as { path: string }[];
    expect(written).toHaveLength(2);
    for (const w of written) expect(fs.existsSync(path.join(v, w.path))).toBe(true);
  });

  it(`S5b ${REQ} create-batch with one illegal item writes nothing and names the item`, async () => {
    const v = vault();
    const before = listMd(v);
    const run = await runBatch(v, [
      { class: "ems__Task", label: "Законная", properties: { ems__Effort_parent: `[[${PRJ_OK}]]` } },
      { class: "ems__Task", label: "Незаконная" },
    ]);
    expect(run.exit).toEqual([2]);
    expect(run.stderr).toContain("CREATION_GATE_REFUSED:");
    expect(run.stderr).toContain("Незаконная");
    expect(listMd(v)).toEqual(before);
  });

  // ── a vault without the rule class's TBox ──────────────────────────────
  it(`S6 ${REQ} the rule acts where its class TBox is not mounted (fail-closed, not silently off)`, async () => {
    const v = vault({ gateTbox: false });
    const run = await runCreate(v, [
      "--class",
      "ems__Task",
      "--label",
      "Задача под одобренным",
      "--property",
      `ems__Effort_parent=[[${PRJ_OK}]]`,
    ]);
    expectRefusedByGate(run);
    expect(run.stderr).toContain("guardedClass");
  });

  // ── apply ───────────────────────────────────────────────────────────────
  it(`S7 ${REQ} apply create_instance: refused under a project without direction (exit 4, no file); written under an approved one`, async () => {
    const v = vault();
    const before = listMd(v);
    const refused = await runApply(v, CMD.createTask, prj(PRJ_ALP), { label: "Задача из apply" });
    expectRefusedByGate(refused);
    expect(listMd(v)).toEqual(before);
    const allowed = await runApply(v, CMD.createTask, prj(PRJ_OK), { label: "Задача из apply" });
    expectNaturalExit(allowed.exit);
    expect(listMd(v).length).toBe(before.length + 1);
  });

  it(`S8 ${REQ} apply createRelatedTask (GenericAssetCreationService) is gated`, async () => {
    const v = vault();
    const before = listMd(v);
    const refused = await runApply(v, CMD.relatedTask, prj(PRJ_ALP), {
      label: "Связанная задача",
      parentProperty: "ems__Effort_parent",
    });
    expectRefusedByGate(refused);
    expect(listMd(v)).toEqual(before);
    const allowed = await runApply(v, CMD.relatedTask, prj(PRJ_OK), {
      label: "Связанная задача",
      parentProperty: "ems__Effort_parent",
    });
    expectNaturalExit(allowed.exit);
    expect(listMd(v).length).toBe(before.length + 1);
  });

  it(`S8b ${REQ} apply createAsset (service factory writer) is gated`, async () => {
    const v = vault();
    const before = listMd(v);
    const refused = await runApply(v, CMD.createAsset, prj(PRJ_ALP), {
      prototypeUID: "ems__TaskPrototype",
      label: "Задача из прототипа",
    });
    expectRefusedByGate(refused);
    expect(listMd(v)).toEqual(before);
    const allowed = await runApply(v, CMD.createAsset, prj(PRJ_OK), {
      prototypeUID: "ems__TaskPrototype",
      label: "Задача из прототипа",
    });
    expectNaturalExit(allowed.exit);
    expect(listMd(v).length).toBe(before.length + 1);
  });

  it(`S9 ${REQ} apply instantiatePrototypeSubtree: refused without a direction; root then child written under an approved parent`, async () => {
    const v = vault();
    const proto = `assetspaces/kitelev/exoas-exodev/exodev/protos/${PROTO_ROOT}.md`;
    const before = listMd(v);
    const refused = await runApply(v, CMD.subtree, proto, { project: `[[${PRJ_ALP}]]` });
    expectRefusedByGate(refused);
    expect(listMd(v)).toEqual(before);
    const allowed = await runApply(v, CMD.subtree, proto, { project: `[[${PRJ_OK}]]` });
    expectNaturalExit(allowed.exit);
    expect(listMd(v).length).toBe(before.length + 2);
  });

  it(`S12 ${REQ} with a valid triple cache the rule is found THROUGH the cache — no ABox file is read to find it`, async () => {
    const v = vault();
    // Typed ABox noise the narrowed rule search must never read. (An UNTYPED
    // file contributes no triples, so the cache rightly keeps it a candidate.)
    for (let i = 0; i < 6; i++) {
      writeAsset(v, `abox/noise-${i}.md`, {
        exo__Asset_uid: `cccc0000-0000-4000-8000-00000000000${i}`,
        exo__Asset_label: `"Шум ${i}"`,
        exo__Instance_class: [link(C.task)],
        ems__Effort_parent: link(PRJ_OK),
      });
    }
    await new CacheManager(v).buildCache();

    const reads: string[] = [];
    const original = PlanningFsAdapter.prototype.readFile;
    jest.spyOn(PlanningFsAdapter.prototype, "readFile").mockImplementation(function (
      this: InstanceType<typeof PlanningFsAdapter>,
      filePath: string,
    ) {
      reads.push(filePath);
      return original.call(this, filePath);
    });
    const source = createFsPolicySource(new PlanningFsAdapter(v), async () =>
      new CacheManager(v).instanceClassPaths(isCreationGateClassObject),
    );
    const candidates = await source.candidates();
    expect(candidates.map((c) => c.path)).toContain(prj(RULE));
    expect(reads.filter((f) => f.startsWith("abox/"))).toEqual([]);
    expect(new Set(reads).size).toBeLessThan(listMd(v).length);

    // …and the command, on that narrowed path, still refuses.
    expectRefusedByGate(await runCreate(v, ["--class", "ems__Task", "--label", "Задача без родителя"]));
  });

  it(`S10 ${REQ} an apply refusal by the gate exits PERMISSION_DENIED (4), not OPERATION_FAILED (5)`, async () => {
    const v = vault();
    const refused = await runApply(v, CMD.createTask, prj(PRJ_ALP), { label: "Задача из apply" });
    expect(refused.exit).toEqual([4]);
  });

  // ── the sync is not a creation ──────────────────────────────────────────
  it(`S11 ${REQ} the exosync composition is not gated — it delivers, it does not create`, () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/commands/exosync-sync.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/CreationGate|withCreationGate/);
  });
});

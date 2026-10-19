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
const { NodeFsAdapter } = await import("../../src/adapters/NodeFsAdapter.js");
const { CreationGateSession, CREATION_GATE_CLASS_UID, CREATION_GATE_CLASS_LABEL } = await import(
  "@kitelev/exocortex-core"
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

  // ── a7181947: the gate's price while the cache cannot narrow ────────────
  //
  // `create` paid ~+1.5 s on vault-exodev whenever the triple cache was stale
  // (any edit after the last `index`): the rule parser looks each of the
  // rule's nine keys up BY LABEL, and with no index every lookup cloned the
  // frontmatter of every file (`PlanningFsAdapter.getFileMetadata` hands out a
  // `structuredClone`). Counted, not timed — a wall-clock bound in CI flakes
  // (`perf-tests-dont-hard-gate-ci`), a call count does not.

  /** Typed ABox noise — what an un-narrowed lookup has to walk past. */
  function addNoise(v: string, count: number): void {
    for (let i = 0; i < count; i++) {
      writeAsset(v, `abox/noise-${i}.md`, {
        exo__Asset_uid: `cccc1000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        exo__Asset_label: `"Шум ${i}"`,
        exo__Instance_class: [link(C.task)],
        ems__Effort_parent: link(PRJ_OK),
      });
    }
  }

  /**
   * The three ways the cache cannot narrow, each a separate route to the same
   * un-narrowed scan: never indexed · edited after `index` (C8 of #4291) ·
   * indexed, but more files than `MAX_UNKNOWN_PATHS` carry no triples.
   */
  type CacheState = "absent" | "stale" | "dirty";
  const CACHE_STATES: CacheState[] = ["absent", "stale", "dirty"];

  async function unnarrowedVault(state: CacheState): Promise<string> {
    const v = vault();
    addNoise(v, 60);
    if (state === "dirty") {
      for (let i = 0; i <= PlanningFsAdapter.MAX_UNKNOWN_PATHS; i++) {
        // converter-skipped (an empty `updatedAt`, C7 of #4291): no triples ⇒ an unknown path
        const uid = `ffff0000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        const file = path.join(v, "skipped", `${uid}.md`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
          file,
          `---\nexo__Asset_uid: ${uid}\nexo__Asset_label: "Пропуск ${i}"\nexo__Asset_updatedAt:\n---\n`,
          "utf-8",
        );
      }
    }
    if (state !== "absent") await new CacheManager(v).buildCache();
    if (state === "stale") {
      writeAsset(v, "abox/late-arrival.md", {
        exo__Asset_uid: "cccc2000-0000-4000-8000-000000000001",
        exo__Asset_label: '"Пришёл после index"',
      });
    }
    // The state is what the axis claims it is (otherwise a narrowed run would
    // make the price axes vacuous).
    const narrowing = await new CacheManager(v).instanceClassPaths(isCreationGateClassObject);
    if (state === "dirty") {
      expect(narrowing?.unknownPaths.length ?? 0).toBeGreaterThan(PlanningFsAdapter.MAX_UNKNOWN_PATHS);
    } else {
      expect(narrowing).toBeNull();
    }
    return v;
  }

  /**
   * What `create` spent INSIDE the gate (`assertAllowed`), by call count: the
   * planning adapter's cloning metadata reader, `structuredClone` itself, and
   * the BASE reader — every call to it is a fresh parse of a file's text
   * (`PlanningFsAdapter`'s memo loads through it).
   */
  async function gateSpend(
    v: string,
    args: string[],
  ): Promise<{ run: Run; metadata: number; clones: number; parses: number }> {
    const spent = { metadata: 0, clones: 0, parses: 0 };
    let inGate = false;
    // ⛔ Restored before returning: a second spyOn on a still-spied method
    // returns THE SAME mock, so its "original" would be the mock itself.
    const spies: { mockRestore(): void }[] = [];
    const clone = globalThis.structuredClone;
    const cloneSpy = jest.spyOn(globalThis, "structuredClone");
    spies.push(cloneSpy);
    cloneSpy.mockImplementation(((value: unknown, options?: unknown) => {
      if (inGate) spent.clones += 1;
      return clone(value, options as never);
    }) as never);
    const metadata = PlanningFsAdapter.prototype.getFileMetadata;
    const metadataSpy = jest.spyOn(PlanningFsAdapter.prototype, "getFileMetadata");
    spies.push(metadataSpy);
    metadataSpy.mockImplementation(function (
      this: InstanceType<typeof PlanningFsAdapter>,
      file: string,
    ) {
      if (inGate) spent.metadata += 1;
      return metadata.call(this, file);
    });
    const parse = NodeFsAdapter.prototype.getFileMetadata;
    const parseSpy = jest.spyOn(NodeFsAdapter.prototype, "getFileMetadata");
    spies.push(parseSpy);
    parseSpy.mockImplementation(function (this: InstanceType<typeof NodeFsAdapter>, file: string) {
      if (inGate) spent.parses += 1;
      return parse.call(this, file);
    });
    const assertAllowed = CreationGateSession.prototype.assertAllowed;
    const gateSpy = jest.spyOn(CreationGateSession.prototype, "assertAllowed");
    spies.push(gateSpy);
    gateSpy.mockImplementation(async function (
      this: InstanceType<typeof CreationGateSession>,
      file: string,
      content: string,
    ) {
      inGate = true;
      try {
        return await assertAllowed.call(this, file, content);
      } finally {
        inGate = false;
      }
    });
    try {
      const run = await runCreate(v, args);
      return { run, ...spent };
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }

  const underApproved = [
    "--class",
    "ems__Task",
    "--label",
    "Задача под одобренным",
    "--property",
    `ems__Effort_parent=[[${PRJ_OK}]]`,
    "--dry-run",
  ];

  /**
   * The measured `create` (under the approved project) succeeds, and the rule
   * is IN FORCE on the same vault — a parentless task is refused. Without the
   * second half a vault where the rule went unparsed would pass every price
   * axis for free. (Deliberately not "the lookups walked the whole vault":
   * a future label index would be a legitimate way not to.)
   */
  async function expectGateWorks(state: CacheState, v: string, spent: { run: Run }): Promise<void> {
    expect({ state, exit: spent.run.exit, stderr: spent.run.exit.length > 0 ? spent.run.stderr : "" }).toEqual({
      state,
      exit: [],
      stderr: "",
    });
    const refused = await runCreate(v, ["--class", "ems__Task", "--label", "Задача без родителя", "--dry-run"]);
    expect({ state, refusedWith4: refused.exit.includes(4) && refused.stderr.includes("CREATION_GATE_REFUSED:") }).toEqual({
      state,
      refusedWith4: true,
    });
  }

  it(`S13 ${REQ} with the cache unable to narrow and every rule key resolving by label, the gate makes no full pass through the cloning metadata reader`, async () => {
    for (const state of CACHE_STATES) {
      const v = await unnarrowedVault(state);
      const files = listMd(v).length;
      const spent = await gateSpend(v, underApproved);
      await expectGateWorks(state, v, spent);
      expect({ state, fullPass: spent.metadata >= files }).toEqual({ state, fullPass: false });
    }
  });

  it(`S13b ${REQ} …nor any full cloning pass at all (structuredClone)`, async () => {
    for (const state of CACHE_STATES) {
      const v = await unnarrowedVault(state);
      const files = listMd(v).length;
      const spent = await gateSpend(v, underApproved);
      await expectGateWorks(state, v, spent);
      expect({ state, cloningPass: spent.clones >= files }).toEqual({ state, cloningPass: false });
    }
  });

  it(`S13c ${REQ} …nor more than one full pass of fresh parses (the scan reads the memoised frontmatter, not a fresh parse per lookup)`, async () => {
    for (const state of CACHE_STATES) {
      const v = await unnarrowedVault(state);
      const files = listMd(v).length;
      const spent = await gateSpend(v, underApproved);
      await expectGateWorks(state, v, spent);
      // "More than one pass", not "a pass": today the planning has parsed every
      // file before the gate runs, but if it stops doing so (ems__Bug de7a7592)
      // the gate's FIRST label lookup legitimately parses each file once into
      // the memo. A re-parse per lookup (M106) is nine passes.
      expect({ state, parsingPasses: spent.parses > files }).toEqual({ state, parsingPasses: false });
    }
  });

  // ── a7181947 Е1: the un-narrowed scan answers exactly what the base scan does
  function lookupVault(): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cli-gate-a7181947-")));
    vaults.push(root);
    const put = (rel: string, text: string): void => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text, "utf-8");
    };
    const typed = `exo__Instance_class:\n  - "[[5e000000-0000-4000-8000-0000000000c1]]"\n`;
    put("a/dup-1.md", `---\nexo__Asset_uid: 5e000000-0000-4000-8000-000000000001\nexo__Asset_label: Дубль\n---\n`);
    put("b/dup-2.md", `---\nexo__Asset_uid: 5e000000-0000-4000-8000-000000000002\nexo__Asset_label: "Дубль"\n${typed}---\n`);
    put("c/array.md", `---\nexo__Asset_uid: 5e000000-0000-4000-8000-000000000003\nexo__Asset_label:\n  - Первый\n  - Дубль\n---\n`);
    put("d/quoted-link.md", `---\nexo__Asset_uid: 5e000000-0000-4000-8000-000000000004\nexo__Asset_label: "[[Метка-ссылка]]"\n---\n`);
    put("e/broken-yaml.md", `---\nexo__Asset_label: Дубль\nexo__Asset_uid: [unclosed\n---\n`);
    put("f/no-frontmatter.md", `exo__Asset_label: Дубль\n`);
    put("g/unreadable.md", `---\nexo__Asset_uid: 5e000000-0000-4000-8000-000000000007\nexo__Asset_label: Единственная\n---\n`);
    put("h/after.md", `---\nexo__Asset_uid: 5e000000-0000-4000-8000-000000000008\nexo__Asset_label: Единственная\n${typed}---\n`);
    return root;
  }

  it(`S14 ${REQ} without an index, findFilesByMetadata answers the base scan's files in the base scan's order`, async () => {
    const root = lookupVault();
    const queries: Record<string, string>[] = [
      { exo__Asset_label: "Дубль" },
      { exo__Asset_label: "Метка-ссылка" },
      { exo__Asset_uid: "5e000000-0000-4000-8000-000000000003" },
      { exo__Asset_label: "Дубль", exo__Instance_class: "[[5e000000-0000-4000-8000-0000000000c1]]" },
      { exo__Asset_label: "Такой метки нет" },
    ];
    const planning = new PlanningFsAdapter(root); // one adapter: the memo is shared, as in `create`
    for (const query of queries) {
      expect({ query, found: await planning.findFilesByMetadata(query) }).toEqual({
        query,
        found: await new NodeFsAdapter(root).findFilesByMetadata(query),
      });
    }
    // Non-vacuous: the duplicate lookup really returns several files, in path order.
    expect((await planning.findFilesByMetadata({ exo__Asset_label: "Дубль" })).slice(0, 3)).toEqual([
      "a/dup-1.md",
      "b/dup-2.md",
      "c/array.md",
    ]);
  });

  it(`S14b ${REQ} an unreadable file is skipped by the un-narrowed scan, and the files after it are still found`, async () => {
    const root = lookupVault();
    const read = NodeFsAdapter.prototype.readFile;
    jest.spyOn(NodeFsAdapter.prototype, "readFile").mockImplementation(function (
      this: InstanceType<typeof NodeFsAdapter>,
      file: string,
    ) {
      if (file.replace(/\\/g, "/") === "g/unreadable.md") return Promise.reject(new Error("EACCES (test)"));
      return read.call(this, file);
    });
    const query = { exo__Asset_label: "Единственная" };
    const found = await new PlanningFsAdapter(root).findFilesByMetadata(query);
    expect(found).toEqual(await new NodeFsAdapter(root).findFilesByMetadata(query));
    expect(found).toEqual(["h/after.md"]);
  });

  it(`S14c ${REQ} a caller mutating the metadata it was handed does not change what the scan finds`, async () => {
    const root = lookupVault();
    const planning = new PlanningFsAdapter(root);
    const handed = await planning.getFileMetadata("a/dup-1.md");
    handed.exo__Asset_label = "Подменённая";
    expect(await planning.findFilesByMetadata({ exo__Asset_label: "Подменённая" })).toEqual([]);
    expect(await planning.findFilesByMetadata({ exo__Asset_label: "Дубль" })).toContain("a/dup-1.md");
  });

  // ── a7181947 Е2: rule candidates = files mentioning the class, any case ─
  const MENTIONS: Record<string, string> = {
    "mentions/uid-upper.md": `UID класса верхним регистром: ${CREATION_GATE_CLASS_UID.toUpperCase()}`,
    "mentions/label-upper.md": `метка класса верхним регистром: ${CREATION_GATE_CLASS_LABEL.toUpperCase()}`,
    "mentions/label-mixed.md": `смешанный регистр: ${CREATION_GATE_CLASS_LABEL.replace(/^e/, "E").replace(/Gate$/, "GATE")}`,
    "mentions/uid-only.md": `только UID: ${CREATION_GATE_CLASS_UID}`,
    "mentions/label-only.md": `только метка: ${CREATION_GATE_CLASS_LABEL}`,
    "mentions/neither.md": "про гейт создания, но без иглы: creation gate",
  };

  function mentionsVault(): string {
    const v = vault();
    let n = 0;
    for (const [rel, body] of Object.entries(MENTIONS)) {
      n += 1;
      writeAsset(v, rel, {
        exo__Asset_uid: `cccc3000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        exo__Asset_label: `"Упоминание ${n}"`,
      }, body);
    }
    return v;
  }

  async function candidatePaths(v: string): Promise<string[]> {
    return (await createFsPolicySource(new PlanningFsAdapter(v)).candidates()).map((c) => c.path).sort();
  }

  it(`S15 ${REQ} the un-narrowed candidate set equals "the lowered text includes the class UID or label"`, async () => {
    const v = mentionsVault();
    const reference = listMd(v)
      .filter((full) => {
        const lower = fs.readFileSync(full, "utf-8").toLowerCase();
        return lower.includes(CREATION_GATE_CLASS_UID.toLowerCase()) || lower.includes(CREATION_GATE_CLASS_LABEL.toLowerCase());
      })
      .map((full) => path.relative(v, full))
      .sort();
    // Non-vacuous: every case variant is in the reference, the needle-less file is not.
    for (const rel of Object.keys(MENTIONS)) {
      expect({ rel, inReference: reference.includes(rel) }).toEqual({ rel, inReference: rel !== "mentions/neither.md" });
    }
    expect(await candidatePaths(v)).toEqual(reference);
  });

  it(`S15b ${REQ} the class LABEL alone makes a file a candidate`, async () => {
    expect(await candidatePaths(mentionsVault())).toContain("mentions/label-only.md");
  });

  it(`S15c ${REQ} the class UID alone makes a file a candidate`, async () => {
    expect(await candidatePaths(mentionsVault())).toContain("mentions/uid-only.md");
  });

  it(`S18 ${REQ} the un-narrowed candidate pass does not case-change a copy of every file`, async () => {
    const v = vault();
    addNoise(v, 20);
    const texts = new Set(listMd(v).map((full) => fs.readFileSync(full, "utf-8")));
    let lowered = 0;
    // Every case-changing copy, not only `toLowerCase`: `toUpperCase` & co.
    // would copy each file just the same.
    const caseMethods = ["toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase"] as const;
    for (const name of caseMethods) {
      const original = String.prototype[name] as (this: string) => string;
      jest.spyOn(String.prototype, name).mockImplementation(function (this: string) {
        if (texts.has(String(this))) lowered += 1;
        return original.call(this);
      });
    }
    // Canary: the spies see a whole file's text being case-changed, by every method.
    const sample = [...texts][0];
    void [sample.toLowerCase(), sample.toUpperCase(), sample.toLocaleLowerCase(), sample.toLocaleUpperCase()];
    expect(lowered).toBe(4);
    lowered = 0;
    const candidates = await createFsPolicySource(new PlanningFsAdapter(v)).candidates();
    expect(candidates.map((c) => c.path)).toContain(prj(RULE));
    expect(lowered).toBe(0);
  });

  // ── a7181947 Е3: the gate's own time in the debug output ───────────────
  type GateLine = { kind: string; data: Record<string, unknown> };

  /** Every `creation gate:` line of a stream, parsed (an unparsable one fails loud). */
  function gateLines(text: string): GateLine[] {
    return text
      .split("\n")
      .filter((line) => line.includes("creation gate:"))
      .map((line) => {
        const m = /^\[[a-z]+\] creation gate: (rule candidates|rules|verdict) (\{.*\})$/.exec(line);
        if (!m) throw new Error(`unparsable creation-gate line: ${line}`);
        return { kind: m[1], data: JSON.parse(m[2]) as Record<string, unknown> };
      });
  }
  const ofKind = (lines: GateLine[], kind: string): Record<string, unknown>[] =>
    lines.filter((l) => l.kind === kind).map((l) => l.data);

  /**
   * A clock that advances 7 ms per read from a large origin: every measured
   * span is a positive multiple of 7, so "sum of spans" relations are exact and
   * a zero means "not counted", never "too fast to see"; and a CLOCK READING
   * printed where a duration belongs is ≥ CLOCK_ORIGIN, so it cannot pass for
   * one (the self-consistency checks alone hold for any additive quantity).
   */
  const CLOCK_ORIGIN = 1e9;
  function tickingClock(): void {
    let now = CLOCK_ORIGIN;
    jest.spyOn(performance, "now").mockImplementation(() => (now += 7));
  }
  /** A logged `ms` that is a duration of this clock: a positive integer far below a reading. */
  const isDuration = (ms: unknown): boolean =>
    Number.isInteger(ms) && (ms as number) >= 7 && (ms as number) < CLOCK_ORIGIN / 1000;

  async function debugged<T>(on: boolean, body: () => Promise<T>): Promise<T> {
    const before = process.env.EXOCORTEX_DEBUG;
    if (on) process.env.EXOCORTEX_DEBUG = "1";
    else delete process.env.EXOCORTEX_DEBUG;
    try {
      return await body();
    } finally {
      if (before === undefined) delete process.env.EXOCORTEX_DEBUG;
      else process.env.EXOCORTEX_DEBUG = before;
    }
  }

  it(`S16 ${REQ} create with EXOCORTEX_DEBUG: one verdict line carrying the gate's own time, one candidates line`, async () => {
    const v = vault();
    tickingClock();
    const run = await debugged(true, () => runCreate(v, underApproved));
    expectNaturalExit(run.exit);
    const lines = gateLines(run.stderr);
    const verdicts = ofKind(lines, "verdict");
    expect(verdicts).toHaveLength(1);
    const [verdict] = verdicts;
    expect(verdict.allowed).toBe(true);
    expect(Number.isInteger(verdict.ms) && (verdict.ms as number) >= 7).toBe(true);
    expect(verdict.sessionMs).toBe(verdict.ms);
    // The judged file: a vault-relative markdown path in the folder the asset
    // is created in (the gate builds its own candidate, so its uid differs
    // from the one in stdout — the folder does not).
    const created = JSON.parse(run.stdout.trim()) as { path: string };
    const judged = String(verdict.path);
    expect({ md: judged.endsWith(".md"), folder: path.dirname(judged) }).toEqual({
      md: true,
      folder: path.dirname(created.path),
    });
    const candidates = ofKind(lines, "rule candidates");
    expect(candidates).toHaveLength(1);
    expect(typeof candidates[0].narrowed).toBe("boolean");
    expect((candidates[0].scanned as number) >= (candidates[0].candidates as number)).toBe(true);
    expect(candidates[0].candidates as number).toBeGreaterThanOrEqual(1);
  });

  it(`S16b ${REQ} without EXOCORTEX_DEBUG the gate prints nothing, and with it nothing reaches stdout`, async () => {
    const v = vault();
    const quiet = await debugged(false, () => runCreate(v, underApproved));
    expectNaturalExit(quiet.exit);
    expect(`${quiet.stdout}${quiet.stderr}`).not.toContain("creation gate:");
    const loud = await debugged(true, () => runCreate(v, underApproved));
    expect(loud.stdout).not.toContain("creation gate:");
    expect(gateLines(loud.stderr).length).toBeGreaterThan(0);
  });

  it(`S16c ${REQ} create's rule load is timed inside its verdict — no separate rules line`, async () => {
    const v = vault();
    tickingClock();
    const run = await debugged(true, () => runCreate(v, underApproved));
    expectNaturalExit(run.exit);
    const lines = gateLines(run.stderr);
    expect(ofKind(lines, "rules")).toEqual([]);
    // …and not because the gate went quiet: its verdict line is there.
    expect(ofKind(lines, "verdict")).toHaveLength(1);
  });

  it(`S16d ${REQ} create's verdict line reports a duration, not a clock reading`, async () => {
    const v = vault();
    tickingClock();
    const run = await debugged(true, () => runCreate(v, underApproved));
    expectNaturalExit(run.exit);
    const [verdict] = ofKind(gateLines(run.stderr), "verdict");
    expect({ ms: verdict.ms, duration: isDuration(verdict.ms) }).toEqual({ ms: verdict.ms, duration: true });
    expect(isDuration(verdict.sessionMs)).toBe(true);
  });

  it(`S16e ${REQ} the rule-candidates line tells the truth: narrowed or not, how many files were scanned, how many mention the class`, async () => {
    // Without a cache: the whole listing is scanned.
    const v = vault();
    const mentioning = listMd(v).filter((full) => {
      const lower = fs.readFileSync(full, "utf-8").toLowerCase();
      return lower.includes(CREATION_GATE_CLASS_UID.toLowerCase()) || lower.includes(CREATION_GATE_CLASS_LABEL.toLowerCase());
    }).length;
    tickingClock();
    const walked = await debugged(true, () => runCreate(v, underApproved));
    expectNaturalExit(walked.exit);
    const [cold] = ofKind(gateLines(walked.stderr), "rule candidates");
    expect(cold).toEqual({
      narrowed: false,
      scanned: listMd(v).length,
      candidates: mentioning,
      ms: cold.ms,
    });
    expect(isDuration(cold.ms)).toBe(true);
    // With a valid cache: narrowed to fewer files, the rule still among the candidates.
    await new CacheManager(v).buildCache();
    const narrowedRun = await debugged(true, () => runCreate(v, underApproved));
    expectNaturalExit(narrowedRun.exit);
    const [warm] = ofKind(gateLines(narrowedRun.stderr), "rule candidates");
    expect(warm.narrowed).toBe(true);
    expect(warm.scanned as number).toBeLessThan(listMd(v).length);
    expect(warm.candidates as number).toBeGreaterThanOrEqual(1);
  });

  it(`S17 ${REQ} create-batch: one rules line, a verdict per item, and the session total is their exact sum; apply: one verdict`, async () => {
    const v = vault();
    tickingClock();
    const batch = await debugged(true, () =>
      runBatch(v, [
        { class: "ems__Task", label: "Первая", properties: { ems__Effort_parent: `[[${PRJ_OK}]]` } },
        { class: "ems__Task", label: "Вторая", properties: { ems__Effort_parent: `[[${PRJ_OK}]]` } },
      ]),
    );
    expect(batch.exit).toEqual([0]);
    const lines = gateLines(batch.stderr);
    const rules = ofKind(lines, "rules");
    const verdicts = ofKind(lines, "verdict");
    expect(rules).toHaveLength(1);
    expect(verdicts).toHaveLength(2);
    expect(rules[0].ms as number).toBeGreaterThanOrEqual(7);
    const sum = (rules[0].ms as number) + verdicts.reduce((acc, d) => acc + (d.ms as number), 0);
    expect(verdicts[1].sessionMs).toBe(sum);

    const applied = await debugged(true, () =>
      runApply(v, CMD.createTask, prj(PRJ_OK), { label: "Задача из apply" }),
    );
    expectNaturalExit(applied.exit);
    const applyLines = gateLines(applied.stderr);
    expect(ofKind(applyLines, "verdict")).toHaveLength(1);
    expect(ofKind(applyLines, "rules")).toEqual([]);
  });

  it(`S17c ${REQ} create-batch's rules line reports the rules it loaded and a duration, not a clock reading`, async () => {
    const v = vault();
    tickingClock();
    const batch = await debugged(true, () =>
      runBatch(v, [{ class: "ems__Task", label: "Единственная", properties: { ems__Effort_parent: `[[${PRJ_OK}]]` } }]),
    );
    expect(batch.exit).toEqual([0]);
    const [rules] = ofKind(gateLines(batch.stderr), "rules");
    expect({ policies: rules.policies, duration: isDuration(rules.ms), sessionDuration: isDuration(rules.sessionMs) }).toEqual({
      policies: 1,
      duration: true,
      sessionDuration: true,
    });
  });

  it(`S17b ${REQ} a refusal is reported as allowed:false; with no rule, create-batch reports 0 rules and judges nothing`, async () => {
    const v = vault();
    const refused = await debugged(true, () =>
      runCreate(v, ["--class", "ems__Task", "--label", "Задача без родителя", "--dry-run"]),
    );
    expect(refused.exit).toContain(4);
    expect(ofKind(gateLines(refused.stderr), "verdict").map((d) => d.allowed)).toEqual([false]);

    const bare = vault({ rule: false });
    const batch = await debugged(true, () =>
      runBatch(bare, [{ class: "ems__Task", label: "Без правила" }]),
    );
    expect(batch.exit).toEqual([0]);
    const lines = gateLines(batch.stderr);
    expect(ofKind(lines, "rules").map((d) => d.policies)).toEqual([0]);
    expect(ofKind(lines, "verdict")).toEqual([]);
  });

  // a7181947 (independent review of the implementation, MEDIUM): the `rules`
  // line exists only on create-batch, so S16b — which runs `create` — cannot
  // see it leak past EXOCORTEX_DEBUG.
  it(`S16f ${REQ} create-batch without EXOCORTEX_DEBUG prints no gate line, and its stdout stays the JSON result`, async () => {
    const v = vault();
    const items = [
      { class: "ems__Task", label: "Тихая первая", properties: { ems__Effort_parent: `[[${PRJ_OK}]]` } },
      { class: "ems__Task", label: "Тихая вторая", properties: { ems__Effort_parent: `[[${PRJ_OK}]]` } },
    ];
    const quiet = await debugged(false, () => runBatch(v, items));
    expect(quiet.exit).toEqual([0]);
    expect(`${quiet.stdout}${quiet.stderr}`).not.toContain("creation gate:");
    expect((JSON.parse(quiet.stdout.trim()) as unknown[]).length).toBe(2);
    // …and not because create-batch never reaches the gate: with the variable
    // the same batch prints its rules line and a verdict per item.
    const loud = await debugged(true, () =>
      runBatch(v, items.map((item) => ({ ...item, label: `${item.label} (громко)` }))),
    );
    expect(loud.exit).toEqual([0]);
    const lines = gateLines(loud.stderr);
    expect({ rules: ofKind(lines, "rules").length, verdicts: ofKind(lines, "verdict").length }).toEqual({
      rules: 1,
      verdicts: 2,
    });
  });
});

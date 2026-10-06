/**
 * req f5b79260-f87c-4e73-8a34-19da341c7ec9 (ticket 316dd2be) — the creation
 * gate in the PLUGIN: the same rule as the CLI, judged at the plugin's write
 * points, with the plugin's own lookup (metadataCache to locate, a fresh disk
 * read for frontmatter, the disk itself on a cold start) and one session per
 * command execution.
 *
 * The App fake models the real contract that matters here: `metadataCache` is
 * a SNAPSHOT taken when the app is built — a file written later is invisible to
 * it (Obsidian indexes asynchronously), while `vault.read` sees the disk.
 *
 * Axis names (U<n>) lead each title: they are the machine key of the mutant
 * driver (`creation-gate-f5b79260.*.spec.json` next to this file).
 */
import * as fs from "fs";
import * as path from "path";
import type { App, TFile } from "obsidian";
import { parseCandidateFrontmatter } from "@kitelev/exocortex-core";
import { createPluginCreationGate } from "../../../../src/infrastructure/creationGate/PluginCreationGate";

const REQ = "@req:f5b79260-f87c-4e73-8a34-19da341c7ec9";

const C = {
  effort: "086f71fa-dd30-4284-90cf-e609f2a6c461",
  task: "1b20a8f0-d745-4e93-91db-4531b3df120e",
  project: "7db5eeff-718a-49b0-8d2b-39b084a356e3",
  gate: "d4cde00a-c211-437b-9ba1-71223a15551b",
};
const GATE_PROPS: Record<string, string> = {
  guardedClass: "6c16eb5b-28da-4182-a692-6450731dcf7e",
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
};
const APPROVED = "985dca1d-6bf7-4f30-98f6-204ffcf650ff";
const RFC_A = "aaaa0000-0000-4000-8000-0000000000a1";
const PRJ_OK = "bbbb0000-0000-4000-8000-000000000001";
const PRJ_STALE = "bbbb0000-0000-4000-8000-000000000005";
const RULE = "eeee0000-0000-4000-8000-000000000001";
const NEW_PRJ = "ffff0000-0000-4000-8000-0000000000a1";
const NEW_TASK = "ffff0000-0000-4000-8000-0000000000b1";
const NEW_TASK2 = "ffff0000-0000-4000-8000-0000000000b2";

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

function baseFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const put = (p: string, fm: Fm): void => {
    files.set(p, md(fm));
  };
  const cls = (uid: string, label: string, supers: string[] = []): void =>
    put(`ems/${uid}.md`, {
      exo__Asset_uid: uid,
      exo__Asset_label: label,
      ...(supers.length > 0 ? { exo__Class_superClass: supers.map(link) } : {}),
    });
  cls(C.effort, "ems__Effort");
  cls(C.task, "ems__Task", [C.effort]);
  cls(C.project, "ems__Project", [C.effort]);
  cls(C.gate, "exocmd__CreationGate");
  for (const [field, uid] of Object.entries(GATE_PROPS)) {
    put(`exocmd/${uid}.md`, { exo__Asset_uid: uid, exo__Asset_label: `exocmd__CreationGate_${field}` });
  }
  put(`ems/${PROP.effortParent}.md`, { exo__Asset_uid: PROP.effortParent, exo__Asset_label: "ems__Effort_parent" });
  put(`exo/${PROP.relates}.md`, { exo__Asset_uid: PROP.relates, exo__Asset_label: "exo__Asset_relates" });
  put(`exodev/${PROP.rfcStatus}.md`, { exo__Asset_uid: PROP.rfcStatus, exo__Asset_label: "exodev__RFC_status" });
  put(`exodev/${APPROVED}.md`, { exo__Asset_uid: APPROVED, exo__Asset_label: "exodev__RFCStatusApproved" });
  put(`exodev/${RFC_A}.md`, { exo__Asset_uid: RFC_A, exo__Asset_label: '"RFC"', exodev__RFC_status: link(APPROVED) });
  put(`exodev/${PRJ_OK}.md`, {
    exo__Asset_uid: PRJ_OK,
    exo__Asset_label: '"Проект под одобренным"',
    exo__Instance_class: [link(C.project)],
    exo__Asset_relates: link(RFC_A),
  });
  put(`exodev/${PRJ_STALE}.md`, {
    exo__Asset_uid: PRJ_STALE,
    exo__Asset_label: '"Проект, связанный только что"',
    exo__Instance_class: [link(C.project)],
    exo__Asset_relates: link(RFC_A),
  });
  put(`exodev/${RULE}.md`, {
    exo__Asset_uid: RULE,
    exo__Asset_label: '"Гейт Double Diamond"',
    exo__Instance_class: [link(C.gate)],
    exocmd__CreationGate_guardedClass: [link(C.task), link(C.project)],
    exocmd__CreationGate_chainProperty: link(PROP.effortParent),
    exocmd__CreationGate_anchorClass: [link(C.project)],
    exocmd__CreationGate_directionProperty: link(PROP.relates),
    exocmd__CreationGate_statusProperty: link(PROP.rfcStatus),
    exocmd__CreationGate_allowedStatus: [link(APPROVED)],
  });
  return files;
}

interface FakeVault {
  app: App;
  files: Map<string, string>;
  /** How often the gate touched each source: disk (`read` / `cachedRead`) and the frontmatter index. */
  calls: { read: number; cachedRead: number; getFileCache: number };
  /** Put a file on "disk" as another writer would (the sync): a new mtime unless one is given; invisible to metadataCache. */
  arrive(p: string, text: string, mtime?: number): void;
  mtimeOf(p: string): number;
  /** Obsidian catches up: metadataCache now holds the file's current frontmatter. */
  index(p: string): void;
  /** The next `cachedRead` of these paths throws (a transient read failure). */
  failOnce: Set<string>;
  /** IFileSystemWriter-shaped (the grounding engine's writer). */
  writer: { createFile(p: string, c: string): Promise<string>; fileExists(p: string): Promise<boolean> };
  /** IVaultAdapter-shaped (`create`, as the duplicate service uses it). */
  vaultAdapter: { create(p: string, c: string): Promise<{ path: string }>; exists(p: string): Promise<boolean> };
}

/**
 * `metadataCache` is a snapshot of `files` at build time, optionally with
 * per-path overrides (a stale index entry); `initialized: false` + no cache
 * entries models the cold start.
 */
function makeVault(
  options: { cold?: boolean; staleCache?: Record<string, Fm>; withoutRule?: boolean } = {},
): FakeVault {
  const files = baseFiles();
  if (options.withoutRule) files.delete(`exodev/${RULE}.md`);
  const mtimes = new Map<string, number>([...files.keys()].map((p) => [p, 1_000]));
  let clock = 2_000;
  const calls = { read: 0, cachedRead: 0, getFileCache: 0 };
  const failOnce = new Set<string>();
  const tfile = (p: string): TFile =>
    ({
      path: p,
      basename: p.replace(/^.*\//, "").replace(/\.md$/, ""),
      extension: "md",
      stat: { mtime: mtimes.get(p) ?? 0, size: (files.get(p) ?? "").length },
    }) as unknown as TFile;
  const snapshot = new Map<string, Record<string, unknown>>();
  if (!options.cold) {
    for (const [p, text] of files) snapshot.set(p, parseCandidateFrontmatter(text));
    for (const [p, fm] of Object.entries(options.staleCache ?? {})) {
      snapshot.set(p, parseCandidateFrontmatter(md(fm)));
    }
  }
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.keys()].map(tfile),
      read: async (f: TFile) => {
        calls.read++;
        if (failOnce.delete(f.path)) throw new Error(`EIO: ${f.path}`);
        return files.get(f.path) ?? "";
      },
      cachedRead: async (f: TFile) => {
        calls.cachedRead++;
        if (failOnce.delete(f.path)) throw new Error(`EIO: ${f.path}`);
        return files.get(f.path) ?? "";
      },
    },
    metadataCache: {
      initialized: !options.cold,
      getFileCache: (f: TFile) => {
        calls.getFileCache++;
        const fm = snapshot.get(f.path);
        return fm ? { frontmatter: fm } : null;
      },
      getFirstLinkpathDest: (linkpath: string) => {
        for (const p of snapshot.keys()) {
          if (p.endsWith(`/${linkpath}.md`)) return tfile(p);
        }
        return null;
      },
    },
  } as unknown as App;
  const write = (p: string, c: string): void => {
    if (files.has(p)) throw new Error(`File already exists: ${p}`);
    files.set(p, c);
    mtimes.set(p, clock++);
  };
  return {
    app,
    files,
    calls,
    arrive: (p, text, mtime) => {
      files.set(p, text);
      mtimes.set(p, mtime ?? clock++);
    },
    mtimeOf: (p) => mtimes.get(p) ?? 0,
    index: (p) => {
      snapshot.set(p, parseCandidateFrontmatter(files.get(p) ?? ""));
    },
    failOnce,
    writer: {
      createFile: async (p, c) => {
        write(p, c);
        return p;
      },
      fileExists: async (p) => files.has(p),
    },
    vaultAdapter: {
      create: async (p, c) => {
        write(p, c);
        return { path: p };
      },
      exists: async (p) => files.has(p),
    },
  };
}

const ruleText = (): string => baseFiles().get(`exodev/${RULE}.md`) as string;
const project = (uid: string, extra: Fm = {}): string =>
  md({ exo__Asset_uid: uid, exo__Asset_label: '"Новый проект"', exo__Instance_class: [link(C.project)], ...extra });
const task = (uid: string, extra: Fm = {}): string =>
  md({ exo__Asset_uid: uid, exo__Asset_label: '"Новая задача"', exo__Instance_class: [link(C.task)], ...extra });

describe("creation gate in the plugin (req f5b79260)", () => {
  it(`U0a ${REQ} ExocortexPlugin hands the grounding engine a GATED writer`, () => {
    const source = fs.readFileSync(path.join(__dirname, "../../../../src/ExocortexPlugin.ts"), "utf-8");
    expect(source).toMatch(/new GroundingExecutor\(\s*obsidianFs,\s*creationGate\.engineWriter\(obsidianFs\),/);
  });

  it(`U0b ${REQ} ExocortexPlugin hands the service registry GATED adapters`, () => {
    const source = fs.readFileSync(path.join(__dirname, "../../../../src/ExocortexPlugin.ts"), "utf-8");
    expect(source).toMatch(/fileSystemAdapter: creationGate\.serviceAdapter\(obsidianFs\),/);
    expect(source).toMatch(/creationGate\.serviceAdapter\(this\.vaultAdapter\)/);
  });

  it(`U0c ${REQ} ExocortexPlugin scopes every engine execution to one gate session`, () => {
    const source = fs.readFileSync(path.join(__dirname, "../../../../src/ExocortexPlugin.ts"), "utf-8");
    expect(source).toMatch(/creationGate\.scopeExecutions\(this\.groundingExecutor\);/);
  });

  it(`U0d ${REQ} the sync composition stays ungated — it delivers, it does not create`, () => {
    const sync = fs.readFileSync(
      path.join(__dirname, "../../../../src/infrastructure/adapters/SyncDepsFactory.ts"),
      "utf-8",
    );
    expect(sync).not.toMatch(/CreationGate|creationGate/);
  });

  it(`U1 ${REQ} the engine writer refuses a task without an approved chain and writes a legal one`, async () => {
    const v = makeVault();
    const gate = createPluginCreationGate(v.app);
    const writer = gate.engineWriter(v.writer);
    await expect(writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK))).rejects.toThrow(
      /^CREATION_GATE_REFUSED: ⛔ Правило допуска «Гейт Double Diamond»/,
    );
    expect(v.files.has(`inbox/${NEW_TASK}.md`)).toBe(false);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK, { ems__Effort_parent: link(PRJ_OK) }));
    expect(v.files.has(`inbox/${NEW_TASK}.md`)).toBe(true);
  });

  it(`U2 ${REQ} a service adapter's create (duplicate, GenericAssetCreationService) is judged too`, async () => {
    const v = makeVault();
    const adapter = createPluginCreationGate(v.app).serviceAdapter(v.vaultAdapter);
    await expect(adapter.create(`inbox/${NEW_TASK}.md`, task(NEW_TASK))).rejects.toThrow(/CREATION_GATE_REFUSED/);
    expect(v.files.has(`inbox/${NEW_TASK}.md`)).toBe(false);
  });

  it(`U3 ${REQ} one execution: a parent created by an earlier step — invisible to metadataCache — is found`, async () => {
    // The child names its parent by LABEL. The vault's file list sees a new
    // file at once (so a UID-named parent is found by basename even without
    // the journal), but its label lives only in the frontmatter index, which
    // has not caught up — only the execution journal knows it.
    const v = makeVault();
    const gate = createPluginCreationGate(v.app);
    const writer = gate.engineWriter(v.writer);
    const executor = {
      async execute(): Promise<void> {
        await writer.createFile(`exodev/${NEW_PRJ}.md`, project(NEW_PRJ, { exo__Asset_relates: link(RFC_A) }));
        await writer.createFile(
          `exodev/${NEW_TASK}.md`,
          task(NEW_TASK, { ems__Effort_parent: '"[[Новый проект]]"' }),
        );
      },
    };
    gate.scopeExecutions(executor);
    await executor.execute();
    expect(v.files.has(`exodev/${NEW_TASK}.md`)).toBe(true);
  });

  it(`U3j ${REQ} inside a scope the execution journal carries what was just written`, async () => {
    const v = makeVault();
    const gate = createPluginCreationGate(v.app);
    const writer = gate.engineWriter(v.writer);
    await gate.scope.run(async () => {
      await writer.createFile(`exodev/${NEW_PRJ}.md`, project(NEW_PRJ, { exo__Asset_relates: link(RFC_A) }));
      await writer.createFile(`exodev/${NEW_TASK}.md`, task(NEW_TASK, { ems__Effort_parent: link(NEW_PRJ) }));
    });
    expect(v.files.has(`exodev/${NEW_TASK}.md`)).toBe(true);
  });

  it(`U4 ${REQ} frontmatter is read FRESH from disk — a stale metadataCache entry does not decide`, async () => {
    // The cache still shows the project WITHOUT its direction (a property_set
    // of the same composite has not been indexed yet); the disk has it.
    const v = makeVault({
      staleCache: {
        [`exodev/${PRJ_STALE}.md`]: {
          exo__Asset_uid: PRJ_STALE,
          exo__Asset_label: '"Проект, связанный только что"',
          exo__Instance_class: [link(C.project)],
        },
      },
    });
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK, { ems__Effort_parent: link(PRJ_STALE) }));
    expect(v.files.has(`inbox/${NEW_TASK}.md`)).toBe(true);
  });

  it(`U5 ${REQ} on a cold start (metadataCache not ready) the rule is read from disk`, async () => {
    const v = makeVault({ cold: true });
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await expect(writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK))).rejects.toThrow(/CREATION_GATE_REFUSED/);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK, { ems__Effort_parent: link(PRJ_OK) }));
    expect(v.files.has(`inbox/${NEW_TASK}.md`)).toBe(true);
  });

  it(`U6 ${REQ} cold: one disk pass, then only what changed — each creation re-reads just the file the previous one wrote`, async () => {
    const v = makeVault({ cold: true, withoutRule: true });
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    const before = v.files.size;
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    expect(v.calls.cachedRead).toBe(before);
    await writer.createFile(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ));
    await writer.createFile(`inbox/${NEW_TASK2}.md`, task(NEW_TASK2));
    // N for the first pass, then one per file the previous command wrote — and
    // nothing else: no rule ⇒ no chain walk ⇒ no fresh read of any asset.
    expect(v.calls.cachedRead + v.calls.read).toBe(before + 2);
    expect(v.files.has(`inbox/${NEW_TASK2}.md`)).toBe(true);
  });

  it(`U6f ${REQ} cold: two judgements with nothing changed in between read the disk once`, async () => {
    const v = makeVault({ cold: true, withoutRule: true });
    const gate = createPluginCreationGate(v.app);
    await gate.scope.assertAllowed(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    await gate.scope.assertAllowed(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ));
    expect(v.calls.cachedRead + v.calls.read).toBe(v.files.size);
  });

  it(`U6b ${REQ} cold: a rule the sync delivers between two commands acts at once`, async () => {
    const v = makeVault({ cold: true, withoutRule: true });
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    v.arrive(`exodev/${RULE}.md`, ruleText());
    await expect(writer.createFile(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
    expect(v.files.has(`inbox/${NEW_PRJ}.md`)).toBe(false);
  });

  it(`U6c ${REQ} cold: a file edited in place into a rule — SAME size, newer mtime — acts at once`, async () => {
    const v = makeVault({ cold: true, withoutRule: true });
    const host = `exodev/host.md`;
    const rule = ruleText();
    v.arrive(host, "x".repeat(rule.length)); // before the first pass: a plain file of the rule's size
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    v.arrive(host, rule);
    await expect(writer.createFile(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U6g ${REQ} cold: a file edited in place into a rule — OLD mtime, new size — acts at once`, async () => {
    const v = makeVault({ cold: true, withoutRule: true });
    const host = `exodev/${PRJ_STALE}.md`;
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    v.arrive(host, ruleText(), v.mtimeOf(host)); // a writer that preserves mtime
    await expect(writer.createFile(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U6d ${REQ} cold: a rule asset written THROUGH the gate acts on the next command`, async () => {
    const v = makeVault({ cold: true, withoutRule: true });
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    await writer.createFile(`exodev/${RULE}.md`, ruleText());
    await expect(writer.createFile(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U6h ${REQ} cold: a file the gate wrote, edited into a rule before the next command, acts at once`, async () => {
    const v = makeVault({ cold: true, withoutRule: true });
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    v.arrive(`inbox/${NEW_TASK}.md`, ruleText()); // the user / replace-instance-class turns it into a rule
    await expect(writer.createFile(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U6e ${REQ} cold: a file whose read failed is read again on the next command`, async () => {
    const v = makeVault({ cold: true });
    v.failOnce.add(`exodev/${RULE}.md`);
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK)); // the rule was unreadable: no rule seen
    await expect(writer.createFile(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U8 ${REQ} warm: a rule that reaches metadataCache between two commands acts at once`, async () => {
    const v = makeVault({ withoutRule: true });
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    v.arrive(`exodev/${RULE}.md`, ruleText());
    v.index(`exodev/${RULE}.md`);
    await expect(writer.createFile(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  // ── Interleaving: persistent TFile objects whose `stat` is replaced IN PLACE
  //    on a change (as Obsidian's vault.onChange does), reads that can be held.
  function liveVault(extra: Record<string, string>) {
    const files = baseFiles();
    files.delete(`exodev/${RULE}.md`);
    for (const [p, t] of Object.entries(extra)) files.set(p, t);
    let clock = 2_000;
    const tfiles = new Map<string, TFile>();
    const mk = (p: string): TFile =>
      ({
        path: p,
        basename: p.replace(/^.*\//, "").replace(/\.md$/, ""),
        extension: "md",
        stat: { mtime: 1_000, size: (files.get(p) ?? "").length },
      }) as unknown as TFile;
    for (const p of files.keys()) tfiles.set(p, mk(p));
    const holds = new Map<string, Promise<void>>();
    const failOnce = new Set<string>();
    /** What Obsidian's read cache still holds (a lagging `cachedRead`). */
    const staleCache = new Map<string, string>();
    const readNow = async (f: TFile, cached: boolean): Promise<string> => {
      if (failOnce.delete(f.path)) throw new Error(`EIO: ${f.path}`);
      const text = (cached ? staleCache.get(f.path) : undefined) ?? files.get(f.path) ?? "";
      const hold = holds.get(f.path);
      if (hold) {
        holds.delete(f.path);
        await hold;
      }
      return text; // the bytes as of the start of the read
    };
    const app = {
      vault: {
        getMarkdownFiles: () => [...tfiles.values()],
        read: (f: TFile) => readNow(f, false),
        cachedRead: (f: TFile) => readNow(f, true),
      },
      metadataCache: { initialized: false, getFileCache: () => null, getFirstLinkpathDest: () => null },
    } as unknown as App;
    const change = (p: string, text: string): void => {
      files.set(p, text);
      const f = tfiles.get(p) ?? mk(p);
      (f as unknown as { stat: { mtime: number; size: number } }).stat = { mtime: clock++, size: text.length };
      tfiles.set(p, f);
    };
    /** Hold the next read of `p` until the returned release is called. */
    const hold = (p: string): (() => void) => {
      let release!: () => void;
      holds.set(p, new Promise<void>((r) => (release = r)));
      return () => release();
    };
    const held = (p: string): boolean => holds.has(p);
    return { app, change, hold, held, failOnce, staleCache };
  }
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const HOST = "exodev/host.md";

  it(`U9 ${REQ} cold: a file edited into a rule WHILE its read is in flight is seen by the next command`, async () => {
    const v = liveVault({ [HOST]: "plain\n" });
    const gate = createPluginCreationGate(v.app);
    const release = v.hold(HOST);
    const first = gate.scope.assertAllowed(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    while (v.held(HOST)) await tick();
    v.change(HOST, ruleText());
    release();
    await first;
    await expect(gate.scope.assertAllowed(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U9b ${REQ} cold: a slow reader of the OLD text finishing after a reader of the NEW one does not hide the rule`, async () => {
    const v = liveVault({ [HOST]: "plain\n" });
    const gate = createPluginCreationGate(v.app);
    const releaseA = v.hold(HOST);
    const a = gate.scope.assertAllowed(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    while (v.held(HOST)) await tick();
    v.change(HOST, ruleText());
    await expect(gate.scope.assertAllowed(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
    releaseA();
    await a;
    await expect(gate.scope.assertAllowed(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U9c ${REQ} cold: a KNOWN rule whose re-read fails stays a rule for that command`, async () => {
    const v = liveVault({ [HOST]: ruleText() });
    const gate = createPluginCreationGate(v.app);
    await expect(gate.scope.assertAllowed(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
    v.change(HOST, ruleText() + "\n"); // still a rule, new fingerprint
    v.failOnce.add(HOST); // its re-read fails once
    await expect(gate.scope.assertAllowed(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U9d ${REQ} cold: a changed file is re-read from DISK, not from a lagging read cache`, async () => {
    const v = liveVault({ [HOST]: "plain\n" });
    const gate = createPluginCreationGate(v.app);
    await gate.scope.assertAllowed(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    v.staleCache.set(HOST, "plain\n"); // Obsidian's read cache still holds the old text
    v.change(HOST, ruleText());
    await expect(gate.scope.assertAllowed(`inbox/${NEW_PRJ}.md`, project(NEW_PRJ))).rejects.toThrow(/CREATION_GATE_REFUSED/);
  });

  it(`U7 ${REQ} a warm vault without a rule: one in-memory pass, no name index, no disk read`, async () => {
    const v = makeVault({ withoutRule: true });
    const writer = createPluginCreationGate(v.app).engineWriter(v.writer);
    const files = v.files.size;
    await writer.createFile(`inbox/${NEW_TASK}.md`, task(NEW_TASK));
    expect(v.files.has(`inbox/${NEW_TASK}.md`)).toBe(true);
    expect(v.calls.getFileCache).toBe(files);
    expect(v.calls.read + v.calls.cachedRead).toBe(0);
  });
});


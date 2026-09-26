/**
 * req b6eef8ef (GitHub #4274) — `apply` and `resolve-buttons` name the files the
 * vault loader skipped, and say so when the TARGET itself was skipped.
 *
 * The target is the live shape from #4274: a task with an EMPTY optional
 * property (`ems__Effort_parent:`), which the #2997 invariant drops whole. The
 * vault is built by copying the REAL `exoas-exocmd` + `exoas-exo` submodules,
 * so `start-effort` is the production command with its production binding and
 * precondition. Every axis asserts what the command PRINTS (stderr, and stdout
 * for `--json`), not the loader's result object — the field can be right and
 * reach nobody.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");
const { resolveButtonsCommand } = await import("../../src/commands/resolve-buttons.js");

const PACKAGES = path.resolve(import.meta.dirname, "../../..");
const SUBMODULES = ["exoas-exocmd", "exoas-exo"] as const;
const TASK_CLASS = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task
const BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777"; // ems__EffortStatusBacklog

const SKIPPED_REL = "work/aaaaaaaa-6eef-4bef-8000-000000000001.md";
const HEALTHY_REL = "work/aaaaaaaa-6eef-4bef-8000-000000000002.md";

function copyTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".github") continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

function task(uid: string, label: string, emptyParent: boolean): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    "exo__Instance_class:",
    `  - "[[${TASK_CLASS}]]"`,
    `ems__Effort_status: "[[${BACKLOG}]]"`,
    ...(emptyParent ? ["ems__Effort_parent:"] : []),
    "---",
    "",
    label,
    "",
  ].join("\n");
}

const present = SUBMODULES.every((m) => fs.existsSync(path.join(PACKAGES, m)));

(present ? describe : describe.skip)("req b6eef8ef — apply / resolve-buttons surface loader-skipped files", () => {
  let root: string;
  let stderr: string[];
  let stdout: string[];

  function build(dirty: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-b6eef8ef-"));
    for (const m of SUBMODULES) {
      copyTree(path.join(PACKAGES, m), path.join(dir, "assetspaces", "kitelev", m));
    }
    fs.mkdirSync(path.join(dir, "work"), { recursive: true });
    fs.writeFileSync(path.join(dir, HEALTHY_REL), task("aaaaaaaa-6eef-4bef-8000-000000000002", "Healthy Task", false));
    if (dirty) {
      fs.writeFileSync(path.join(dir, SKIPPED_REL), task("aaaaaaaa-6eef-4bef-8000-000000000001", "Skipped Task", true));
    }
    return dir;
  }

  let dirtyVault: string;
  let cleanVault: string;
  beforeAll(() => {
    dirtyVault = build(true);
    cleanVault = build(false);
  });
  afterAll(() => {
    for (const d of [dirtyVault, cleanVault]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  beforeEach(() => {
    stderr = [];
    stdout = [];
    jest.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    }) as never);
    jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderr.push(a.map(String).join(" ") + "\n");
    });
    jest.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      stdout.push(a.map(String).join(" "));
    });
    jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}__`);
    }) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function run(cmd: { parseAsync: (a: string[]) => Promise<unknown> }, args: string[]): Promise<void> {
    try {
      await cmd.parseAsync(["node", ...args]);
    } catch (err) {
      if (!/^__exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  const err = (): string => stderr.join("");
  const itselfSkipped = (rel: string): string => `"${rel}" itself was skipped by the vault loader`;

  it("V1 @req:b6eef8ef-cb8b-4867-8ffc-a885297e6de1 apply names its target as skipped (with the loader's reason) before the refusal it causes", async () => {
    root = dirtyVault;
    await run(applyCommand(), ["apply", "start-effort", SKIPPED_REL, "--vault", root, "--yes"]);
    const e = err();
    const at = e.indexOf(itselfSkipped(SKIPPED_REL));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(e).toMatch(/present but empty/);
    const refusal = e.indexOf("❌", at);
    expect(refusal).toBeGreaterThan(at);
  }, 90_000);

  it("V2 @req:b6eef8ef-cb8b-4867-8ffc-a885297e6de1 apply on a healthy target lists the skipped file and does not call the target skipped", async () => {
    root = dirtyVault;
    await run(applyCommand(), ["apply", "start-effort", HEALTHY_REL, "--vault", root, "--yes", "--dry-run"]);
    const e = err();
    expect(e).toContain("skipped by the vault loader — they contributed no triples:");
    expect(e).toContain(SKIPPED_REL);
    expect(e).not.toContain(itselfSkipped(HEALTHY_REL));
  }, 90_000);

  it("V3 @req:b6eef8ef-cb8b-4867-8ffc-a885297e6de1 resolve-buttons --json keeps stdout one document and names the skipped target on stderr", async () => {
    root = dirtyVault;
    await run(resolveButtonsCommand(), ["resolve-buttons", SKIPPED_REL, "--vault", root, "--json"]);
    const doc = JSON.parse(stdout.join("\n")) as Record<string, unknown>;
    expect(Array.isArray(doc["visible"])).toBe(true);
    expect(err()).toContain(itselfSkipped(SKIPPED_REL));
  }, 90_000);

  it("V4 @req:b6eef8ef-cb8b-4867-8ffc-a885297e6de1 on a cache hit the target line names no cause the cache does not know", async () => {
    root = dirtyVault;
    await run(applyCommand(), ["apply", "start-effort", SKIPPED_REL, "--vault", root, "--yes", "--use-cache", "--dry-run"]);
    stderr.length = 0;
    await run(applyCommand(), ["apply", "start-effort", SKIPPED_REL, "--vault", root, "--yes", "--use-cache", "--dry-run"]);
    const e = err();
    expect(e).toContain(`"${SKIPPED_REL}" contributed no triples`);
    expect(e).toContain("does not record WHY");
    expect(e).not.toContain(itselfSkipped(SKIPPED_REL));
  }, 120_000);

  it("V5 @req:b6eef8ef-cb8b-4867-8ffc-a885297e6de1 a clean vault prints no skipped-files line from apply or resolve-buttons", async () => {
    root = cleanVault;
    await run(applyCommand(), ["apply", "start-effort", HEALTHY_REL, "--vault", root, "--yes", "--dry-run"]);
    await run(resolveButtonsCommand(), ["resolve-buttons", HEALTHY_REL, "--vault", root, "--json"]);
    expect(err()).not.toMatch(/skipped by the vault loader|contributed no triples/);
  }, 90_000);
});

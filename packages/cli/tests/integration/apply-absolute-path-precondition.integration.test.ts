/**
 * Issue #3788 — CLI `apply` rejects valid status-transitions when the target is
 * passed as an ABSOLUTE path (and #3789 — a no-status standalone task can still
 * enter the gomoiconic lifecycle).
 *
 * Root cause (confirmed against source + empirically): `executeOnTarget` derived
 * the precondition's `$target` IRI via `vaultPathToIRI(targetRelative)` from the
 * RAW user-supplied path. The triple store is built by NoteToRDFConverter from
 * each note's VAULT-RELATIVE `file.path` (subject = `vaultPathToIRI(path)`), so
 * when the caller passes an ABSOLUTE path the derived IRI is the malformed
 * `obsidian://vault//abs/...`, which no subject in the store matches. The
 * SPARQL-ASK precondition's `$target ems:Effort_status ?s` / `$target
 * exo:Asset_uid ?u` then bind nothing → ASK is false → "Precondition not
 * satisfied" even though the asset genuinely satisfies it (exactly the reported
 * symptom: "ASK true in the store but apply rejects"). The Obsidian plugin never
 * hits this because `TFile.path` is always vault-relative; the CLI is the only
 * surface that accepts a raw path string — hence the parity gap.
 *
 * Fix: canonicalise the target to a vault-relative path (`relative(vaultPath,
 * resolve(vaultPath, input))`) before deriving the IRI / adapter lookup / the
 * grounding's path argument, and reject paths that escape the vault.
 *
 * Production-shape (test-fixture-realism): these tests run the REAL `apply`
 * pipeline against a temp vault (no `--dry-run`; the mutated file is read back —
 * `dry-run-preview-not-real-output.md`):
 *   apply → NoteToRDFConverter.convertVault → CommandResolver.loadCommand →
 *   PreconditionEvaluator.evaluate (real SPARQL-ASK) → GroundingExecutor.
 *
 * Revert-verify (integration-test-revert-verify): with the fix reverted (use the
 * raw `targetRelative` for `targetIRI`), the ABSOLUTE-path test goes RED
 * ("Precondition not satisfied", no mutation); with the fix it is GREEN. The
 * RELATIVE-path test passes both ways (it was never broken) — it guards against
 * a regression of the working direction.
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

const { applyCommand } = await import("../../src/commands/apply.js");

// Real UID-canon vocabulary so NoteToRDFConverter resolves the status wikilinks
// to the SAME symbolic IRIs the precondition's `FILTER(?s IN (...))` references
// (the enum labels are `ems__<Local>` → `ems#<Local>`).
const TASK_CLASS = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task
const STATUS_BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777"; // ems__EffortStatusBacklog
const STATUS_DOING = "027e78f4-6e16-4b36-b8fb-5510507d5745"; // ems__EffortStatusDoing

// GroundingType catalog UID (packages/core/src/domain/constants/GroundingTypeUIDs.ts)
const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";

// Fixture command / precondition / grounding (local UIDs).
const CMD = "37880000-0000-0000-0000-000000000001";
const PRECOND = "37880000-0000-0000-0000-000000000002";
const GROUNDING = "37880000-0000-0000-0000-000000000003";

const fm = (lines: string[]): string => ["---", ...lines, "---", ""].join("\n");

// Mirrors the real "Allow transition to Doing (from ToDo / Backlog)" precondition
// (asset 575404fc) — gates on current status ∈ {ToDo, Backlog} and not a prototype.
// Single-line so it lives in a YAML single-quoted scalar (the inner SPARQL
// double-quotes around "Prototype" stay literal — no escaping needed).
const PRECOND_ASK =
  "PREFIX exo: <https://exocortex.my/ontology/exo#> " +
  "PREFIX ems: <https://exocortex.my/ontology/ems#> " +
  'ASK { FILTER NOT EXISTS { $target exo:Instance_class ?p . FILTER(STRENDS(STR(?p), "Prototype")) } ' +
  "$target ems:Effort_status ?s . " +
  "FILTER(?s IN (" +
  "<https://exocortex.my/ontology/ems#EffortStatusToDo>, " +
  "<https://exocortex.my/ontology/ems#EffortStatusBacklog>)) }";

const BACKLOG_ENUM_MD = fm([
  `exo__Asset_uid: ${STATUS_BACKLOG}`,
  `exo__Asset_label: ems__EffortStatusBacklog`,
]);
const DOING_ENUM_MD = fm([
  `exo__Asset_uid: ${STATUS_DOING}`,
  `exo__Asset_label: ems__EffortStatusDoing`,
]);
const TASK_CLASS_MD = fm([
  `exo__Asset_uid: ${TASK_CLASS}`,
  `exo__Asset_label: ems__Task`,
]);
const CMD_MD = fm([
  `exo__Asset_uid: ${CMD}`,
  `exo__Asset_label: "Start Effort (3788 fixture)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class: ["[[exocmd__Command]]"]`,
  `exocmd__Command_cliName: start-effort-3788`,
  `exocmd__Command_precondition: "[[${PRECOND}|precondition]]"`,
  `exocmd__Command_grounding: "[[${GROUNDING}|g]]"`,
]);
const PRECOND_MD = fm([
  `exo__Asset_uid: ${PRECOND}`,
  `exo__Asset_label: "Allow transition to Doing (3788 fixture)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class: ["[[exocmd__Precondition]]"]`,
  `exocmd__Precondition_sparqlAsk: '${PRECOND_ASK}'`,
]);
const GROUNDING_MD = fm([
  `exo__Asset_uid: ${GROUNDING}`,
  `exo__Asset_label: "Set status to Doing (3788 fixture)"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
  `exocmd__Grounding_targetProperty: "ems__Effort_status"`,
  // targetValueRef wraps the constant UID as "[[<uid>]]" in the executor.
  `exocmd__Grounding_targetValueRef: "${STATUS_DOING}"`,
]);

function targetTaskMd(uid: string): string {
  return [
    ...fm([
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "Backlog task ${uid}"`,
      `exo__Instance_class: ["[[${TASK_CLASS}]]"]`,
      `ems__Effort_status: "[[${STATUS_BACKLOG}]]"`,
    ])
      .split("\n")
      .slice(0, -1),
    `# Backlog task`,
    "",
  ].join("\n");
}

function buildVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3788-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");
  write(STATUS_BACKLOG, BACKLOG_ENUM_MD);
  write(STATUS_DOING, DOING_ENUM_MD);
  write(TASK_CLASS, TASK_CLASS_MD);
  write(CMD, CMD_MD);
  write(PRECOND, PRECOND_MD);
  write(GROUNDING, GROUNDING_MD);
  return root;
}

describe("Issue #3788 — CLI apply accepts an absolute target path (precondition $target parity)", () => {
  let root: string;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__process_exit_${code ?? 0}__`);
      }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    root = buildVault();
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  async function runApply(targetPath: string): Promise<void> {
    const cmd = applyCommand();
    try {
      await cmd.parseAsync([
        "node",
        "apply",
        "start-effort-3788",
        targetPath,
        "--vault",
        root,
        "--yes",
      ]);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  function writeBacklogTask(uid: string): { rel: string; abs: string } {
    const rel = `${uid}.md`;
    fs.writeFileSync(path.join(root, rel), targetTaskMd(uid), "utf-8");
    return { rel, abs: path.join(root, rel) };
  }

  function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), "utf-8");
  }

  function errored(): boolean {
    return consoleErrorSpy.mock.calls.some((c) =>
      /Precondition not satisfied/.test(String(c[0])),
    );
  }

  it("@req:a8d01c40-2902-45e2-ba28-501144ad1632 applies start-effort to a Backlog task given an ABSOLUTE path — precondition passes and status is set to Doing (real mutation)", async () => {
    const { rel, abs } = writeBacklogTask(
      "37889999-0000-0000-0000-0000000000a1",
    );

    await runApply(abs); // absolute path — the #3788 trigger

    expect(errored()).toBe(false);
    const written = read(rel);
    // The grounding actually mutated the file: status flipped Backlog → Doing.
    expect(written).toContain(`ems__Effort_status: "[[${STATUS_DOING}]]"`);
    expect(written).not.toContain(`[[${STATUS_BACKLOG}]]`);
  });

  it("@req:a8d01c40-2902-45e2-ba28-501144ad1632 applies start-effort given a vault-RELATIVE path — status is set to Doing (parity, working direction)", async () => {
    const { rel } = writeBacklogTask("37889999-0000-0000-0000-0000000000a2");

    await runApply(rel); // relative path — never broken; regression guard

    expect(errored()).toBe(false);
    const written = read(rel);
    expect(written).toContain(`ems__Effort_status: "[[${STATUS_DOING}]]"`);
  });

  it("rejects a target outside the vault without crashing (no false mutation)", async () => {
    const outside = path.join(os.tmpdir(), "definitely-not-in-vault.md");
    fs.writeFileSync(outside, "not a vault asset", "utf-8");
    try {
      await runApply(outside);
      const sawOutsideError = consoleErrorSpy.mock.calls.some((c) =>
        /outside the vault/.test(String(c[0])),
      );
      expect(sawOutsideError).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

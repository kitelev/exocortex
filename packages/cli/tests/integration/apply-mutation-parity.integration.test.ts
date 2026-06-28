/**
 * Issue #3779 — CLI mutation parity: homoiconic `relabel` (set exo__Asset_label
 * + sync aliases mirror) and explicit-parent (`set-parent`).
 *
 * Exercises the REAL `apply` pipeline against a temp vault (no --dry-run; we
 * read the mutated file back — `dry-run-preview-not-real-output.md`):
 *
 *   apply → hydrate triple store (NoteToRDFConverter) → CommandResolver →
 *   GroundingExecutor → property_set / property_append / composite, with the
 *   new `$input.<key>` named-input substitution (#3779) that lets a vault
 *   grounding bind an inputSchema-named CLI input (`--input '{"label":...}'`
 *   / `'{"parent":...}'`).
 *
 * Both gaps closed here previously forced raw `Edit`:
 *   Gap 1 — no command to relabel an asset (set exo__Asset_label + aliases).
 *   Gap 2 — link-to-parent could not target an explicit parent UID.
 *
 * Production-shape: the grounding assets use UID-canon, real GroundingType
 * catalog UIDs, and the symbolic class-label form so NoteToRDFConverter emits
 * `rdf:type exocmd:Command`/`Grounding` without needing the TBox class defs in
 * the fixture (same technique as apply-targetvaluequery.integration.test.ts).
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

// GroundingType catalog UIDs (packages/core/src/domain/constants/GroundingTypeUIDs.ts)
const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";
const GT_PROPERTY_APPEND = "572f7e69-a8a1-42f6-8113-5aa65cc4b552";
const GT_COMPOSITE = "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3";

const TASK_CLASS = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task

// --- set-label (relabel) command + composite grounding -----------------------
const SET_LABEL_CMD = "f7790001-0000-0000-0000-000000000001";
const SET_LABEL_GROUNDING = "f7790001-0000-0000-0000-000000000002";
const SET_LABEL_STEP_LABEL = "f7790001-0000-0000-0000-000000000003";
const SET_LABEL_STEP_ALIAS = "f7790001-0000-0000-0000-000000000004";

// --- set-parent command + grounding ------------------------------------------
const SET_PARENT_CMD = "f7790002-0000-0000-0000-000000000001";
const SET_PARENT_GROUNDING = "f7790002-0000-0000-0000-000000000002";

const fm = (lines: string[]): string => ["---", ...lines, "---", ""].join("\n");

const SET_LABEL_CMD_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_CMD}`,
  `exo__Asset_label: "Set Label"`,
  `exo__Instance_class: ["[[exocmd__Command]]"]`,
  `exocmd__Command_grounding: "[[${SET_LABEL_GROUNDING}|g]]"`,
  `exocmd__Command_cliName: set-label`,
]);

const SET_LABEL_GROUNDING_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_GROUNDING}`,
  `exo__Asset_label: "Set label composite"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_COMPOSITE}]]"`,
  `exocmd__Grounding_steps:`,
  `  - "[[${SET_LABEL_STEP_LABEL}|set label]]"`,
  `  - "[[${SET_LABEL_STEP_ALIAS}|append alias]]"`,
]);

const SET_LABEL_STEP_LABEL_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_STEP_LABEL}`,
  `exo__Asset_label: "Set asset label"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
  `exocmd__Grounding_targetProperty: "exo__Asset_label"`,
  // named-input substitution (#3779): bound from --input '{"label":...}'
  `exocmd__Grounding_targetValueLiteral: "$input.label"`,
]);

const SET_LABEL_STEP_ALIAS_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_STEP_ALIAS}`,
  `exo__Asset_label: "Append new label to aliases"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_APPEND}]]"`,
  `exocmd__Grounding_targetProperty: "aliases"`,
  `exocmd__Grounding_appendExpression: "$input.label"`,
]);

const SET_PARENT_CMD_MD = fm([
  `exo__Asset_uid: ${SET_PARENT_CMD}`,
  `exo__Asset_label: "Set Parent"`,
  `exo__Instance_class: ["[[exocmd__Command]]"]`,
  `exocmd__Command_grounding: "[[${SET_PARENT_GROUNDING}|g]]"`,
  `exocmd__Command_cliName: set-parent`,
]);

const SET_PARENT_GROUNDING_MD = fm([
  `exo__Asset_uid: ${SET_PARENT_GROUNDING}`,
  `exo__Asset_label: "Set parent grounding"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
  `exocmd__Grounding_targetProperty: "ems__Effort_parent"`,
  // targetValueRef wraps the resolved value as "[[<uid>]]" in the executor;
  // the named-input token is resolved before wrapping (#3779).
  `exocmd__Grounding_targetValueRef: "$input.parent"`,
]);

function targetMd(uid: string, label: string, withAlias: boolean): string {
  const lines = [
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
  ];
  if (withAlias) {
    lines.push(`aliases:`, `  - "${label}"`);
  }
  lines.push(`exo__Instance_class: ["[[${TASK_CLASS}]]"]`);
  return [...fm(lines).split("\n").slice(0, -1), `# ${label}`, ""].join("\n");
}

function buildVault(): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3779-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");
  write(SET_LABEL_CMD, SET_LABEL_CMD_MD);
  write(SET_LABEL_GROUNDING, SET_LABEL_GROUNDING_MD);
  write(SET_LABEL_STEP_LABEL, SET_LABEL_STEP_LABEL_MD);
  write(SET_LABEL_STEP_ALIAS, SET_LABEL_STEP_ALIAS_MD);
  write(SET_PARENT_CMD, SET_PARENT_CMD_MD);
  write(SET_PARENT_GROUNDING, SET_PARENT_GROUNDING_MD);
  return { root };
}

describe("Issue #3779 — CLI apply mutation parity (relabel + explicit parent)", () => {
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
    const vault = buildVault();
    root = vault.root;
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  async function runApply(
    cmdSlug: string,
    targetRel: string,
    input?: string,
  ): Promise<void> {
    const cmd = applyCommand();
    const args = ["node", "apply", cmdSlug, targetRel, "--vault", root, "--yes"];
    if (input) args.push("--input", input);
    try {
      await cmd.parseAsync(args);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  function writeTarget(
    uid: string,
    label: string,
    withAlias = true,
  ): string {
    const rel = `${uid}.md`;
    fs.writeFileSync(path.join(root, rel), targetMd(uid, label, withAlias), "utf-8");
    return rel;
  }

  function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), "utf-8");
  }

  it("@req:f7790000-3779-4aaa-8aaa-000000000001 set-parent sets ems__Effort_parent to an explicit UID as a wikilink (Gap 2, real mutation)", async () => {
    const rel = writeTarget("aaaaaaaa-3779-4000-8000-000000000001", "Child Task");
    const parentUid = "99999999-3779-4000-8000-000000000009";

    await runApply("set-parent", rel, `{"parent":"${parentUid}"}`);

    const written = read(rel);
    // UWI child→parent, wikilink form (not a bare scalar).
    expect(written).toContain(`ems__Effort_parent: "[[${parentUid}]]"`);
    // The literal placeholder must never persist.
    expect(written).not.toContain("$input.parent");
  });

  it("@req:f7790000-3779-4aaa-8aaa-000000000001 set-parent fails loud (no write) when the named input key is missing", async () => {
    const rel = writeTarget("aaaaaaaa-3779-4000-8000-000000000002", "Child Task");
    const before = read(rel);

    // wrong key — provides `value`, grounding expects `parent`
    await runApply("set-parent", rel, `{"value":"99999999-3779-4000-8000-000000000009"}`);

    const after = read(rel);
    expect(after).toBe(before); // unchanged
    expect(after).not.toContain("ems__Effort_parent");
    expect(after).not.toContain("$input.parent");
  });

  it("@req:f7790000-3779-4bbb-8bbb-000000000002 set-label relabels exo__Asset_label and appends the new label to aliases (Gap 1, real mutation)", async () => {
    const rel = writeTarget("bbbbbbbb-3779-4000-8000-000000000001", "Old Label");

    await runApply("set-label", rel, `{"label":"New Label"}`);

    const written = read(rel);
    expect(written).toMatch(/exo__Asset_label: New Label\b/);
    // aliases mirror: old retained, new appended (set-based dedup).
    expect(written).toContain(`- "Old Label"`);
    expect(written).toContain(`- "New Label"`);
    expect(written).not.toContain("$input.label");
    // body H1 is left untouched (freeform) — decision documented in #3779.
    expect(written).toContain("# Old Label");
  });

  it("@req:f7790000-3779-4bbb-8bbb-000000000002 set-label YAML-quotes a label containing ': ' so the file stays parseable", async () => {
    const rel = writeTarget("bbbbbbbb-3779-4000-8000-000000000002", "Old Label");

    await runApply("set-label", rel, `{"label":"Meeting: Q3 review"}`);

    const written = read(rel);
    // A label with `: ` MUST be double-quoted (else invalid YAML → unparseable).
    expect(written).toContain(`exo__Asset_label: "Meeting: Q3 review"`);
    expect(written).toContain(`- "Meeting: Q3 review"`);
  });
});

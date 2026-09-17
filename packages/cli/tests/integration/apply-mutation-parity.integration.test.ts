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
import * as yaml from "js-yaml";

const { applyCommand } = await import("../../src/commands/apply.js");

// GroundingType catalog UIDs (packages/core/src/domain/constants/GroundingTypeUIDs.ts)
const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";
const GT_PROPERTY_APPEND = "572f7e69-a8a1-42f6-8113-5aa65cc4b552";
const GT_COMPOSITE = "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3";
const GT_PROPERTY_DELETE = "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5"; // #3798
// SubstitutionToken instance for `$nowLocal` — the REAL exoas-exocmd token UID
// (8bc0c038), mirrored here so CommandResolver resolves the updatedAt step's
// `[[<uid>]]` wikilink to the token's exo__Asset_label ("$nowLocal") exactly as
// it does against the production grounding (#3798).
const NOWLOCAL_TOKEN = "8bc0c038-1fd1-4ad3-a4a4-178a64b492b8";

const TASK_CLASS = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task

// --- set-label (relabel) command + composite grounding -----------------------
const SET_LABEL_CMD = "f7790001-0000-0000-0000-000000000001";
const SET_LABEL_GROUNDING = "f7790001-0000-0000-0000-000000000002";
const SET_LABEL_STEP_LABEL = "f7790001-0000-0000-0000-000000000003";
const SET_LABEL_STEP_ALIAS = "f7790001-0000-0000-0000-000000000004";
// #3798 — two new steps in the composite: clear aliases (property_delete) +
// bump updatedAt (property_set $nowLocal). Mirror the production grounding
// 3dfa3379 [set label, DELETE aliases, append alias, set updatedAt].
const SET_LABEL_STEP_DELETE = "f7790001-0000-0000-0000-000000000005";
const SET_LABEL_STEP_UPDATED = "f7790001-0000-0000-0000-000000000006";

// --- LEGACY (pre-#3798) 2-step set-label — used ONLY by the self-contained
//     revert-verify test to prove the OLD grounding exhibits the aliases bug
//     (accumulates aliases). Its "does not bump updatedAt" half became the
//     EXECUTOR's guarantee under req 454ccedf (ticket 533856e4) — see B6 below.
const SET_LABEL_LEGACY_CMD = "f7790001-0000-0000-0000-0000000000a1";
const SET_LABEL_LEGACY_GROUNDING = "f7790001-0000-0000-0000-0000000000a2";

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

// #3798 — 4-step composite: set label → CLEAR aliases → re-mirror single alias
// → bump updatedAt. Mirrors production grounding 3dfa3379 exactly.
const SET_LABEL_GROUNDING_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_GROUNDING}`,
  `exo__Asset_label: "Set label composite"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_COMPOSITE}]]"`,
  `exocmd__Grounding_steps:`,
  `  - "[[${SET_LABEL_STEP_LABEL}|set label]]"`,
  `  - "[[${SET_LABEL_STEP_DELETE}|clear aliases]]"`,
  `  - "[[${SET_LABEL_STEP_ALIAS}|append alias]]"`,
  `  - "[[${SET_LABEL_STEP_UPDATED}|bump updatedAt]]"`,
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

// #3798 step 2 — clear the entire aliases list so the next append re-mirrors
// ONLY the new canonical label (no stale accumulation).
const SET_LABEL_STEP_DELETE_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_STEP_DELETE}`,
  `exo__Asset_label: "Clear aliases before re-mirroring label"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_DELETE}]]"`,
  `exocmd__Grounding_targetProperty: "aliases"`,
]);

const SET_LABEL_STEP_ALIAS_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_STEP_ALIAS}`,
  `exo__Asset_label: "Append new label to aliases"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_APPEND}]]"`,
  `exocmd__Grounding_targetProperty: "aliases"`,
  `exocmd__Grounding_appendExpression: "$input.label"`,
]);

// #3798 step 4 — stamp the last-modified invariant via the $nowLocal token
// (wikilink → CommandResolver resolves to the token's exo__Asset_label).
const SET_LABEL_STEP_UPDATED_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_STEP_UPDATED}`,
  `exo__Asset_label: "Bump updatedAt on set-label"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
  `exocmd__Grounding_targetProperty: "exo__Asset_updatedAt"`,
  `exocmd__Grounding_targetValueSubstitution: "[[${NOWLOCAL_TOKEN}]]"`,
]);

// SubstitutionToken instance — its exo__Asset_label IS the token string the
// executor's substituteVariables regex resolves ($nowLocal → local timestamp).
const NOWLOCAL_TOKEN_MD = fm([
  `exo__Asset_uid: ${NOWLOCAL_TOKEN}`,
  `exo__Asset_label: "$nowLocal"`,
  `exo__Instance_class: ["[[exocmd__SubstitutionToken]]"]`,
]);

// LEGACY (pre-#3798) 2-step composite — reused by the revert-verify test.
const SET_LABEL_LEGACY_CMD_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_LEGACY_CMD}`,
  `exo__Asset_label: "Set Label (legacy)"`,
  `exo__Instance_class: ["[[exocmd__Command]]"]`,
  `exocmd__Command_grounding: "[[${SET_LABEL_LEGACY_GROUNDING}|g]]"`,
  `exocmd__Command_cliName: set-label-legacy`,
]);
const SET_LABEL_LEGACY_GROUNDING_MD = fm([
  `exo__Asset_uid: ${SET_LABEL_LEGACY_GROUNDING}`,
  `exo__Asset_label: "Set label composite (legacy 2-step)"`,
  `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
  `exocmd__Grounding_type: "[[${GT_COMPOSITE}]]"`,
  `exocmd__Grounding_steps:`,
  `  - "[[${SET_LABEL_STEP_LABEL}|set label]]"`,
  `  - "[[${SET_LABEL_STEP_ALIAS}|append alias]]"`,
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

function targetMd(
  uid: string,
  label: string,
  withAlias: boolean,
  // #3798 — extra pre-existing aliases (simulate accumulation from prior
  // relabels) so "no accumulation" assertions are meaningful; also seed an old
  // updatedAt so "updatedAt bumped" is observable.
  opts: { aliases?: string[]; updatedAt?: string } = {},
): string {
  const lines = [
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
  ];
  const aliases = opts.aliases ?? (withAlias ? [label] : []);
  if (aliases.length > 0) {
    lines.push(`aliases:`, ...aliases.map((a) => `  - "${a}"`));
  }
  if (opts.updatedAt) {
    lines.push(`exo__Asset_updatedAt: ${opts.updatedAt}`);
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
  write(SET_LABEL_STEP_DELETE, SET_LABEL_STEP_DELETE_MD); // #3798
  write(SET_LABEL_STEP_ALIAS, SET_LABEL_STEP_ALIAS_MD);
  write(SET_LABEL_STEP_UPDATED, SET_LABEL_STEP_UPDATED_MD); // #3798
  write(NOWLOCAL_TOKEN, NOWLOCAL_TOKEN_MD); // #3798
  write(SET_LABEL_LEGACY_CMD, SET_LABEL_LEGACY_CMD_MD); // #3798 revert-verify
  write(SET_LABEL_LEGACY_GROUNDING, SET_LABEL_LEGACY_GROUNDING_MD);
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
    opts: { aliases?: string[]; updatedAt?: string } = {},
  ): string {
    const rel = `${uid}.md`;
    fs.writeFileSync(
      path.join(root, rel),
      targetMd(uid, label, withAlias, opts),
      "utf-8",
    );
    return rel;
  }

  function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), "utf-8");
  }

  /** The frontmatter block parsed by the REAL js-yaml (ticket 4f226028). */
  function loadFrontmatter(content: string): Record<string, unknown> {
    const m = /^---\n([\s\S]*?)\n---/.exec(content);
    if (!m) throw new Error("no frontmatter block");
    return yaml.load(m[1]) as Record<string, unknown>;
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

  // ---------------------------------------------------------------------------
  // req 454ccedf (ticket 533856e4) — B1. `set-parent` is a SINGLE property_set
  // grounding with no data-side "Bump updatedAt" step, and on the published CLI
  // 16.240.4 it left exo__Asset_updatedAt untouched (repro n = 3 by execution:
  // set-parent / set-criticality-low / rollback-to-backlog; control set-label
  // — a composite carrying step 49e00287 — bumped). The stamp now lives in the
  // executor, so this real `apply` over a temp vault observes it on disk.
  // ---------------------------------------------------------------------------
  it("@req:454ccedf-fefe-4cfe-bdf7-704f050c1f34 B1 set-parent (single property_set, no data-side bump step) stamps exo__Asset_updatedAt on the real apply path", async () => {
    const rel = writeTarget(
      "aaaaaaaa-3779-4000-8000-000000000011",
      "Child Task",
      true,
      { updatedAt: "2020-01-01T00:00:00" },
    );
    const parentUid = "99999999-3779-4000-8000-000000000009";

    await runApply("set-parent", rel, `{"parent":"${parentUid}"}`);

    const written = read(rel);
    expect(written).toContain(`ems__Effort_parent: "[[${parentUid}]]"`);
    expect(written).not.toContain("exo__Asset_updatedAt: 2020-01-01T00:00:00");
    expect(written).toMatch(
      /^exo__Asset_updatedAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/m,
    );
    // exactly one key line — replaced, not duplicated
    expect((written.match(/^exo__Asset_updatedAt:/gm) ?? []).length).toBe(1);
    // the file stays parseable by the real parser
    expect(loadFrontmatter(written).ems__Effort_parent).toBe(`[[${parentUid}]]`);
  });

  it("@req:454ccedf-fefe-4cfe-bdf7-704f050c1f34 B7 re-applying set-parent with the SAME parent is a no-op: file byte-identical, updatedAt not touched", async () => {
    const rel = writeTarget(
      "aaaaaaaa-3779-4000-8000-000000000012",
      "Child Task",
      true,
      { updatedAt: "2020-01-01T00:00:00" },
    );
    const parentUid = "99999999-3779-4000-8000-000000000009";
    await runApply("set-parent", rel, `{"parent":"${parentUid}"}`);
    const afterFirst = read(rel);
    expect(afterFirst).not.toContain("exo__Asset_updatedAt: 2020-01-01T00:00:00");

    // Freeze what the first apply wrote by seeding it back with a stale stamp
    // that the second (idempotent) apply must NOT overwrite.
    const frozen = afterFirst.replace(
      /^exo__Asset_updatedAt: .*$/m,
      "exo__Asset_updatedAt: 2021-02-03T04:05:06",
    );
    fs.writeFileSync(path.join(root, rel), frozen, "utf-8");

    await runApply("set-parent", rel, `{"parent":"${parentUid}"}`);

    expect(read(rel)).toBe(frozen);
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

  it("@req:f7790000-3779-4bbb-8bbb-000000000002 set-label relabels exo__Asset_label, syncs the single canonical alias (no accumulation) and bumps exo__Asset_updatedAt (Gap 1 + #3798, real mutation)", async () => {
    // Seed pre-existing accumulated aliases + a stale updatedAt so the fix is
    // observable (the OLD 2-step composite kept "Old Label" + "Stale Alias" and
    // never touched updatedAt — see the revert-verify test below).
    const rel = writeTarget(
      "bbbbbbbb-3779-4000-8000-000000000001",
      "Old Label",
      true,
      { aliases: ["Old Label", "Stale Alias"], updatedAt: "2020-01-01T00:00:00" },
    );

    await runApply("set-label", rel, `{"label":"New Label"}`);

    const written = read(rel);
    expect(written).toMatch(/exo__Asset_label: New Label\b/);
    // #3798 — aliases MIRROR the current label as the SINGLE canonical entry:
    // the prior aliases are cleared, not accumulated.
    expect(written).toContain(`- "New Label"`);
    expect(written).not.toContain(`- "Old Label"`); // stale label alias cleared
    expect(written).not.toContain(`- "Stale Alias"`);
    // exactly one alias entry.
    expect((written.match(/^\s+- /gm) ?? []).length).toBe(1);
    // #3798 — updatedAt is bumped (no longer the seeded 2020 value; local
    // timestamp shape YYYY-MM-DDTHH:MM:SS).
    expect(written).not.toContain("exo__Asset_updatedAt: 2020-01-01T00:00:00");
    expect(written).toMatch(
      /exo__Asset_updatedAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\b/,
    );
    expect(written).not.toContain("$input.label");
    expect(written).not.toContain("$nowLocal"); // token resolved, not literal
    // body H1 is left untouched (freeform) — decision documented in #3779.
    expect(written).toContain("# Old Label");
  });

  it("@req:f7790000-3779-4bbb-8bbb-000000000002 set-label accepts a label that resolves to free text containing a '$value' substring (no false-reject / no clobber)", async () => {
    const rel = writeTarget("bbbbbbbb-3779-4000-8000-000000000003", "Old Label");

    // The resolved label legitimately contains the literal token "$value".
    // The template gate must check the TEMPLATE (not the resolved output), and
    // single-pass substitution must not re-scan/clobber the inserted text.
    await runApply("set-label", rel, `{"label":"Fix $value handling"}`);

    const written = read(rel);
    expect(written).toContain("exo__Asset_label: Fix $value handling");
    expect(written).toContain(`- "Fix $value handling"`);
    // #3798 — single canonical alias (the seeded "Old Label" alias is cleared).
    expect(written).not.toContain(`- "Old Label"`);
  });

  it("@req:f7790000-3779-4bbb-8bbb-000000000002 set-label YAML-quotes a label containing ': ' so the file stays parseable", async () => {
    const rel = writeTarget("bbbbbbbb-3779-4000-8000-000000000002", "Old Label");

    await runApply("set-label", rel, `{"label":"Meeting: Q3 review"}`);

    const written = read(rel);
    // A label with `: ` MUST be double-quoted (else invalid YAML → unparseable).
    expect(written).toContain(`exo__Asset_label: "Meeting: Q3 review"`);
    expect(written).toContain(`- "Meeting: Q3 review"`);
    // #3798 — single canonical alias (the seeded "Old Label" alias is cleared).
    expect(written).not.toContain(`- "Old Label"`);
    // ticket 4f226028 (I3) — "stays parseable" is asserted with the REAL parser.
    const fm = loadFrontmatter(written);
    expect(fm.exo__Asset_label).toBe("Meeting: Q3 review");
    expect(fm.aliases).toEqual(["Meeting: Q3 review"]);
  });

  // ---------------------------------------------------------------------------
  // Ticket 4f226028 — the aliases entry is written by the SAME YAML escaper as
  // the label. Before the fix `property_append` hand-wrapped the value in `"…"`
  // without escaping, so a label carrying an interior `"` produced
  // `  - "Label with "inner" quotes"` — js-yaml: `bad indentation of a mapping
  // entry`, the whole frontmatter unparseable (req 27fbe40b broke
  // `requirements-trace` on every PR) — and a `\` was silently swallowed
  // (alias ≠ label, file still parseable). Each axis runs the REAL published
  // composite shape through the real `apply` pipeline and parses the mutated
  // file with js-yaml (the parser the CLI adapters and Obsidian use).
  // ---------------------------------------------------------------------------
  it.each([
    ["I1 interior double quotes", 'Label with "inner" quotes'],
    ["I2 hash + backslash", "Note #42 about \\ backslash"],
    ["I2b colon-space + quoted wikilink", 'Key: value (x: "[[y]]", z)'],
  ])(
    "@req:f7790000-3779-4bbb-8bbb-000000000002 %s — set-label escapes the alias like the label: file parses, aliases deep-equals [label]",
    async (_axis, label) => {
      const rel = writeTarget("bbbbbbbb-3779-4000-8000-00000000004f", "Old Label");

      await runApply("set-label", rel, JSON.stringify({ label }));

      const written = read(rel);
      const fm = loadFrontmatter(written); // throws on the pre-fix shape
      expect(fm.exo__Asset_label).toBe(label);
      expect(fm.aliases).toEqual([label]);
      expect(written).not.toContain(`- "Old Label"`);
    },
  );

  // ---------------------------------------------------------------------------
  // #3798 revert-verify (integration-test-revert-verify): the OLD 2-step
  // composite (property_set label + property_append aliases — NO delete, NO
  // updatedAt step) must EXHIBIT the DATA bug the 4-step fix removes (BUG 1,
  // aliases accumulate). This runs the legacy grounding through the SAME real
  // `apply` pipeline, proving the aliases assertions above are non-vacuous.
  //
  // req 454ccedf (ticket 533856e4) — B6: the former "BUG 2 — updatedAt is NOT
  // bumped" half of this axis is INVERTED on purpose. The bump is no longer a
  // property of the data (step 49e00287) but of the EXECUTOR: a grounding
  // without the step still records the modification. What #3798 fixed in the
  // data was the aliases mirror; the updatedAt half is now guaranteed one level
  // below, for every mutating grounding, including this legacy one.
  // ---------------------------------------------------------------------------
  it("@req:f7790000-3779-4bbb-8bbb-000000000002 @req:454ccedf-fefe-4cfe-bdf7-704f050c1f34 REVERT-VERIFY / B6: the legacy 2-step set-label still ACCUMULATES aliases (the #3798 data bug) but the executor bumps updatedAt even without the data step", async () => {
    const rel = writeTarget(
      "bbbbbbbb-3779-4000-8000-0000000000af",
      "Old Label",
      true,
      { aliases: ["Old Label", "Stale Alias"], updatedAt: "2020-01-01T00:00:00" },
    );

    await runApply("set-label-legacy", rel, `{"label":"New Label"}`);

    const written = read(rel);
    expect(written).toMatch(/exo__Asset_label: New Label\b/);
    // BUG 1 — aliases accumulate: the old aliases are RETAINED, new is appended.
    expect(written).toContain(`- "Old Label"`);
    expect(written).toContain(`- "Stale Alias"`);
    expect(written).toContain(`- "New Label"`);
    expect((written.match(/^\s+- /gm) ?? []).length).toBeGreaterThan(1);
    // B6 — updatedAt IS bumped by the executor although the legacy composite
    // carries no "Bump updatedAt" step (was: "BUG 2 — stays the seeded value").
    expect(written).not.toContain("exo__Asset_updatedAt: 2020-01-01T00:00:00");
    expect(written).toMatch(
      /^exo__Asset_updatedAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/m,
    );
    expect((written.match(/^exo__Asset_updatedAt:/gm) ?? []).length).toBe(1);
  });
});

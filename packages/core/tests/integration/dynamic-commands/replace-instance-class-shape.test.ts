/**
 * Data-guard (req 0e237a8c) — asserts the REAL `packages/exoas-exocmd` data still
 * ships `replace-instance-class` as a CLI-only reclass command wired to the
 * `property_replace` primitive.
 *
 * ⛤ Why a DATA-guard and not an engine test. The engine half is already locked by
 * req `02de55a4` (`GroundingExecutor.property_replace.test.ts` R1–R9 +
 * `CommandResolver.propertyReplace.test.ts` P1–P5, 12 mutants): that suite proves
 * the primitive swaps exactly one element and refuses an absent `from`. This file
 * proves the SHIPPED DATA still declares the command on top of it. The two fail for
 * different reasons, and only this one reds if someone unwires the command in the
 * assetspace while the engine stays correct.
 *
 * ⛔ D3 is the load-bearing axis and the reason this file exists. The command is
 * CLI-only BY DECISION: `apply <cliName>` resolves it directly, bypassing bindings,
 * while an inline button renders ONLY when an `exocmd__CommandBinding` points at it
 * (`homoiconic-command-orphan-binding`). The operation rewrites `exo__Instance_class`,
 * which `set-property` refuses outright, and nobody decided to hand that to a human
 * in one click across every vault where `exoas-exocmd` is mounted. A future session
 * seeing "no button" and helpfully adding a binding would silently widen that radius.
 *
 * ⛤ The decision is not novel — it is the SIBLING'S precedent. Measured 2026-09-21
 * over the 458 shipped assets: `append-instance-class` (`e258207a`) likewise has
 * ZERO bindings, and of the 73 `exocmd__CommandBinding_command` edges none points at
 * either instance-class command. This guard pins that precedent for the reclass half;
 * the append half is its neighbour's business, so D4 stays a wiring control and does
 * not assert it.
 *
 * Requirement `0e237a8c-2daa-4c4f-add5-bd8f94080bf8` — the binding tag itself lives on
 * the describe below, once, as in this feature's two sibling suites.
 */
import * as fs from "fs";
import * as path from "path";

const SUBMODULE_EXOCMD = path.resolve(
  __dirname,
  "../../../../exoas-exocmd/exocmd",
);

const CMD_REPLACE = "7f1b47a3-9997-4d1f-9c6f-9ca52b06f778";
const CMD_REPLACE_LABEL = "Replace Instance Class";
const GROUNDING_REPLACE = "60db3634-4752-4811-802d-5a28c510a4bc";
const TYPE_PROPERTY_REPLACE = "c8582746-6476-47f7-b0cc-e582c2754d84";

/** The additive sibling — the control (see D4). */
const CMD_APPEND = "e258207a-4544-4809-8ee3-96eb111ecd84";
const TYPE_PROPERTY_APPEND = "572f7e69-a8a1-42f6-8113-5aa65cc4b552";

/** The edge that makes a binding point at a command — the thing D3 hunts for. */
const BINDING_COMMAND_KEY = "exocmd__CommandBinding_command";

function readAsset(uid: string): string {
  const file = path.join(SUBMODULE_EXOCMD, `${uid}.md`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `exoas-exocmd asset ${uid}.md not found at ${file} — is the submodule checked out? ` +
        "(a fresh worktree carries none; `git submodule update --init`)",
    );
  }
  return fs.readFileSync(file, "utf-8");
}

/** Raw frontmatter block, so assertions read the shipped bytes, not a parse of them. */
function frontmatter(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error("asset has no frontmatter block");
  return m[1];
}

/**
 * Every `<uid, CommandBinding_command value>` pair in the assetspace.
 *
 * ⛔ Anchored on the EDGE predicate, not on the CommandBinding class UID: 10 of the
 * 83 assets mentioning that class UID are property definitions whose
 * `exo__Property_domain` is CommandBinding, and counting them would make the
 * predicate mean something other than "a binding points here".
 */
function bindingEdges(): { uid: string; target: string }[] {
  const edges: { uid: string; target: string }[] = [];
  for (const file of fs.readdirSync(SUBMODULE_EXOCMD)) {
    if (!file.endsWith(".md")) continue;
    const fm = frontmatter(
      fs.readFileSync(path.join(SUBMODULE_EXOCMD, file), "utf-8"),
    );
    const m = new RegExp(`^${BINDING_COMMAND_KEY}: *(.+)$`, "m").exec(fm);
    if (m) edges.push({ uid: file.replace(/\.md$/, ""), target: m[1] });
  }
  return edges;
}

describe("replace-instance-class ships as a CLI-only reclass command (@req:0e237a8c-2daa-4c4f-add5-bd8f94080bf8)", () => {
  it("D1 the command declares cliName replace-instance-class and points at the reclass grounding", () => {
    const fm = frontmatter(readAsset(CMD_REPLACE));

    expect(fm).toMatch(/^exocmd__Command_cliName: *"?replace-instance-class"?$/m);
    expect(fm).toMatch(
      new RegExp(`^exocmd__Command_grounding: *"\\[\\[${GROUNDING_REPLACE}\\]\\]"$`, "m"),
    );
    // Destructive: it rewrites a guarded property, so the CLI must prompt without --yes.
    expect(fm).toMatch(/^exocmd__Command_destructive: *"?true"?$/m);
  });

  it("D2 the grounding is property_replace on exo__Instance_class, reading both $input fields", () => {
    const fm = frontmatter(readAsset(GROUNDING_REPLACE));

    expect(fm).toMatch(
      new RegExp(`^exocmd__Grounding_type: *"\\[\\[${TYPE_PROPERTY_REPLACE}\\]\\]"$`, "m"),
    );
    expect(fm).toMatch(/^exocmd__Grounding_targetProperty: *"?exo__Instance_class"?$/m);
    // ⛔ BOTH expressions, pinned to their exact $input keys: the executor refuses when
    // either is absent (req 02de55a4 R6/R7), so a rename here turns the command into a
    // permanent refusal that no engine axis would notice.
    expect(fm).toMatch(/^exocmd__Grounding_replaceFromExpression: *"?\$input\.from"?$/m);
    expect(fm).toMatch(/^exocmd__Grounding_replaceToExpression: *"?\$input\.to"?$/m);
  });

  it("D3 the command stays CLI-only — NO CommandBinding edge points at it", () => {
    const edges = bindingEdges();

    // Both reference forms the assetspace uses — bare `[[uid]]` (68 of 73) and
    // `[[uid|alias]]` (5) — are covered by the UID substring; the label form is
    // matched too, so a binding authored by name would not slip past.
    const pointingAtReplace = edges.filter(
      (e) => e.target.includes(CMD_REPLACE) || e.target.includes(CMD_REPLACE_LABEL),
    );

    expect(pointingAtReplace.map((e) => e.uid)).toEqual([]);

    // Canary: the predicate CAN find edges — an empty result above would otherwise be
    // indistinguishable from a broken scan (renamed predicate, moved directory).
    // Measured 2026-09-21: 73 edges shipped.
    //
    // ⛔ This is the one assertion in the file with NO mutant in the spec set, and that
    // is structural, not an omission: its failure mode is the whole scan going blind
    // (directory moved, predicate renamed across the assetspace), which no single-file
    // from→to mutation can express. Its flip was shown ONCE instead, 2026-09-21: the
    // same predicate over an EMPTY directory left the assertion above GREEN — vacuously,
    // zero edges means zero offending edges — and reddened this line. That is exactly
    // the reading this canary exists to exclude.
    expect(edges.length).toBeGreaterThan(0);
  });

  it("D4 control — the additive sibling append-instance-class is untouched", () => {
    // Stays GREEN under every mutant of the reclass pair: it proves the new command
    // sits BESIDE the existing one rather than replacing or rewiring it.
    const fm = frontmatter(readAsset(CMD_APPEND));

    expect(fm).toMatch(/^exocmd__Command_cliName: *"?append-instance-class"?$/m);

    const groundingUid = /^exocmd__Command_grounding: *"\[\[([0-9a-f-]{36})\]\]"$/m.exec(
      fm,
    )?.[1];
    if (!groundingUid) throw new Error("append command declares no grounding pointer");
    expect(frontmatter(readAsset(groundingUid))).toMatch(
      new RegExp(`^exocmd__Grounding_type: *"\\[\\[${TYPE_PROPERTY_APPEND}\\]\\]"$`, "m"),
    );
  });
});

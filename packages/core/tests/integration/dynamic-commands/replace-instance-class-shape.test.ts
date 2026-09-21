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
import { parseYamlFrontmatterTolerant } from "../../../src/utilities/parseYamlFrontmatter";

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

/**
 * Raw frontmatter block. D1/D2 read it as BYTES on purpose — they pin the exact
 * shipped form of a handful of named predicates, and a parse would let a rewrite
 * of the file's shape pass unnoticed. D3 is the opposite question and parses (below).
 *
 * `label` names the offending file: this runs over every `.md` in the directory, so
 * a stray non-asset file landing there would otherwise raise an exception that reads
 * as a defect in the binding scan rather than as "a non-asset file is here".
 */
function frontmatter(content: string, label: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`${label} has no frontmatter block`);
  return m[1];
}

/**
 * Every `<asset uid, CommandBinding_command targets>` pair in the assetspace.
 *
 * ⛔ The value is read by PARSING the frontmatter, not by matching a line. An earlier
 * revision of this function used `^exocmd__CommandBinding_command: *(.+)$` with the
 * `m` flag, which sees only a value sitting on the key's own line — and that made D3,
 * the one axis this whole file exists for, FALSIFIABLE BY ORDINARY YAML. Measured
 * 2026-09-21, repointing a real binding at the reclass command: written as a block
 * scalar (`>` + an indented line) js-yaml folds it to the identical wikilink string,
 * and written as a single-item block list it yields a one-element array. Production
 * parses frontmatter with js-yaml (`utilities/parseYamlFrontmatter.ts`) and reads this
 * predicate off the resolved graph (`CommandResolver.ts`), so BOTH forms render a live
 * inline button — while the regex reported zero edges and all four axes stayed green.
 * ✅ Parsing covers every spelling by construction: quoting, flow or block, list or
 * scalar, continuation lines. Mutants M10/M11 pin the two that defeated the regex.
 *
 * ⛤ The parser is production's own `parseYamlFrontmatterTolerant`, not a bare
 * `yaml.load`. Three things come with that and none is cosmetic: the YAML 1.1 schema
 * production uses, last-wins tolerance for a duplicate mapping key (a `yaml.load`
 * here threw on it — reintroducing the very fragility class #3800/#3701 that parser
 * exists to absorb, and for ANY of the 458 files, not only binding-bearing ones), and
 * a context label in its warning. A file it genuinely cannot parse is reported BY NAME
 * below rather than skipped: production reads such a file as `{}` and renders no
 * button, so skipping would match production — but silently, and this scan's whole
 * job is to not be silent. Mutant M13 pins the naming; the tolerance half has no
 * mutant because its correct outcome is that nothing reddens, which the driver cannot
 * distinguish from a dead axis — measured once instead, 2026-09-21: a duplicate
 * mapping key injected into an unrelated asset left all four axes green with the
 * mutation applied, where a bare `yaml.load` threw and took D3 down with it.
 *
 * ⚠ This predicate is a strict SUPERSET of what production resolves, never a subset —
 * measured 2026-09-21 by driving real on-disk fixtures through `resolveButtons()`.
 * Two forms it flags that production would NOT render as a button: a multi-item list
 * whose reclass entry is not FIRST (`CommandResolver.getLinkedUID` reads `triples[0]`
 * and nothing else), and `[[uid#anchor]]` (the UUID match is `^…$`-anchored, so the
 * anchor suffix fails it). Flagging them is the right direction — both are bindings
 * whose author meant to bind — but the guarantee is "errs toward flagging", not parity.
 *
 * ⛔ Anchored on the EDGE predicate, not on the CommandBinding class UID. Measured
 * partition of the 83 assets mentioning that class UID: 73 edges + 1 self-referential
 * class definition + 9 property definitions whose `exo__Property_domain` is
 * CommandBinding, remainder 0. (An earlier revision of this comment said "10 property
 * definitions" — that figure came from the subtraction 83 − 73 and named the remainder
 * without ever measuring its composition; the class definition itself is the tenth.)
 */
function bindingEdges(): { uid: string; targets: string[] }[] {
  const edges: { uid: string; targets: string[] }[] = [];
  const unparseable: string[] = [];
  for (const file of fs.readdirSync(SUBMODULE_EXOCMD)) {
    if (!file.endsWith(".md")) continue;
    const fm = frontmatter(
      fs.readFileSync(path.join(SUBMODULE_EXOCMD, file), "utf-8"),
      file,
    );
    const parsed = parseYamlFrontmatterTolerant(fm, file);
    if (parsed === null) {
      unparseable.push(file);
      continue;
    }
    const raw = parsed[BINDING_COMMAND_KEY];
    if (raw === undefined || raw === null) continue;
    edges.push({
      uid: file.replace(/\.md$/, ""),
      targets: (Array.isArray(raw) ? raw : [raw]).map((v) => String(v)),
    });
  }
  if (unparseable.length > 0) {
    // Loud AND named. A bare `yaml.load` here threw a js-yaml exception whose
    // message carries line numbers but no filename — across 458 candidates that
    // leaves the next engineer bisecting. Naming the file is the same lesson
    // `frontmatter`'s `label` parameter above exists for.
    throw new Error(
      "assetspace holds frontmatter this scan cannot judge: " +
        unparseable.join(", "),
    );
  }
  return edges;
}

describe("replace-instance-class ships as a CLI-only reclass command (@req:0e237a8c-2daa-4c4f-add5-bd8f94080bf8)", () => {
  it("D1 the command declares cliName replace-instance-class, is destructive, and points at the reclass grounding", () => {
    const fm = frontmatter(readAsset(CMD_REPLACE), `${CMD_REPLACE}.md`);

    expect(fm).toMatch(/^exocmd__Command_cliName: *"?replace-instance-class"?$/m);
    expect(fm).toMatch(
      new RegExp(`^exocmd__Command_grounding: *"\\[\\[${GROUNDING_REPLACE}\\]\\]"$`, "m"),
    );
    // Destructive: it rewrites a guarded property, so the CLI must prompt without --yes.
    expect(fm).toMatch(/^exocmd__Command_destructive: *"?true"?$/m);
  });

  it("D2 the grounding is property_replace on exo__Instance_class, reading both $input fields", () => {
    const fm = frontmatter(readAsset(GROUNDING_REPLACE), `${GROUNDING_REPLACE}.md`);

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

    // Every reference form is covered: the assetspace ships 68 bare `[[uid]]` and 5
    // `[[uid|alias]]` values, both caught by the UID substring, and a binding authored
    // by NAME is caught by the label. Spelling is no longer a variable — the value
    // arrives already parsed, by production's own parser (see `bindingEdges`, which
    // also records where this errs on the strict side).
    const pointingAtReplace = edges.filter((e) =>
      e.targets.some(
        (t) => t.includes(CMD_REPLACE) || t.includes(CMD_REPLACE_LABEL),
      ),
    );

    expect(pointingAtReplace.map((e) => e.uid)).toEqual([]);

    // Canary: the predicate CAN find edges — an empty result above would otherwise be
    // indistinguishable from a broken scan (renamed predicate, moved directory).
    // Measured 2026-09-21: 73 edges shipped.
    //
    // ⛔ This is the one assertion in the file with NO mutant in the spec set, and that
    // is structural, not an omission: its failure mode is the whole scan going blind
    // (directory moved, predicate renamed across all 73 carriers), and since those 73
    // edges live in 73 DISTINCT files, a single-file from→to mutation can drop the count
    // by at most one, never to zero. Its flip was shown ONCE instead, 2026-09-21: the
    // same predicate over an EMPTY directory left the assertion above GREEN — vacuously,
    // zero edges means zero offending edges — and reddened this line. That is exactly
    // the reading this canary exists to exclude. (It does not claim M8/M10/M11 are the
    // only ways D3 can red: a malformed asset in the directory reds it too, loudly,
    // through `frontmatter`. Loud is not the failure mode the canary guards.)
    expect(edges.length).toBeGreaterThan(0);
  });

  it("D4 control — the additive sibling append-instance-class is untouched", () => {
    // Stays GREEN under every mutant of the reclass pair: it proves the new command
    // sits BESIDE the existing one rather than replacing or rewiring it.
    const fm = frontmatter(readAsset(CMD_APPEND), `${CMD_APPEND}.md`);

    expect(fm).toMatch(/^exocmd__Command_cliName: *"?append-instance-class"?$/m);

    const groundingUid = /^exocmd__Command_grounding: *"\[\[([0-9a-f-]{36})\]\]"$/m.exec(
      fm,
    )?.[1];
    if (!groundingUid) throw new Error("append command declares no grounding pointer");
    expect(frontmatter(readAsset(groundingUid), `${groundingUid}.md`)).toMatch(
      new RegExp(`^exocmd__Grounding_type: *"\\[\\[${TYPE_PROPERTY_APPEND}\\]\\]"$`, "m"),
    );
  });
});

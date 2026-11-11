/**
 * vault-exodev ems__Bug 0cae1d41 — `resolve-buttons` lists a command ONCE even
 * when the asset declares two classes that both bind it.
 *
 * Measured on 2026-11-10 (CLI 17.18.1): a ДТ-задача with classes `ems__Action`
 * + `jedi2__Task` got «Set blocker» twice in `visible` — one entry per matching
 * binding. Founder decision 2026-11-11: one command — one button, fixed in the
 * engine (`CommandResolver.resolveForAssetMulti`), so this oracle, the plugin
 * buttons and the bots reading `visible` all see one entry.
 *
 * Production-shape: real markdown assets through the real pipeline
 * (NoteToRDFConverter → CommandResolver → PreconditionEvaluator), the same
 * layout as `resolve-buttons.integration.test.ts`.
 *
 * Axis names are the FIRST token of the test title (mutant-driver `red_re`).
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { resolveButtons } = await import("../../src/commands/resolve-buttons.js");

const GT_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";

const CLASS_ACT = "0cae0001-0000-4000-8000-000000000001";
const CLASS_DT = "0cae0001-0000-4000-8000-000000000002";
const CMD_BLOCKER = "0cae0002-0000-4000-8000-000000000001";
const CMD_HIDDEN = "0cae0002-0000-4000-8000-000000000002";
const CMD_SINGLE = "0cae0002-0000-4000-8000-000000000003";
const GND = "0cae0003-0000-4000-8000-000000000001";
const PRE_NEVER = "0cae0004-0000-4000-8000-000000000001";
const TARGET_BOTH = "0cae0005-0000-4000-8000-000000000001";
const TARGET_DT = "0cae0005-0000-4000-8000-000000000002";

const fm = (lines: string[]): string => ["---", ...lines, "---", ""].join("\n");

function command(uid: string, label: string, cliName: string, pre?: string): string {
  const lines = [
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class: ["[[exocmd__Command]]"]`,
    `exocmd__Command_cliName: ${cliName}`,
    `exocmd__Command_category: maintenance`,
    `exocmd__Command_grounding: "[[${GND}|g]]"`,
  ];
  if (pre) lines.push(`exocmd__Command_precondition: "[[${pre}|p]]"`);
  return fm(lines);
}

function binding(uid: string, commandUid: string, targetClass: string, order: number): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "binding ${uid}"`,
    `exo__Instance_class: ["[[exocmd__CommandBinding]]"]`,
    `exocmd__CommandBinding_command: "[[${commandUid}]]"`,
    `exocmd__CommandBinding_targetClass: ${targetClass}`,
    `exocmd__CommandBinding_position: inline`,
    `exocmd__CommandBinding_order: ${order}`,
  ]);
}

function buildVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-0cae1d41-"));
  const write = (uid: string, md: string): void =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");

  write(CLASS_ACT, fm([`exo__Asset_uid: ${CLASS_ACT}`, `exo__Asset_label: test__Act`, `exo__Instance_class: ["[[exo__Class]]"]`]));
  write(CLASS_DT, fm([`exo__Asset_uid: ${CLASS_DT}`, `exo__Asset_label: test__Dt`, `exo__Instance_class: ["[[exo__Class]]"]`]));
  write(
    GND,
    fm([
      `exo__Asset_uid: ${GND}`,
      `exo__Asset_label: "noop grounding"`,
      `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
      `exocmd__Grounding_type: "[[${GT_SERVICE_CALL}]]"`,
      `exocmd__Grounding_serviceId: "noop"`,
    ]),
  );
  write(
    PRE_NEVER,
    fm([
      `exo__Asset_uid: ${PRE_NEVER}`,
      `exo__Asset_label: "Never true (fixture)"`,
      `exo__Instance_class: ["[[exocmd__Precondition]]"]`,
      `exocmd__Precondition_sparqlAsk: 'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { $target exo:Asset_label "no such label (fixture)" }'`,
    ]),
  );

  // «Set blocker»-shape: one command, a binding per class, same order.
  write(CMD_BLOCKER, command(CMD_BLOCKER, "Set blocker", "set-blocker"));
  write("0cae0006-0000-4000-8000-000000000001", binding("0cae0006-0000-4000-8000-000000000001", CMD_BLOCKER, "test__Act", 10));
  write("0cae0006-0000-4000-8000-000000000002", binding("0cae0006-0000-4000-8000-000000000002", CMD_BLOCKER, "test__Dt", 10));
  // Hidden twin: both bindings match, the precondition hides it.
  write(CMD_HIDDEN, command(CMD_HIDDEN, "Hidden twice", "hidden-twice", PRE_NEVER));
  write("0cae0006-0000-4000-8000-000000000003", binding("0cae0006-0000-4000-8000-000000000003", CMD_HIDDEN, "test__Act", 30));
  write("0cae0006-0000-4000-8000-000000000004", binding("0cae0006-0000-4000-8000-000000000004", CMD_HIDDEN, "test__Dt", 31));
  // Bound to one class only.
  write(CMD_SINGLE, command(CMD_SINGLE, "Act only", "act-only"));
  write("0cae0006-0000-4000-8000-000000000005", binding("0cae0006-0000-4000-8000-000000000005", CMD_SINGLE, "test__Act", 20));

  write(
    TARGET_BOTH,
    fm([
      `exo__Asset_uid: ${TARGET_BOTH}`,
      `exo__Asset_label: "Both classes"`,
      `exo__Instance_class:`,
      `  - "[[${CLASS_ACT}]]"`,
      `  - "[[${CLASS_DT}]]"`,
    ]),
  );
  write(
    TARGET_DT,
    fm([`exo__Asset_uid: ${TARGET_DT}`, `exo__Asset_label: "Dt only"`, `exo__Instance_class: ["[[${CLASS_DT}]]"]`]),
  );
  return root;
}

describe("resolve-buttons — one command, one entry (ems__Bug 0cae1d41)", () => {
  let root: string;
  beforeEach(() => {
    root = buildVault();
  });
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("C1 a target with both bound classes lists each visible command once, in order", async () => {
    const result = await resolveButtons(root, `${TARGET_BOTH}.md`);
    expect(result.visible.map((e) => e.id)).toEqual([CMD_BLOCKER, CMD_SINGLE]);
  });

  it("C2 a command hidden by its precondition is listed once in hidden", async () => {
    const result = await resolveButtons(root, `${TARGET_BOTH}.md`);
    expect(result.hidden.map((e) => [e.id, e.reason])).toEqual([[CMD_HIDDEN, "precondition-false"]]);
  });

  it("C3 control — a target with one bound class is unchanged", async () => {
    const result = await resolveButtons(root, `${TARGET_DT}.md`);
    expect(result.visible.map((e) => e.id)).toEqual([CMD_BLOCKER]);
    expect(result.hidden.map((e) => e.id)).toEqual([CMD_HIDDEN]);
  });
});

// The accepted cost of «one command — one entry» (spec 2026-11-11, review W1):
// the command is collapsed BEFORE preconditions are evaluated, so the survivor's
// own precondition governs the asset even when a dropped binding would have
// shown the command. No binding in the three vaults carries its own
// precondition today; the resolver logs the divergence. Changing this to
// «visible if any binding passes» must be a conscious decision — this axis
// turns red on it.
const CMD_GATED = "0cae0002-0000-4000-8000-000000000004";
const BIND_GATED_ACT = "0cae0006-0000-4000-8000-0000000000a1"; // smaller id, own precondition NEVER
const BIND_GATED_DT = "0cae0006-0000-4000-8000-0000000000b2"; // no precondition

function buildGatedVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-0cae1d41-gated-"));
  const write = (uid: string, md: string): void =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");

  write(CLASS_ACT, fm([`exo__Asset_uid: ${CLASS_ACT}`, `exo__Asset_label: test__Act`, `exo__Instance_class: ["[[exo__Class]]"]`]));
  write(CLASS_DT, fm([`exo__Asset_uid: ${CLASS_DT}`, `exo__Asset_label: test__Dt`, `exo__Instance_class: ["[[exo__Class]]"]`]));
  write(
    GND,
    fm([
      `exo__Asset_uid: ${GND}`,
      `exo__Asset_label: "noop grounding"`,
      `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
      `exocmd__Grounding_type: "[[${GT_SERVICE_CALL}]]"`,
      `exocmd__Grounding_serviceId: "noop"`,
    ]),
  );
  write(
    PRE_NEVER,
    fm([
      `exo__Asset_uid: ${PRE_NEVER}`,
      `exo__Asset_label: "Never true (fixture)"`,
      `exo__Instance_class: ["[[exocmd__Precondition]]"]`,
      `exocmd__Precondition_sparqlAsk: 'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { $target exo:Asset_label "no such label (fixture)" }'`,
    ]),
  );
  write(CMD_GATED, command(CMD_GATED, "Gated", "gated"));
  write(
    BIND_GATED_ACT,
    binding(BIND_GATED_ACT, CMD_GATED, "test__Act", 40).replace(
      /\n---\n$/,
      `\nexocmd__CommandBinding_precondition: "[[${PRE_NEVER}|p]]"\n---\n`,
    ),
  );
  write(BIND_GATED_DT, binding(BIND_GATED_DT, CMD_GATED, "test__Dt", 40));
  write(
    TARGET_BOTH,
    fm([
      `exo__Asset_uid: ${TARGET_BOTH}`,
      `exo__Asset_label: "Both classes"`,
      `exo__Instance_class:`,
      `  - "[[${CLASS_ACT}]]"`,
      `  - "[[${CLASS_DT}]]"`,
    ]),
  );
  write(
    TARGET_DT,
    fm([`exo__Asset_uid: ${TARGET_DT}`, `exo__Asset_label: "Dt only"`, `exo__Instance_class: ["[[${CLASS_DT}]]"]`]),
  );
  return root;
}

describe("resolve-buttons — the survivor's precondition governs (ems__Bug 0cae1d41)", () => {
  let root: string;
  beforeEach(() => {
    root = buildGatedVault();
  });
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("C4 a collapsed command follows its survivor's precondition — hidden once, not also visible", async () => {
    expect(fs.readFileSync(path.join(root, `${BIND_GATED_ACT}.md`), "utf-8")).toContain(
      "exocmd__CommandBinding_precondition",
    );
    const both = await resolveButtons(root, `${TARGET_BOTH}.md`);
    expect(both.visible.map((e) => e.id)).toEqual([]);
    expect(both.hidden.map((e) => [e.id, e.reason])).toEqual([[CMD_GATED, "precondition-false"]]);

    // Control: on one class the other binding alone shows the command.
    const dt = await resolveButtons(root, `${TARGET_DT}.md`);
    expect(dt.visible.map((e) => e.id)).toEqual([CMD_GATED]);
  });
});

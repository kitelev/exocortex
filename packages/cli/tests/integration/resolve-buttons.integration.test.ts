/**
 * Issue #3833 — `resolve-buttons <target>` prints the ACTUAL command button-set
 * for an asset: **Layer A** (binding-match via the class hierarchy) **∩ Layer B**
 * (precondition-eval). It is the authoritative inline-button-visibility oracle,
 * strictly more complete than `apply --dry-run` (precondition-only).
 *
 * Production-shape (test-fixture-realism): these tests run the REAL resolution
 * pipeline against a temp vault of markdown assets — no mocks:
 *   resolveButtons → NoteToRDFConverter.convertVault → CommandResolver
 *   .resolveForAssetMulti (Layer A: hierarchy binding-match) →
 *   PreconditionEvaluator.evaluate per command (Layer B). This mirrors the
 *   plugin caller `DynamicCommandButtonGroupBuilder.resolveViaFullPath`.
 *
 * The fixture reproduces the D2 layout-curation MECHANISM (Issue #3833's AC2):
 * a class `test__Widget` and a subclass `test__WidgetPrototype ⊑ test__Widget`.
 * Three commands bind to `test__Widget`:
 *   - Always      — no precondition → visible on both.
 *   - NotOnProto   — precondition = STRENDS "not-a-prototype" (the real leaf's
 *                    suffix form) → visible on the concrete Widget, HIDDEN on
 *                    the prototype (mirrors "Create Task Instance"/planning
 *                    commands curated off ems__TaskPrototype).
 * A fourth command (Unbound) binds to an UNRELATED class → never appears on
 * either target, proving Layer A (binding scope) actually filters.
 *
 * @req:960a7ba7-3470-42ba-afdc-f6766c3c3126  — the requirement UID for the resolve-buttons oracle.
 *
 * Revert-verify (integration-test-revert-verify): removing the Layer-B
 * precondition filter in `resolveButtons` (return every bound command as
 * visible) makes the "prototype HIDES NotOnProto" assertion go RED (the hidden
 * command leaks into `visible`). With the filter it is GREEN. Verified locally:
 *   RED  (filter reverted): prototype `visible` contains "NotOnProto".
 *   GREEN (filter present):  prototype `visible` = ["Always"] only.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { resolveButtons, resolveButtonsCommand } = await import(
  "../../src/commands/resolve-buttons.js"
);
const { ErrorHandler } = await import("../../src/utils/ErrorHandler.js");

// GroundingType catalog UID (packages/core/src/domain/constants/GroundingTypeUIDs.ts)
const GT_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";

// Fixture UIDs (deterministic; local to this test).
const CLASS_WIDGET = "3833aaaa-0000-0000-0000-000000000001";
const CLASS_WIDGET_PROTO = "3833aaaa-0000-0000-0000-000000000002";
const CMD_ALWAYS = "3833bbbb-0000-0000-0000-000000000001";
const CMD_NOTONPROTO = "3833bbbb-0000-0000-0000-000000000002";
const CMD_UNBOUND = "3833bbbb-0000-0000-0000-000000000003";
const BIND_ALWAYS = "3833cccc-0000-0000-0000-000000000001";
const BIND_NOTONPROTO = "3833cccc-0000-0000-0000-000000000002";
const BIND_UNBOUND = "3833cccc-0000-0000-0000-000000000003";
const PRE_NOTPROTO = "3833dddd-0000-0000-0000-000000000001";
const GND_ALWAYS = "3833eeee-0000-0000-0000-000000000001";
const GND_NOTONPROTO = "3833eeee-0000-0000-0000-000000000002";
const GND_UNBOUND = "3833eeee-0000-0000-0000-000000000003";
const TARGET_CONCRETE = "3833ffff-0000-0000-0000-000000000001";
const TARGET_PROTO = "3833ffff-0000-0000-0000-000000000002";

const fm = (lines: string[]): string => ["---", ...lines, "---", ""].join("\n");

// The shipped "not-a-prototype" leaf uses a STRENDS suffix check on the SYMBOLIC
// instance_class IRI (dual-IRI shape — sparql-iri-form-pre-verify). TRUE
// (available) when the class does NOT end in "Prototype".
const NOT_A_PROTOTYPE_ASK = [
  "PREFIX exo: <https://exocortex.my/ontology/exo#>",
  "ASK { FILTER NOT EXISTS {",
  '  $target exo:Instance_class ?c . FILTER(STRENDS(STR(?c), "Prototype"))',
  "} }",
].join(" ");

function grounding(uid: string, label: string): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
    `exocmd__Grounding_type: "[[${GT_SERVICE_CALL}]]"`,
    `exocmd__Grounding_serviceId: "noop"`,
  ]);
}

function command(
  uid: string,
  label: string,
  cliName: string,
  groundingUid: string,
  preconditionUid?: string,
): string {
  const lines = [
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class: ["[[exocmd__Command]]"]`,
    `exocmd__Command_cliName: ${cliName}`,
    `exocmd__Command_category: create`,
    `exocmd__Command_grounding: "[[${groundingUid}|g]]"`,
  ];
  if (preconditionUid) {
    lines.push(`exocmd__Command_precondition: "[[${preconditionUid}|p]]"`);
  }
  return fm(lines);
}

function binding(
  uid: string,
  commandUid: string,
  targetClass: string,
  order: number,
): string {
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-resolvebuttons-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");

  // Classes: test__WidgetPrototype ⊑ test__Widget.
  write(
    CLASS_WIDGET,
    fm([
      `exo__Asset_uid: ${CLASS_WIDGET}`,
      `exo__Asset_label: test__Widget`,
      `exo__Instance_class: ["[[exo__Class]]"]`,
    ]),
  );
  write(
    CLASS_WIDGET_PROTO,
    fm([
      `exo__Asset_uid: ${CLASS_WIDGET_PROTO}`,
      `exo__Asset_label: test__WidgetPrototype`,
      `exo__Instance_class: ["[[exo__Class]]"]`,
      // UUID-canon superClass ref (production shape) — the ancestor walk
      // resolves the parent class file by UID (label→file resolution is broken
      // by the converter's IRI-substitution of exo__Asset_label).
      `exo__Class_superClass: "[[${CLASS_WIDGET}]]"`,
    ]),
  );

  // Groundings (minimal, so loadCommand succeeds).
  write(GND_ALWAYS, grounding(GND_ALWAYS, "Always grounding"));
  write(GND_NOTONPROTO, grounding(GND_NOTONPROTO, "NotOnProto grounding"));
  write(GND_UNBOUND, grounding(GND_UNBOUND, "Unbound grounding"));

  // Not-a-prototype precondition (STRENDS suffix form).
  write(
    PRE_NOTPROTO,
    fm([
      `exo__Asset_uid: ${PRE_NOTPROTO}`,
      `exo__Asset_label: "Target is not a prototype (fixture)"`,
      `exo__Instance_class: ["[[exocmd__Precondition]]"]`,
      // Single-quoted YAML so the inner SPARQL `"Prototype"` double-quotes stay
      // literal (sparql-iri-form-pre-verify): a double-quoted YAML value would
      // terminate early → empty sparqlAsk → precondition fails open (vacuous).
      `exocmd__Precondition_sparqlAsk: '${NOT_A_PROTOTYPE_ASK}'`,
    ]),
  );

  // Commands.
  write(CMD_ALWAYS, command(CMD_ALWAYS, "Always", "always", GND_ALWAYS));
  write(
    CMD_NOTONPROTO,
    command(
      CMD_NOTONPROTO,
      "NotOnProto",
      "not-on-proto",
      GND_NOTONPROTO,
      PRE_NOTPROTO,
    ),
  );
  write(CMD_UNBOUND, command(CMD_UNBOUND, "Unbound", "unbound", GND_UNBOUND));

  // Bindings: Always + NotOnProto → test__Widget; Unbound → unrelated class.
  write(BIND_ALWAYS, binding(BIND_ALWAYS, CMD_ALWAYS, "test__Widget", 10));
  write(
    BIND_NOTONPROTO,
    binding(BIND_NOTONPROTO, CMD_NOTONPROTO, "test__Widget", 20),
  );
  write(BIND_UNBOUND, binding(BIND_UNBOUND, CMD_UNBOUND, "test__Other", 30));

  // Targets — UUID-canon instance_class refs (production shape).
  write(
    TARGET_CONCRETE,
    fm([
      `exo__Asset_uid: ${TARGET_CONCRETE}`,
      `exo__Asset_label: "Concrete widget"`,
      `exo__Instance_class: ["[[${CLASS_WIDGET}]]"]`,
    ]),
  );
  write(
    TARGET_PROTO,
    fm([
      `exo__Asset_uid: ${TARGET_PROTO}`,
      `exo__Asset_label: "Widget template"`,
      `exo__Instance_class: ["[[${CLASS_WIDGET_PROTO}]]"]`,
    ]),
  );

  return root;
}

describe("@req:960a7ba7-3470-42ba-afdc-f6766c3c3126 resolve-buttons — binding-match ∩ precondition-eval oracle", () => {
  let root: string;

  beforeEach(() => {
    root = buildVault();
  });

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("@req:960a7ba7-3470-42ba-afdc-f6766c3c3126 concrete Widget → both bound commands visible; unbound command excluded (Layer A ∩ Layer B)", async () => {
    const result = await resolveButtons(root, `${TARGET_CONCRETE}.md`);
    const labels = result.visible.map((e) => e.label);

    // Layer B: not-a-prototype precondition PASSES on the concrete class.
    expect(labels).toContain("Always");
    expect(labels).toContain("NotOnProto");
    // Layer A: a command bound to an unrelated class never binds here.
    expect(labels).not.toContain("Unbound");
    expect(result.hidden).toHaveLength(0);

    // cliName + category surfaced for snapshot-friendly auditing.
    const always = result.visible.find((e) => e.label === "Always");
    expect(always?.cliName).toBe("always");
    expect(always?.category).toBe("create");
  });

  it("@req:960a7ba7-3470-42ba-afdc-f6766c3c3126 prototype instance → NotOnProto HIDDEN by precondition; Always kept; unbound still excluded (Layer B curation)", async () => {
    const result = await resolveButtons(root, `${TARGET_PROTO}.md`);
    const visible = result.visible.map((e) => e.label);

    // Layer A: prototype inherits test__Widget-bound commands via superClass.
    // Layer B: the not-a-prototype precondition HIDES NotOnProto on the prototype.
    expect(visible).toContain("Always");
    expect(visible).not.toContain("NotOnProto");
    expect(visible).not.toContain("Unbound");

    // The bound-but-hidden command is surfaced with reason (the diagnostic
    // `apply --dry-run` cannot give — it is precondition-only, never binding).
    const hiddenLabels = result.hidden.map((e) => e.label);
    expect(hiddenLabels).toContain("NotOnProto");
    const notOnProto = result.hidden.find((e) => e.label === "NotOnProto");
    expect(notOnProto?.reason).toBe("precondition-false");
  });

  it("@req:960a7ba7-3470-42ba-afdc-f6766c3c3126 output ordering is deterministic (resolver (priority, depth, order)) so a layout is snapshot-testable", async () => {
    const a = await resolveButtons(root, `${TARGET_CONCRETE}.md`);
    const b = await resolveButtons(root, `${TARGET_CONCRETE}.md`);
    expect(a.visible.map((e) => e.id)).toEqual(b.visible.map((e) => e.id));
    // Always (order 10) sorts before NotOnProto (order 20).
    expect(a.visible.map((e) => e.label)).toEqual(["Always", "NotOnProto"]);
  });

  it("@req:960a7ba7-3470-42ba-afdc-f6766c3c3126 throws for an EXISTING target outside the vault (Issue #3788 canonicalisation guard)", async () => {
    // A file that exists OUTSIDE the vault root — so resolveButtons passes the
    // not-found guard and actually reaches the #3788 outside-vault branch
    // (a non-existent `../x.md` would trip the earlier not-found guard instead).
    const sibling = path.join(path.dirname(root), `rb-escape-${path.basename(root)}.md`);
    fs.writeFileSync(sibling, "---\nexo__Asset_uid: x\n---\n", "utf-8");
    try {
      await expect(
        resolveButtons(root, path.relative(root, sibling)),
      ).rejects.toThrow(/outside the vault/);
    } finally {
      fs.rmSync(sibling, { force: true });
    }
  });

  it("@req:960a7ba7-3470-42ba-afdc-f6766c3c3126 CLI command emits --json with visible + (show-hidden) hidden button-set", async () => {
    const logs: string[] = [];
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    try {
      await resolveButtonsCommand().parseAsync([
        "node",
        "resolve-buttons",
        `${TARGET_PROTO}.md`,
        "--vault",
        root,
        "--json",
        "--show-hidden",
      ]);
      const payload = JSON.parse(logs.join("\n"));
      expect(payload.target).toBe(`${TARGET_PROTO}.md`);
      expect(payload.visible.map((e: { label: string }) => e.label)).toEqual([
        "Always",
      ]);
      const hidden = payload.hidden.map((e: { label: string }) => e.label);
      expect(hidden).toContain("NotOnProto");
      expect(
        payload.hidden.find((e: { label: string }) => e.label === "NotOnProto")
          ?.reason,
      ).toBe("precondition-false");
    } finally {
      logSpy.mockRestore();
    }
  });

  // LOW#4 (#3833) revert-verify: on the ERROR path, `--json` must emit a
  // structured JSON error (ErrorHandler json mode), not human text. The bug was
  // an unconditional `ErrorHandler.setFormat("text")` regardless of `--json`.
  //   RED  (setFormat hardcoded "text"): the error goes to `console.error` as
  //        human text, `console.log` stays empty → JSON.parse throws.
  //   GREEN (setFormat honours --json): the structured `{ success:false, error }`
  //        response is printed to `console.log` → parses.
  it("@req:960a7ba7-3470-42ba-afdc-f6766c3c3126 CLI --json error path emits a structured JSON error, not human text (LOW#4)", async () => {
    const logs: string[] = [];
    const errs: string[] = [];
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    const errSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errs.push(args.map(String).join(" "));
      });
    // ErrorHandler.handle calls process.exit — mock it to throw so the action
    // stops after the (already-printed) error output, without killing the test.
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__exit__:${code}`);
      }) as never);
    try {
      await resolveButtonsCommand().parseAsync([
        "node",
        "resolve-buttons",
        "does-not-exist-3833.md",
        "--vault",
        root,
        "--json",
      ]);
    } catch (e) {
      // Expected: the process.exit mock throws to unwind the error path.
      expect(String(e)).toContain("__exit__");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
      // The action mutated the ErrorHandler static to "json" — reset it so this
      // test stays isolated if another `it` is ever appended below.
      ErrorHandler.setFormat("text");
    }

    // The JSON error is written to console.log (ErrorHandler json branch).
    const payload = JSON.parse(logs.join("\n"));
    expect(payload.success).toBe(false);
    expect(typeof payload.error.message).toBe("string");
    expect(payload.error.message).toMatch(/not found/i);
    // And nothing leaked to console.error as human text on the --json path.
    expect(errs.join("\n")).not.toMatch(/❌ Error:/);
  });
});

// Homoiconization audit 2026-07-11 (Andrey interview): the verb was renamed
// `resolve-buttons` → `resolve-inline-buttons` (the name now reflects the
// inline-button scope; the command palette is a separate path). `resolve-buttons`
// is kept as a back-compat alias so existing scripts + the homoiconic-rule oracle
// references (`resolve-buttons <target> --json`) keep resolving.
describe("resolve-inline-buttons rename + back-compat alias", () => {
  it("has primary name resolve-inline-buttons and a resolve-buttons alias", () => {
    const cmd = resolveButtonsCommand();
    expect(cmd.name()).toBe("resolve-inline-buttons");
    expect(cmd.aliases()).toContain("resolve-buttons");
  });
});

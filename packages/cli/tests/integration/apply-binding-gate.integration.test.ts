/**
 * Ticket e96eb614 — CLI `apply` must honour the command's BINDING scope, not
 * only its precondition.
 *
 * Bug: `apply <cliName> <target>` resolved the command by its GLOBAL `cliName`
 * and gated it on the precondition alone. A utility command whose composite
 * precondition is built entirely from NEGATIVE conjuncts ("not a prototype",
 * "not archived", "not terminal") therefore ran against ANY asset — a concept,
 * an ontology, anything — because a non-Effort target satisfies every negative
 * conjunct vacuously. The plugin never had the hole: its button-set comes from
 * the binding layer (`resolve-buttons` Layer A), which `apply` skipped.
 *
 * Fix: before evaluating the precondition, `apply` asks the same binding layer
 * — but ONLY when the command declares a binding at all.
 *
 * ⛔ The conditional is load-bearing, not defensive. Measured on vault-exodev
 * while writing this: 74 commands carry a `cliName`, 65 have a CommandBinding,
 * and 11 have NONE (`set-label`, `cold-archive`, `set-planned-start`, …). An
 * unconditional gate would kill those 11 outright — "no binding declared"
 * means "no declared class scope", not "scope = nothing". Axis A3 locks it.
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

const CLASS_WIDGET = "bbbbbbbb-0000-0000-0000-00000000c001";
const CLASS_GADGET = "bbbbbbbb-0000-0000-0000-00000000c002";
const GND = "bbbbbbbb-0000-0000-0000-000000000001";
const CMD_BOUND = "bbbbbbbb-0000-0000-0000-000000000101";
const CMD_UNBOUND = "bbbbbbbb-0000-0000-0000-000000000102";
const BINDING = "bbbbbbbb-0000-0000-0000-000000000201";
const TARGET_WIDGET = "bbbbbbbb-0000-0000-0000-000000000301";
const TARGET_GADGET = "bbbbbbbb-0000-0000-0000-000000000302";
const TARGET_NOCLASS = "bbbbbbbb-0000-0000-0000-000000000303";
const CMD_ROOT = "bbbbbbbb-0000-0000-0000-000000000103";
const BINDING_ROOT = "bbbbbbbb-0000-0000-0000-000000000202";
const CMD_PROTO = "bbbbbbbb-0000-0000-0000-000000000104";
const BINDING_PROTO = "bbbbbbbb-0000-0000-0000-000000000203";
const PROTOTYPE = "bbbbbbbb-0000-0000-0000-000000000401";
const TARGET_PROTO = "bbbbbbbb-0000-0000-0000-000000000304";

const NOT_BOUND = /is not bound to the target's class/;

function fm(lines: string[]): string {
  return ["---", ...lines, "---", ""].join("\n");
}

function buildVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-bindinggate-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");

  // Two unrelated classes — neither is an ancestor of the other, so a binding
  // to one must NOT match a target of the other.
  for (const [uid, label] of [
    [CLASS_WIDGET, "test__Widget"],
    [CLASS_GADGET, "test__Gadget"],
  ] as const) {
    write(
      uid,
      fm([
        `exo__Asset_uid: ${uid}`,
        `exo__Asset_label: ${label}`,
        `exo__Instance_class: ["[[exo__Class]]"]`,
      ]),
    );
  }

  // Minimal grounding so `loadCommand` succeeds for both commands.
  write(
    GND,
    fm([
      `exo__Asset_uid: ${GND}`,
      `exo__Asset_label: "Binding-gate grounding"`,
      `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
      `exocmd__Grounding_type: "[[4367e2d6-6c92-450a-becb-abce1fb07682]]"`,
      `exocmd__Grounding_propertyName: exo__Asset_label`,
      `exocmd__Grounding_propertyValue: touched`,
    ]),
  );

  const command = (uid: string, label: string, cli: string): string =>
    fm([
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${label}"`,
      `exo__Instance_class: ["[[exocmd__Command]]"]`,
      `exocmd__Command_cliName: ${cli}`,
      `exocmd__Command_grounding: "[[${GND}]]"`,
    ]);

  write(CMD_BOUND, command(CMD_BOUND, "Bound command", "bg-bound"));
  write(CMD_UNBOUND, command(CMD_UNBOUND, "Unbound command", "bg-unbound"));

  // The ONLY binding in the fixture: CMD_BOUND ⇢ test__Widget.
  write(
    BINDING,
    fm([
      `exo__Asset_uid: ${BINDING}`,
      `exo__Asset_label: "binding bg-bound → test__Widget"`,
      `exo__Instance_class: ["[[exocmd__CommandBinding]]"]`,
      `exocmd__CommandBinding_command: "[[${CMD_BOUND}]]"`,
      `exocmd__CommandBinding_targetClass: test__Widget`,
      `exocmd__CommandBinding_position: inline`,
      `exocmd__CommandBinding_order: 10`,
    ]),
  );

  for (const [uid, cls] of [
    [TARGET_WIDGET, CLASS_WIDGET],
    [TARGET_GADGET, CLASS_GADGET],
  ] as const) {
    write(
      uid,
      fm([
        `exo__Asset_uid: ${uid}`,
        `exo__Asset_label: "Target ${uid}"`,
        `exo__Instance_class: ["[[${cls}]]"]`,
      ]),
    );
  }

  // ⛔ CRITICAL-1 ревью PR #4363: команда, привязанная к КОРНЕВОМУ классу, и цель
  //    БЕЗ `exo__Instance_class`. `resolveForAssetMulti` на пустом списке классов
  //    выходит `return []` ДО универсального корня, поэтому без явного пропуска
  //    гейт отверг бы `repair-folder`/`archive` на сломанном ассете.
  write(CMD_ROOT, command(CMD_ROOT, "Root command", "bg-root"));
  write(
    BINDING_ROOT,
    fm([
      `exo__Asset_uid: ${BINDING_ROOT}`,
      `exo__Asset_label: "binding bg-root → exo__Asset"`,
      `exo__Instance_class: ["[[exocmd__CommandBinding]]"]`,
      `exocmd__CommandBinding_command: "[[${CMD_ROOT}]]"`,
      `exocmd__CommandBinding_targetClass: exo__Asset`,
      `exocmd__CommandBinding_position: inline`,
      `exocmd__CommandBinding_order: 10`,
    ]),
  );
  write(
    TARGET_NOCLASS,
    fm([
      `exo__Asset_uid: ${TARGET_NOCLASS}`,
      `exo__Asset_label: "Target without a declared class"`,
    ]),
  );

  // ⛔ CRITICAL-2 того же ревью: биндинг ТОЛЬКО по прототипу. Гейт обязан
  //    передавать `prototypeIRI` третьим аргументом, иначе такие команды
  //    отвергаются безусловно даже на совпадающей цели.
  write(
    PROTOTYPE,
    fm([
      `exo__Asset_uid: ${PROTOTYPE}`,
      `exo__Asset_label: "Prototype asset"`,
      `exo__Instance_class: ["[[${CLASS_GADGET}]]"]`,
    ]),
  );
  write(CMD_PROTO, command(CMD_PROTO, "Prototype command", "bg-proto"));
  write(
    BINDING_PROTO,
    fm([
      `exo__Asset_uid: ${BINDING_PROTO}`,
      `exo__Asset_label: "binding bg-proto → prototype"`,
      `exo__Instance_class: ["[[exocmd__CommandBinding]]"]`,
      `exocmd__CommandBinding_command: "[[${CMD_PROTO}]]"`,
      `exocmd__CommandBinding_targetPrototype: "[[${PROTOTYPE}]]"`,
      `exocmd__CommandBinding_position: inline`,
      `exocmd__CommandBinding_order: 10`,
    ]),
  );
  write(
    TARGET_PROTO,
    fm([
      `exo__Asset_uid: ${TARGET_PROTO}`,
      `exo__Asset_label: "Target with a matching prototype"`,
      `exo__Instance_class: ["[[${CLASS_GADGET}]]"]`,
      `exo__Asset_prototype: "[[${PROTOTYPE}]]"`,
    ]),
  );

  return root;
}

describe("ticket e96eb614 — CLI apply honours the command's binding scope", () => {
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

  async function runApply(cli: string, targetUid: string): Promise<void> {
    const cmd = applyCommand();
    try {
      await cmd.parseAsync([
        "node",
        "apply",
        cli,
        `${targetUid}.md`,
        "--vault",
        root,
        "--dry-run",
        "--yes",
      ]);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  const errors = (): string =>
    consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");

  it("A1 bound command on a target of the bound class is NOT refused by the gate", async () => {
    await runApply("bg-bound", TARGET_WIDGET);
    expect(errors()).not.toMatch(NOT_BOUND);
  });

  it("A2 bound command on a target of ANOTHER class is refused by the gate", async () => {
    await runApply("bg-bound", TARGET_GADGET);
    expect(errors()).toMatch(NOT_BOUND);
  });

  // ⛔ Negative control for the conditional. Without it, "gate added" would be
  // indistinguishable from "gate rejects everything unbound" — and that shape
  // kills the 11 real commands that declare no binding at all.
  it("A3 command WITHOUT any binding is not gated (no declared class scope)", async () => {
    await runApply("bg-unbound", TARGET_GADGET);
    expect(errors()).not.toMatch(NOT_BOUND);
  });

  // ⛔ CRITICAL-1 ревью: root-bound command on a class-less target. Base never
  //    refused it, and `repair-folder`/`archive` are run against exactly such
  //    malformed assets — the gate must not become stricter than base here.
  it("A4 root-bound command on a target WITHOUT a declared class is not refused", async () => {
    await runApply("bg-root", TARGET_NOCLASS);
    expect(errors()).not.toMatch(NOT_BOUND);
  });

  // ⛔ CRITICAL-2 ревью: prototype-only binding. Without passing `prototypeIRI`
  //    to resolveForAssetMulti every such command is refused unconditionally.
  it("A5 prototype-bound command on a matching target is not refused", async () => {
    await runApply("bg-proto", TARGET_PROTO);
    expect(errors()).not.toMatch(NOT_BOUND);
  });
});

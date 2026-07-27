/**
 * RFC 430e84f1 (P2) — `exocortex-cli set-property` must REJECT a NON-guarded
 * `--property <name>` whose property NAME does not exist in the MOUNTED TBox, at
 * parity with `create` (P1, v16.189.0). `set-property` already REFUSES
 * state-machine-guarded properties (status/zone/parent/label/fact-timestamps) —
 * those are real names routed to dedicated `apply` commands; this closes the
 * fail-silent hole on the NON-guarded "everything else" class where a typo
 * (`concept__Concept_relatedTo` for `concept__Concept_related`) used to land a
 * DEAD property.
 *
 * Exercises the REAL `setPropertyCommand()` end-to-end against a temp fixture
 * vault that contains genuine property definitions (a non-empty mounted
 * property-name set), so the reused P1 `PropertyNameValidator` runs for real.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * commenting out the `propertyNameValidator.validate([property])` call in
 * set-property.ts (type-preserving) makes the unknown-prefix + misspelled-name
 * scenarios SUCCEED (exit 0, property written) → those assertions go RED; the
 * no-false-positive + guarded-refusal + skip + degenerate fail-open + no-flag
 * controls stay GREEN in both states (non-vacuity). The guarded-refusal control
 * specifically proves the validation is placed AFTER the guard checks.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { setPropertyCommand } = await import("../../src/commands/set-property.js");
const { PropertyNameValidator } = await import(
  "../../src/services/PropertyNameValidator.js"
);

const REQ = "c616a289-8870-4426-86d3-2b30e7c37f5e";
const VALID_TARGET = "cafe0000-0000-0000-0000-000000000002";
const OBJECT_PROPERTY_UID = "9a1cf31c-9d41-4ef3-9023-584a8d087d16";

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** Write a property-definition file (UID-named, like the real UID-canon TBox). */
function writeProp(vault: string, uid: string, label: string, metaclassRef: string): void {
  const dir = path.join(vault, "assetspaces/kitelev/exoas-exo/exo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${uid}.md`),
    md({
      exo__Asset_uid: uid,
      exo__Instance_class: `"${metaclassRef}"`,
      exo__Asset_label: label,
    }),
  );
}

/** The target asset set-property mutates (a real asset with an exo__Asset_uid). */
const TARGET_UID = "dddddddd-0000-0000-0000-000000000001";
const TARGET_REL = `assetspaces/kitelev/exoas-shared-private/concepts/${TARGET_UID}.md`;

function buildFixtureVault(vault: string): void {
  // Non-empty mounted property-name set (prefixes: concept, exo).
  writeProp(vault, "0000-p-1", "concept__Concept_related", `[[${OBJECT_PROPERTY_UID}|exo__ObjectProperty]]`);
  writeProp(vault, "0000-p-2", "exo__Asset_relates", "[[exo__ObjectProperty]]");
  writeProp(vault, "0000-p-3", "exo__Asset_isDefinedBy", "[[exo__ObjectProperty]]");
  // The target asset to mutate.
  const tdir = path.join(vault, path.dirname(TARGET_REL));
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(
    path.join(vault, TARGET_REL),
    md({
      exo__Asset_uid: TARGET_UID,
      exo__Instance_class: '"[[concept__Concept]]"',
      exo__Asset_label: "Fixture concept",
    }),
  );
}

describe("RFC 430e84f1 P2: `cli set-property` validates NON-guarded property NAMES against the mounted TBox", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-setpropval-"));
    buildFixtureVault(vault);
    stdoutChunks = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      }) as never);
    stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function runSet(property: string, value: string): Promise<void> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [TARGET_REL, "--property", property, "--value", value, "--vault", vault, "--skip-wikilink-validation"],
      { from: "user" },
    );
  }

  function targetContent(): string {
    return fs.readFileSync(path.join(vault, TARGET_REL), "utf-8");
  }

  it(`rejects an UNKNOWN-PREFIX non-guarded property — exit != 0, asset not mutated @req:${REQ}`, async () => {
    const before = targetContent();
    await runSet("nonExisting__Prop", "x");

    expect(exitCodes).not.toContain(0);
    expect(exitCodes).toContain(2); // INVALID_ARGUMENTS
    const stderr = errorSpy.mock.calls.flat().join("\n");
    expect(stderr).toContain("Unknown property");
    expect(stderr).toContain("nonExisting__Prop");
    expect(targetContent()).toBe(before); // unmutated
  });

  it(`rejects a KNOWN-PREFIX MISSPELLED non-guarded name and fuzzy-suggests @req:${REQ}`, async () => {
    await runSet("concept__Concept_relatedTo", "x");

    expect(exitCodes).not.toContain(0);
    const stderr = errorSpy.mock.calls.flat().join("\n");
    expect(stderr).toContain("concept__Concept_related"); // the suggestion
  });

  it(`a REAL non-guarded property passes — no false-positive @req:${REQ}`, async () => {
    await runSet("concept__Concept_related", `[[${VALID_TARGET}]]`);

    expect(exitCodes).toContain(0);
    expect(exitCodes).not.toContain(2);
    expect(targetContent()).toContain("concept__Concept_related");
  });

  it(`a GUARDED property keeps its dedicated-command refusal, NOT "Unknown property" (validation runs AFTER guard) @req:${REQ}`, async () => {
    await runSet("ems__Effort_status", "x");

    expect(exitCodes).not.toContain(0);
    const stderr = errorSpy.mock.calls.flat().join("\n");
    expect(stderr).toContain("dedicated guarded command");
    expect(stderr).not.toContain("Unknown property"); // guard fired first, not name-validation
  });

  // ── Service-level assertions (reused P1 collector over the fixture) ──

  it(`skips bare Obsidian-native YAML keys @req:${REQ}`, async () => {
    const validator = new PropertyNameValidator(vault);
    await expect(validator.validate(["aliases", "tags", "title"])).resolves.toBeUndefined();
  });

  it(`degenerate mount (ZERO property definitions) → fail-open, no reject @req:${REQ}`, async () => {
    const emptyVault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-setpropval-empty-"));
    try {
      const validator = new PropertyNameValidator(emptyVault);
      await expect(validator.validate(["anything__Prop"])).resolves.toBeUndefined();
    } finally {
      fs.rmSync(emptyVault, { recursive: true, force: true });
    }
  });

  it("exposes NO bot-accessible escape-hatch flag (--allow-unknown-property)", () => {
    const flags = setPropertyCommand()
      .options.map((o) => o.long)
      .filter((l): l is string => Boolean(l));
    expect(flags).not.toContain("--allow-unknown-property");
    expect(flags.some((f) => /allow.*(unknown|property)/i.test(f))).toBe(false);
  });
});

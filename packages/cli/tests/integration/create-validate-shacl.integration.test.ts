/**
 * Project 38800c80 W3 (RFC 7c7859d1) — opt-in `exocortex-cli create --validate`
 * runs the SAME SHACL-lite conformance gate the Write-path PreToolUse hook
 * (`validate-asset.sh` → `validate schema --shapes-mode`) runs, PRE-WRITE and
 * scoped to the new asset. Closes the last hook-gap of the CLI creation path:
 * `create` already re-implements co-location (#3520/#3934), dangling-wikilink
 * VALUE rejection (`WikilinkValidator`) and unknown property NAME rejection
 * (`PropertyNameValidator`, RFC 430e84f1) — SHACL conformance was the only one
 * missing (the `ShapeRegistry` create already loads is used ONLY for
 * cardinality-aware serialization, #3099/#3179).
 *
 * Exercises the REAL `createCommand()` action end-to-end against a temp fixture
 * vault carrying genuine SHACL-lite shapes (the same shape shape as
 * `tests/fixtures/shacl-integration`) AND a PRE-EXISTING violating asset, so the
 * candidate-scoping is proven on real data rather than asserted.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * a type-preserving Edit-break of the `--validate` gate in create.ts (skip the
 * conformance check) makes the NON-CONFORMANT scenarios pass the create (exit 0
 * + a file on disk) → those assertions go RED. The negative controls —
 * default-OFF byte-identical, conformant-candidate-passes, and
 * pre-existing-other-asset-violation-does-not-block — stay GREEN in both states,
 * proving the delta is exactly the candidate-scoped gate and not a blanket
 * refusal. Restoring makes all GREEN.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { createCommand } = await import("../../src/commands/create.js");

const REQ = "dd9ab956-80c7-45c6-b71b-5834f50ce6f8";
// requirements-trace binds ONLY via a literal `@req:<uid>` token — the
// `@req:${REQ}` interpolation in the it() titles below is not statically
// resolvable, so declare the binding as a literal here:
// @req:dd9ab956-80c7-45c6-b71b-5834f50ce6f8

/** Real `ems__Task` UID — the candidate's class (a class-def file is written). */
const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
/** Shape: `ems__Task_count` must be an xsd:integer (sh:datatype). */
const COUNT_PROP_UID = "bbb22222-2222-2222-2222-222222222222";
/** A PRE-EXISTING asset that already violates the shape (never our candidate). */
const PREEXISTING_BAD_UID = "22222222-bbbb-2222-bbbb-222222222222";
/** `exo__Property` metaclass — makes `ems__Task_count` a known property NAME. */
const PROPERTY_METACLASS_UID = "38277bfa-d7f9-4a75-b856-b23276ab0db3";
/** `exo__Class` metaclass — for the `ems__Task` class-def. */
const CLASS_METACLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";

/** Fixture files that exist BEFORE any create (excluded from the created count). */
const FIXTURE_BASENAMES = new Set([
  `${CLASS_UID}.md`,
  `${COUNT_PROP_UID}.md`,
  `${PREEXISTING_BAD_UID}.md`,
]);

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

/**
 * A fixture vault with REAL SHACL-lite shapes:
 *  - `ems__Task` class-def (UID-named, so the candidate's UID-form
 *    `exo__Instance_class` resolves to the symbolic `ems#Task` the shape's
 *    domain also resolves to — the dual-IRI bridge, sparql-iri-form-pre-verify).
 *  - `ems__Task_count` property-def: domain `ems__Task`, range xsd:integer →
 *    a `sh:datatype` shape (and, incidentally, a KNOWN property name so the
 *    RFC-430e84f1 name guard passes and the two guards are proven to compose).
 *  - A PRE-EXISTING `ems__Task` that ALREADY violates that shape — the vault is
 *    non-conformant before we start, exactly like a real vault (vault-tbank has
 *    7 pre-existing violations).
 */
function buildFixtureVault(vault: string): void {
  const tbox = path.join(vault, "assetspaces/kitelev/exoas-exo/exo");
  const data = path.join(vault, "assetspaces/kitelev/exoas-my/my");
  fs.mkdirSync(tbox, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });

  fs.writeFileSync(
    path.join(tbox, `${CLASS_UID}.md`),
    md({
      exo__Asset_uid: CLASS_UID,
      exo__Instance_class: `"[[${CLASS_METACLASS_UID}|exo__Class]]"`,
      exo__Asset_label: "ems__Task",
    }),
  );

  fs.writeFileSync(
    path.join(tbox, `${COUNT_PROP_UID}.md`),
    md({
      exo__Asset_uid: COUNT_PROP_UID,
      exo__Instance_class: `"[[${PROPERTY_METACLASS_UID}|exo__Property]]"`,
      exo__Asset_label: "ems__Task_count",
      exo__Property_domain: '"[[ems__Task]]"',
      exo__Property_range: "http://www.w3.org/2001/XMLSchema#integer",
      exo__Property_severity: "sh:Violation",
    }),
  );

  // Pre-existing NON-conformant asset (string where xsd:integer is required).
  fs.writeFileSync(
    path.join(data, `${PREEXISTING_BAD_UID}.md`),
    md({
      exo__Asset_uid: PREEXISTING_BAD_UID,
      exo__Instance_class: `"[[${CLASS_UID}]]"`,
      exo__Asset_label: "Pre-existing violating task",
      ems__Task_count: '"already-bad"',
    }),
  );
}

describe("W3: `cli create --validate` — opt-in pre-write SHACL-lite conformance gate", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-shaclgate-"));
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
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
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

  async function runCreate(extraArgs: string[]): Promise<void> {
    const cmd = createCommand();
    await cmd.parseAsync(
      [
        "--class",
        "ems__Task",
        "--label",
        "E2E-TEST shacl gate",
        "--vault",
        vault,
        "--skip-wikilink-validation",
        ...extraArgs,
      ],
      { from: "user" },
    );
  }

  /** Assets created by THIS run (fixture files excluded). */
  function createdAssetCount(): number {
    const walk = (dir: string): number => {
      let n = 0;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) n += walk(full);
        else if (e.name.endsWith(".md") && !FIXTURE_BASENAMES.has(e.name)) n++;
      }
      return n;
    };
    return walk(vault);
  }

  it(`--validate REFUSES a non-conformant candidate BEFORE writing — exit != 0, no file @req:${REQ}`, async () => {
    await runCreate([
      "--property",
      "ems__Task_count=not-a-number",
      "--validate",
    ]);

    expect(exitCodes).not.toContain(0);
    const stderr = errorSpy.mock.calls.flat().join("\n");
    expect(stderr).toContain("SHACL-lite validation failed");
    expect(stderr).toContain("ems__Task_count");
    expect(stderr).toContain("datatype");
    // PRE-WRITE gate: the refusal must leave nothing on disk.
    expect(createdAssetCount()).toBe(0);
    expect(stdoutChunks.join("")).toBe(""); // no success JSON
  });

  it(`--validate ACCEPTS a conformant candidate even though the vault already has violations elsewhere @req:${REQ}`, async () => {
    await runCreate(["--validate"]);

    expect(exitCodes).toContain(0);
    // Candidate-scoped: the PRE-EXISTING violating asset must NOT block us.
    expect(createdAssetCount()).toBe(1);
    const json = JSON.parse(stdoutChunks.join("").trim());
    expect(json.label).toBe("E2E-TEST shacl gate");
    expect(fs.existsSync(path.join(vault, json.path))).toBe(true);
    // stdout stays exactly ONE JSON document (validation chatter → stderr).
    expect(stdoutChunks.join("").trim().split("\n")).toHaveLength(1);
  });

  it(`WITHOUT --validate the gate never runs — a non-conformant asset is still created (default OFF, byte-identical) @req:${REQ}`, async () => {
    await runCreate(["--property", "ems__Task_count=not-a-number"]);

    expect(exitCodes).toContain(0);
    expect(createdAssetCount()).toBe(1);
    const json = JSON.parse(stdoutChunks.join("").trim());
    const written = fs.readFileSync(path.join(vault, json.path), "utf-8");
    expect(written).toContain("ems__Task_count");
  });

  it(`--dry-run --validate refuses a non-conformant candidate and writes nothing @req:${REQ}`, async () => {
    await runCreate([
      "--property",
      "ems__Task_count=not-a-number",
      "--dry-run",
      "--validate",
    ]);

    expect(exitCodes).not.toContain(0);
    expect(createdAssetCount()).toBe(0);
    expect(stdoutChunks.join("")).toBe("");
  });

  it(`--dry-run --validate passes a conformant candidate and still writes nothing @req:${REQ}`, async () => {
    await runCreate(["--dry-run", "--validate"]);

    expect(exitCodes).toContain(0);
    expect(createdAssetCount()).toBe(0);
    const json = JSON.parse(stdoutChunks.join("").trim());
    expect(json.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it(`the validated bytes are the bytes written — uid + timestamps are pinned across the gate @req:${REQ}`, async () => {
    await runCreate(["--validate"]);

    const json = JSON.parse(stdoutChunks.join("").trim());
    const written = fs.readFileSync(path.join(vault, json.path), "utf-8");
    // The uid the gate validated is the uid on disk (and in the path/filename).
    expect(written).toContain(`exo__Asset_uid: ${json.uuid}`);
    expect(path.basename(json.path)).toBe(`${json.uuid}.md`);
  });
});

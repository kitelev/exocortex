/**
 * req 960d7a3f (ticket da0f73a3 / S7) — Scenarios E + F on the CLI surface.
 *
 * E: `exocortex repair-frontmatter <path> --canonicalize-keys` migrates a
 *    legacy bare `archived:` carrier to the TBox-declared `exo__Asset_archived`
 *    (value preserved, bare key gone, `exo__Asset_updatedAt` bumped), is
 *    idempotent (second run: `changed: false`, bytes identical) and `--dry-run`
 *    prints the line diff without writing. This is the per-file maintenance
 *    primitive of the Phase-B data migration (~1270 carriers, three vaults) —
 *    NOT a user-facing command (no exocmd binding), so Desktop↔Mobile parity
 *    does not apply.
 * F: the legacy lint (`validate schema`) keeps the bare `archived` whitelisted
 *    (`NON_ONTOLOGY_KEYS`) and validates `exo__Asset_archived` against the
 *    declared-property set like any prefixed property — i.e. it is a
 *    "not declared" violation ONLY while the TBox lacks the declaration.
 *
 * Drives the REAL `repairFrontmatterCommand()` action against a temp vault and
 * reads the written bytes back (test-fixture-realism), plus the pure
 * `canonicalizeLegacyKeys` / `classifyKeys` / `validateFile` functions.
 *
 * REVERT-VERIFY (flip results in the PR body):
 *  - E1 make `canonicalizeLegacyKeys` skip the `updateProperty` call → the
 *       "migrates the legacy carrier" axis RED (bare key survives).
 *  - E2 drop the `LEGACY_YAML_KEYS` entry for `archived` (core) → E1 axis RED
 *       AND the core Scenario-C/D axes RED (shared source).
 *  - E3 drop the updatedAt bump → "bumps exo__Asset_updatedAt" RED.
 *  - F1 remove `archived` from `NON_ONTOLOGY_KEYS` → "bare archived stays
 *       whitelisted" RED.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { canonicalizeLegacyKeys, repairFrontmatterCommand, frontmatterLineDiff } =
  await import("../../src/commands/repair-frontmatter.js");
const { classifyKeys, NON_ONTOLOGY_KEYS, validateFile } = await import(
  "../../src/commands/validate-schema.js"
);

const REQ = "@req:960d7a3f-c04c-461e-a7fa-1ba2d2572bee";

describe(`${REQ} canonicalizeLegacyKeys (pure)`, () => {
  it("rewrites bare `archived: true` to `exo__Asset_archived: true`, value preserved, bare key gone", () => {
    const content = [
      "---",
      "exo__Asset_uid: abc",
      "exo__Asset_label: L",
      "archived: true",
      "ems__Effort_status: Done",
      "---",
      "body",
      "",
    ].join("\n");
    const r = canonicalizeLegacyKeys(content);
    expect(r.changed).toBe(true);
    expect(r.canonicalized).toEqual([{ from: "archived", to: "exo__Asset_archived" }]);
    expect(r.content).toMatch(/^exo__Asset_archived: true$/m);
    expect(r.content).not.toMatch(/^archived:/m);
    expect(r.content).toContain("exo__Asset_label: L");
    expect(r.content).toContain("ems__Effort_status: Done");
    expect(r.content).toContain("\nbody\n");
  });

  it("canonical value wins when BOTH spellings are present; the bare key is dropped", () => {
    const content = "---\narchived: true\nexo__Asset_archived: false\n---\n";
    const r = canonicalizeLegacyKeys(content);
    expect(r.changed).toBe(true);
    expect(r.content).toMatch(/^exo__Asset_archived: false$/m);
    expect(r.content).not.toMatch(/^archived:/m);
  });

  it("is a no-op (byte-identical) when no legacy key is present", () => {
    for (const content of [
      "---\nexo__Asset_uid: abc\nexo__Asset_archived: true\n---\nbody\n",
      "---\nexo__Asset_uid: abc\ndraft: true\n---\nbody\n",
      "no frontmatter at all\n",
    ]) {
      const r = canonicalizeLegacyKeys(content);
      expect(r.changed).toBe(false);
      expect(r.canonicalized).toEqual([]);
      expect(r.content).toBe(content);
    }
  });

  it("frontmatterLineDiff lists the moved key as `-`/`+` lines", () => {
    const before = "---\na: 1\narchived: true\n---\n";
    const after = "---\na: 1\nexo__Asset_archived: true\n---\n";
    expect(frontmatterLineDiff(before, after)).toEqual([
      "- archived: true",
      "+ exo__Asset_archived: true",
    ]);
  });
});

describe(`${REQ} repair-frontmatter --canonicalize-keys end-to-end`, () => {
  let vault: string;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  const rel = "assets/legacy.md";

  const LEGACY_MD = [
    "---",
    "exo__Asset_uid: 11111111-1111-4111-8111-111111111111",
    "exo__Asset_updatedAt: 2026-01-01T00:00:00",
    "exo__Asset_label: Legacy carrier",
    "archived: true",
    "---",
    "",
    "Body notes.",
    "",
  ].join("\n");

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-960d7a3f-"));
    fs.mkdirSync(path.join(vault, "assets"), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), LEGACY_MD);
    stdoutChunks = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      }) as never);
    exitSpy = jest.spyOn(process, "exit").mockImplementation((() => {
      return undefined as never;
    }) as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function run(extraArgs: string[]): Promise<Record<string, unknown>> {
    stdoutChunks = [];
    const cmd = repairFrontmatterCommand();
    await cmd.parseAsync([rel, "--vault", vault, ...extraArgs], { from: "user" });
    return JSON.parse(stdoutChunks.join("").trim()) as Record<string, unknown>;
  }

  it("--dry-run reports the key move as a diff WITHOUT writing", async () => {
    const out = await run(["--canonicalize-keys", "--dry-run"]);
    expect(out).toMatchObject({
      changed: true,
      dryRun: true,
      canonicalized: [{ from: "archived", to: "exo__Asset_archived" }],
    });
    expect(out.diff).toEqual(
      expect.arrayContaining(["- archived: true", "+ exo__Asset_archived: true"]),
    );
    expect(fs.readFileSync(path.join(vault, rel), "utf-8")).toBe(LEGACY_MD);
  });

  it("migrates the legacy carrier: canonical key written, bare key gone, value preserved, updatedAt bumped", async () => {
    const out = await run([
      "--canonicalize-keys",
      "--frozen-clock",
      "2026-09-15T12:00:00+05:00",
    ]);
    expect(out).toMatchObject({
      changed: true,
      dryRun: false,
      canonicalized: [{ from: "archived", to: "exo__Asset_archived" }],
    });
    const onDisk = fs.readFileSync(path.join(vault, rel), "utf-8");
    expect(onDisk).toMatch(/^exo__Asset_archived: true$/m);
    expect(onDisk).not.toMatch(/^archived:/m);
    expect(onDisk).toContain("exo__Asset_label: Legacy carrier");
    expect(onDisk).toContain("\nBody notes.\n");
    // updatedAt bumped to the frozen clock (Asia/Almaty default timezone).
    expect(onDisk).toMatch(/^exo__Asset_updatedAt: 2026-09-15T12:00:00$/m);
    expect(out.updatedAt).toBe("2026-09-15T12:00:00");
  });

  it("is idempotent: a second run changes nothing and leaves the bytes identical", async () => {
    await run(["--canonicalize-keys", "--frozen-clock", "2026-09-15T12:00:00+05:00"]);
    const afterFirst = fs.readFileSync(path.join(vault, rel), "utf-8");
    const out = await run(["--canonicalize-keys"]);
    expect(out).toMatchObject({ changed: false, canonicalized: [] });
    expect(fs.readFileSync(path.join(vault, rel), "utf-8")).toBe(afterFirst);
  });

  it("without --canonicalize-keys the legacy key is left alone (dedupe-only behaviour unchanged)", async () => {
    const out = await run([]);
    expect(out).toMatchObject({ changed: false, removed: [] });
    expect(out).not.toHaveProperty("canonicalized");
    expect(fs.readFileSync(path.join(vault, rel), "utf-8")).toBe(LEGACY_MD);
  });
});

describe(`${REQ} validate schema (legacy lint) — Scenario F`, () => {
  it("keeps the bare `archived` whitelisted and sends `exo__Asset_archived` to ontology validation", () => {
    expect(NON_ONTOLOGY_KEYS.has("archived")).toBe(true);
    const { toValidate, unknownPrefix } = classifyKeys([
      "archived",
      "exo__Asset_archived",
      "exo__Asset_label",
    ]);
    expect(toValidate).toEqual(["exo__Asset_archived", "exo__Asset_label"]);
    expect(unknownPrefix).toEqual([]);
  });

  it("reports `exo__Asset_archived` as undeclared ONLY while the TBox lacks the declaration", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-960d7a3f-lint-"));
    try {
      const file = path.join(dir, "a.md");
      fs.writeFileSync(
        file,
        "---\nexo__Asset_uid: abc\nexo__Asset_archived: true\narchived: true\n---\n",
      );
      const uidUri = "https://exocortex.my/ontology/exo#Asset_uid";
      const archivedUri = "https://exocortex.my/ontology/exo#Asset_archived";
      // Declared → no violation for either spelling.
      expect(validateFile(file, "a.md", new Set([uidUri, archivedUri]))).toEqual([]);
      // Not declared → exactly the prefixed key is flagged; the bare key never is.
      const violations = validateFile(file, "a.md", new Set([uidUri]));
      expect(violations.map((v) => v.property)).toEqual(["exo__Asset_archived"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

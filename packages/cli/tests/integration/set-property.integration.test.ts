/**
 * Issues #3795 / #3848 — `exocortex set-property <path>` sets an arbitrary
 * non-guarded frontmatter property on an existing asset (closing the "raw-Edit a
 * property" dogfooding gap), including the `exo__Asset_isDefinedBy` repoint with
 * a co-location re-validation warning — while REFUSING state-machine /
 * precondition-guarded properties so their dedicated `apply` commands are not
 * bypassed.
 *
 * Drives the REAL `setPropertyCommand()` action end-to-end against a temp fixture
 * vault, reads the written file back from disk, and asserts on the real bytes —
 * the production set-property pipeline (FrontmatterService.updateProperty +
 * serializeYamlScalar + resolveCoLocationFolder), not hand-injected frontmatter
 * (test-fixture-realism).
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md) —
 * FOUR independent axes in `set-property.ts`, each reddening exactly its own
 * assertion when Edit-broken and GREEN when restored:
 *   1. property write   — neutralise the first `updateProperty(...)` → the
 *      set-value assertions RED.
 *   2. updatedAt bump    — neutralise the second `updateProperty(UPDATED_AT_KEY)`
 *      → the updatedAt-bump assertion RED.
 *   3. guard             — remove the `GUARDED_PROPERTIES` / `IMMUTABLE_PROPERTIES`
 *      refusal → the guard assertions (status/zone/parent/label/timestamp/uid)
 *      RED (the command would write them / exit 0).
 *   4. co-location check — neutralise the `ISDEFINEDBY_KEY` block → the
 *      co-location-warning assertion RED.
 * The non-guarded happy path + the negative controls isolate non-vacuity.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";

const { setPropertyCommand } = await import("../../src/commands/set-property.js");

const MOVIES_DIR = "assetspaces/kitelev/exoas-my/movies";
const OTHER_DIR = "assetspaces/kitelev/exoas-my/other";
const TASKS_DIR = "assetspaces/kitelev/exoas-my/tasks";

const ANCHOR_MOVIES = "a1a1a1a1-0000-4000-8000-000000000001";
const ANCHOR_OTHER = "a2a2a2a2-0000-4000-8000-000000000002";
const MOVIE_UID = "b1b1b1b1-0000-4000-8000-000000000003";
const TASK_UID = "c1c1c1c1-0000-4000-8000-000000000004";
const PARENT_UID = "d1d1d1d1-0000-4000-8000-000000000005";
const BLOCK_UID = "e1e1e1e1-0000-4000-8000-000000000006";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

/** Frozen-clock instant → 2026-07-12T15:00:00 rendered in Asia/Almaty (UTC+5). */
const FROZEN_CLOCK = "2026-07-12T10:00:00Z";
const EXPECTED_UPDATED_AT = "2026-07-12T15:00:00";

/**
 * Parse the frontmatter of a written file with the REAL YAML parser.
 *
 * ⛤ This is the authoritative post-condition for a write command: the command's
 * own JSON echo reports the value it INTENDED to write, which is precisely what
 * was misleading in ems__Bug 94fe70ac (echo correct, file unparseable).
 * Throws when the frontmatter is not valid YAML.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("no frontmatter block");
  return (yaml.load(match[1]) ?? {}) as Record<string, unknown>;
}

function md(frontmatter: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
  lines.push("---", "body", "");
  return lines.join("\n");
}

describe("Issues #3795 / #3848: `cli set-property` generic guarded mutation primitive", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  const moviePath = `${MOVIES_DIR}/${MOVIE_UID}.md`;
  const taskPath = `${TASKS_DIR}/${TASK_UID}.md`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3795-"));

    const moviesDir = path.join(vault, MOVIES_DIR);
    const otherDir = path.join(vault, OTHER_DIR);
    const tasksDir = path.join(vault, TASKS_DIR);
    fs.mkdirSync(moviesDir, { recursive: true });
    fs.mkdirSync(otherDir, { recursive: true });
    fs.mkdirSync(tasksDir, { recursive: true });

    // Ontology anchors (co-location targets).
    fs.writeFileSync(
      path.join(moviesDir, `${ANCHOR_MOVIES}.md`),
      md({ exo__Asset_uid: ANCHOR_MOVIES, exo__Asset_label: "concept__Movies" }),
    );
    fs.writeFileSync(
      path.join(otherDir, `${ANCHOR_OTHER}.md`),
      md({ exo__Asset_uid: ANCHOR_OTHER, exo__Asset_label: "concept__Other" }),
    );
    // A parent asset so a valid [[uid]] wikilink value resolves.
    fs.writeFileSync(
      path.join(tasksDir, `${PARENT_UID}.md`),
      md({ exo__Asset_uid: PARENT_UID, exo__Asset_label: "Parent task" }),
    );
    // The Movie asset (co-located under movies; concept__Movie_watched: false).
    fs.writeFileSync(
      path.join(moviesDir, `${MOVIE_UID}.md`),
      md({
        exo__Asset_uid: MOVIE_UID,
        exo__Asset_isDefinedBy: `"[[${ANCHOR_MOVIES}]]"`,
        exo__Asset_label: '"Chislo 23"',
        concept__Movie_watched: "false",
        exo__Asset_updatedAt: STALE_UPDATED_AT,
      }),
    );
    // A task asset for the guard cases (has exo__Asset_uid).
    fs.writeFileSync(
      path.join(tasksDir, `${TASK_UID}.md`),
      md({
        exo__Asset_uid: TASK_UID,
        exo__Asset_label: '"A task"',
        ems__Effort_status: `"[[done-uid]]"`,
        exo__Asset_updatedAt: STALE_UPDATED_AT,
      }),
    );

    stdoutChunks = [];
    stderrChunks = [];
    exitCodes = [];
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
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
      .mockImplementation(((chunk: unknown) => {
        stderrChunks.push(String(chunk));
        return true;
      }) as never);
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

  /** Run the real set-property command; returns exit codes + on-disk content. */
  async function run(
    relPath: string,
    extraArgs: string[],
  ): Promise<{
    exit: number[];
    content: string;
    stdout: string;
    stderr: string;
    errorLog: string;
  }> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [relPath, "--vault", vault, "--frozen-clock", FROZEN_CLOCK, ...extraArgs],
      { from: "user" },
    );
    return {
      exit: [...exitCodes],
      content: fs.readFileSync(path.join(vault, relPath), "utf-8"),
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      errorLog: errorSpy.mock.calls.flat().join("\n"),
    };
  }

  // ── #3795 happy path (revert axes: property write + updatedAt bump) ──

  it("sets concept__Movie_watched false → true (boolean stays bare) + bumps updatedAt @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const out = await run(moviePath, [
      "--input",
      '{"property":"concept__Movie_watched","value":true}',
    ]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    // Boolean serialises bare (YAML-native), NOT quoted.
    expect(out.content).toContain("concept__Movie_watched: true");
    expect(out.content).not.toContain('concept__Movie_watched: "true"');
    // updatedAt bumped away from the stale value to the frozen-clock instant.
    expect(out.content).toContain(`exo__Asset_updatedAt: ${EXPECTED_UPDATED_AT}`);
    expect(out.content).not.toContain(STALE_UPDATED_AT);
  });

  it("--property/--value string form quotes a YAML-unsafe value (colon-space) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const out = await run(moviePath, [
      "--property",
      "youtube__Video_channel",
      "--value",
      "Some Channel: with colon",
    ]);

    expect(out.exit).toContain(0);
    // A ': '-bearing value MUST be quoted or it breaks YAML parsing.
    expect(out.content).toContain(
      'youtube__Video_channel: "Some Channel: with colon"',
    );
  });

  // ── #3944: exo__Asset_aliases maps to the canonical bare `aliases:` YAML key ──
  // (revert axis: neutralise canonicalYamlKey → set-property writes a literal
  //  `exo__Asset_aliases:` alongside `aliases:` → the AC assertions RED).

  const ALIASED_UID = "e1e1e1e1-0000-4000-8000-000000000006";
  const aliasedRel = `${OTHER_DIR}/${ALIASED_UID}.md`;

  /** Write an asset that already carries a single-value `aliases:` list. */
  function writeAliasedAsset(): void {
    fs.writeFileSync(
      path.join(vault, aliasedRel),
      [
        "---",
        `exo__Asset_uid: ${ALIASED_UID}`,
        'exo__Asset_label: "Dreyfus model"',
        "aliases:",
        '  - "Модель Дрейфуса"',
        `exo__Asset_updatedAt: ${STALE_UPDATED_AT}`,
        "---",
        "body",
        "",
      ].join("\n"),
    );
  }

  it("set-property exo__Asset_aliases updates the canonical `aliases:` key in place — NO literal exo__Asset_aliases: key (#3944)", async () => {
    writeAliasedAsset();
    const out = await run(aliasedRel, [
      "--input",
      '{"property":"exo__Asset_aliases","value":["Dreyfus Model","Модель Дрейфуса","Dreyfus Hum Model"]}',
    ]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    // Canonical bare `aliases:` key updated in place with all 3 values.
    expect(out.content).toContain("aliases:");
    expect(out.content).toContain("  - Dreyfus Model");
    expect(out.content).toContain("  - Модель Дрейфуса");
    expect(out.content).toContain("  - Dreyfus Hum Model");
    // ⛔ The bug: a literal `exo__Asset_aliases:` key MUST NOT appear.
    expect(out.content).not.toMatch(/^exo__Asset_aliases:/m);
    // updatedAt bumped (write happened via the canonical key).
    expect(out.content).toContain(`exo__Asset_updatedAt: ${EXPECTED_UPDATED_AT}`);
  });

  it("bare `aliases` property updates the canonical `aliases:` key (no regression, AC-2) (#3944)", async () => {
    writeAliasedAsset();
    const out = await run(aliasedRel, [
      "--input",
      '{"property":"aliases","value":["Alpha","Beta"]}',
    ]);

    expect(out.exit).toContain(0);
    expect(out.content).toContain("aliases:");
    expect(out.content).toContain("  - Alpha");
    expect(out.content).toContain("  - Beta");
    // The stale single value is replaced, not appended.
    expect(out.content).not.toContain("Модель Дрейфуса");
    expect(out.content).not.toMatch(/^exo__Asset_aliases:/m);
  });

  // ── Guard: state-machine / precondition-guarded properties (revert axis: guard) ──

  it("REFUSES ems__Effort_status, naming the dedicated command, leaving the file unchanged @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");
    const out = await run(taskPath, [
      "--input",
      '{"property":"ems__Effort_status","value":"[[done-uid]]"}',
    ]);

    expect(out.exit).toContain(1);
    expect(out.exit).not.toContain(0);
    expect(out.errorLog).toMatch(/Refusing to set "ems__Effort_status"/);
    expect(out.errorLog).toMatch(/mark-done|move-to-backlog|start-effort/);
    // File byte-identical — the guard did not write anything.
    expect(out.content).toBe(before);
  });

  it.each([
    ["ems__Task_zone", "[[zone-uid]]", /set-criticality/],
    ["ems__Effort_parent", `[[${PARENT_UID}]]`, /set-parent/],
    ["exo__Asset_label", "New label", /set-label/],
    ["exo__Instance_class", `[[${PARENT_UID}]]`, /convert-to-task/],
    ["ems__Effort_startTimestamp", "2026-07-12T10:00:00", /start-effort/],
    ["ems__Effort_endTimestamp", "2026-07-12T10:00:00", /mark-done/],
    ["ems__Effort_resolutionTimestamp", "2026-07-12T10:00:00", /mark-done/],
    ["ems__Effort_plannedStartTimestamp", "2026-07-12T10:00:00", /set-planned-start/],
    ["ems__Effort_plannedEndTimestamp", "2026-07-12T10:00:00", /set-planned-end/],
    ["ems__Effort_scheduledDate", "2026-07-12", /set-scheduled-date/],
    ["ems__Effort_votes", "3", /vote-on-effort/],
    ["archived", "true", /archive/],
    ["exo__Asset_archived", "true", /archive/],
  ])(
    "REFUSES guarded property %s → dedicated command, file unchanged @req:3800d995-2bae-401f-a23a-dac914505e9d",
    async (prop, value, cmdPattern) => {
      const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");
      const out = await run(taskPath, [
        "--input",
        JSON.stringify({ property: prop, value }),
        "--skip-wikilink-validation",
      ]);

      expect(out.exit).toContain(1);
      expect(out.errorLog).toMatch(new RegExp(`Refusing to set "${prop}"`));
      expect(out.errorLog).toMatch(cmdPattern);
      expect(out.content).toBe(before);
    },
  );

  // ── Guard: immutable identity / self-managed (revert axis: guard) ──

  it.each([
    ["exo__Asset_uid", /identity/],
    ["exo__Asset_updatedAt", /auto-managed/],
  ])(
    "REFUSES immutable property %s, leaving the file unchanged @req:3800d995-2bae-401f-a23a-dac914505e9d",
    async (prop, reasonPattern) => {
      const before = fs.readFileSync(path.join(vault, moviePath), "utf-8");
      const out = await run(moviePath, [
        "--input",
        JSON.stringify({ property: prop, value: "2099-01-01T00:00:00" }),
      ]);

      expect(out.exit).toContain(1);
      expect(out.errorLog).toMatch(new RegExp(`Refusing to set "${prop}"`));
      expect(out.errorLog).toMatch(reasonPattern);
      expect(out.content).toBe(before);
    },
  );

  // ── #3795 review H1 — a `$`-bearing value must round-trip verbatim ──

  it("preserves a $-bearing value verbatim (no capture-group / match splice) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    // A price-like `$1` / `$&` would corrupt the file if updateProperty spliced it
    // as a String.replace pattern (FRONTMATTER_REGEX has a group 1 = the whole
    // frontmatter) — the #3748 data-loss class.
    const out = await run(moviePath, [
      "--property",
      "concept__Movie_price",
      "--value",
      "$1 & $& deal",
    ]);

    expect(out.exit).toContain(0);
    // Exactly one frontmatter block — no duplicated `---` and no injected content.
    expect((out.content.match(/^---$/gm) ?? []).length).toBe(2);
    expect(out.content).toContain("concept__Movie_price: $1 & $& deal");
  });

  // ── ems__Bug 94fe70ac — a BLOCK-SCALAR value must be replaced WHOLE ──
  //
  // The key line alone used to be rewritten while the block body survived as
  // dangling indented lines, making the frontmatter unparseable — so the asset
  // dropped out of the graph ENTIRELY (every edge, not just this property)
  // while the command still reported success.

  it("replaces a BLOCK-SCALAR value whole — frontmatter stays parseable, no dangling body @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const blockPath = `${MOVIES_DIR}/${BLOCK_UID}.md`;
    fs.writeFileSync(
      path.join(vault, blockPath),
      md({
        exo__Asset_uid: BLOCK_UID,
        // Block scalar sits in the MIDDLE: the key AFTER it must survive intact,
        // proving the span stops at the next column-0 line (no over-consumption).
        concept__Movie_synopsis: "|-\n  Dangling first line\n  Dangling second line",
        exo__Asset_label: '"Blocky"',
        exo__Asset_updatedAt: STALE_UPDATED_AT,
      }),
    );

    const out = await run(blockPath, [
      "--property",
      "concept__Movie_synopsis",
      "--value",
      "one-line replacement",
    ]);

    expect(out.exit).toContain(0);
    // ⛤ Authoritative check is the PARSE of the written file — the command's own
    // JSON echo is exactly what lies in this bug.
    const parsed = parseFrontmatter(out.content);
    expect(parsed.concept__Movie_synopsis).toBe("one-line replacement");
    // The block body is gone (not left dangling under the new value)…
    expect(out.content).not.toContain("Dangling first line");
    expect(out.content).not.toContain("Dangling second line");
    // …and the key that FOLLOWED the block scalar was not swallowed with it.
    expect(parsed.exo__Asset_label).toBe("Blocky");
    // Asserted on the raw line: an unquoted timestamp parses to a Date, not a
    // string ([[test-fixture-realism]] §Addendum 2026-08-03).
    expect(out.content).toContain(`exo__Asset_updatedAt: ${EXPECTED_UPDATED_AT}`);
  });

  it("replaces a FOLDED block scalar (>) whose body is indented deeper than 2 spaces @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const blockPath = `${MOVIES_DIR}/${BLOCK_UID}.md`;
    fs.writeFileSync(
      path.join(vault, blockPath),
      md({
        exo__Asset_uid: BLOCK_UID,
        exocmd__Precondition_sparqlAsk:
          ">\n    PREFIX exo: <https://exocortex.my/ontology/exo#>\n    ASK {\n      $target exo:Instance_class exo:Class .\n    }",
        exo__Asset_label: '"Folded"',
      }),
    );

    const out = await run(blockPath, [
      "--property",
      "exocmd__Precondition_sparqlAsk",
      "--value",
      "ASK { ?s ?p ?o }",
    ]);

    expect(out.exit).toContain(0);
    const parsed = parseFrontmatter(out.content);
    expect(parsed.exocmd__Precondition_sparqlAsk).toBe("ASK { ?s ?p ?o }");
    expect(out.content).not.toContain("PREFIX exo:");
    expect(parsed.exo__Asset_label).toBe("Folded");
  });

  // ── #3795 review M1 — a non-scalar / non-scalar-array value is rejected ──

  it("rejects a nested-object value fail-loud (no [object Object] corruption) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const before = fs.readFileSync(path.join(vault, moviePath), "utf-8");
    const out = await run(moviePath, [
      "--input",
      '{"property":"concept__Movie_meta","value":{"a":1}}',
    ]);

    expect(out.exit).not.toContain(0);
    expect(out.errorLog).toMatch(/must be a scalar/i);
    expect(out.content).toBe(before);
  });

  // ── #3795 review M2 — a prototype key (toString) is NOT falsely guarded ──

  it("does NOT falsely guard an inherited Object.prototype key (toString) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    // `"toString" in GUARDED_PROPERTIES` would be true (inherited) with a bare
    // `in` check; the own-key lookup must treat it as an ordinary property.
    const out = await run(moviePath, [
      "--property",
      "custom__toString",
      "--value",
      "ok",
    ]);

    expect(out.exit).toContain(0);
    expect(out.errorLog).not.toMatch(/Refusing to set/);
    expect(out.content).toContain("custom__toString: ok");
  });

  // ── #3848 isDefinedBy repoint + co-location re-validation (revert axis: co-location) ──

  it("repoints exo__Asset_isDefinedBy AND warns when the file is not co-located @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const out = await run(moviePath, [
      "--input",
      JSON.stringify({
        property: "exo__Asset_isDefinedBy",
        value: `[[${ANCHOR_OTHER}]]`,
      }),
    ]);

    expect(out.exit).toContain(0);
    // Wikilink value is quoted (not a broken bare `[[uid]]` flow sequence).
    expect(out.content).toContain(
      `exo__Asset_isDefinedBy: "[[${ANCHOR_OTHER}]]"`,
    );
    // The Movie file lives under movies/ but the new anchor is under other/ →
    // a co-location warning naming `apply repair-folder` is emitted.
    expect(out.stderr).toMatch(/co-location/);
    expect(out.stderr).toMatch(/apply repair-folder/);
    expect(out.stdout).toMatch(/"coLocationWarning":true/);
  });

  it("repoints exo__Asset_isDefinedBy to a CO-LOCATED anchor WITHOUT a warning (negative control) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    // Re-anchor the Movie to the movies/ anchor it already lives beside.
    const out = await run(moviePath, [
      "--input",
      JSON.stringify({
        property: "exo__Asset_isDefinedBy",
        value: `[[${ANCHOR_MOVIES}]]`,
      }),
    ]);

    expect(out.exit).toContain(0);
    expect(out.content).toContain(
      `exo__Asset_isDefinedBy: "[[${ANCHOR_MOVIES}]]"`,
    );
    // Already co-located → NO co-location warning.
    expect(out.stderr).not.toMatch(/co-location/);
    expect(out.stdout).not.toMatch(/coLocationWarning/);
  });

  // ── Wikilink existence validation (negative control) ──

  it("rejects an unresolvable [[uid]] wikilink value @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const before = fs.readFileSync(path.join(vault, moviePath), "utf-8");
    const out = await run(moviePath, [
      "--input",
      '{"property":"exo__Asset_relates","value":"[[99999999-9999-4999-8999-999999999999]]"}',
    ]);

    expect(out.exit).not.toContain(0);
    expect(out.errorLog).toMatch(/not found/i);
    expect(out.content).toBe(before);
  });

  it("accepts a resolvable [[uid]] wikilink value (non-guarded property) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const out = await run(moviePath, [
      "--input",
      JSON.stringify({
        property: "exo__Asset_relates",
        value: `[[${PARENT_UID}]]`,
      }),
    ]);

    expect(out.exit).toContain(0);
    expect(out.content).toContain(`exo__Asset_relates: "[[${PARENT_UID}]]"`);
  });

  // ── --dry-run (no write) ──

  it("--dry-run previews the frontmatter without writing @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    const before = fs.readFileSync(path.join(vault, moviePath), "utf-8");
    const out = await run(moviePath, [
      "--input",
      '{"property":"concept__Movie_watched","value":true}',
      "--dry-run",
    ]);

    expect(out.exit).toContain(0);
    expect(out.stderr).toMatch(/DRY RUN PREVIEW/);
    expect(out.stderr).toMatch(/concept__Movie_watched: true/);
    // File is byte-identical — nothing written.
    expect(out.content).toBe(before);
  });

  // ── Nonexistent target (#3907 — read-directly, ENOENT→friendly, no TOCTOU) ──

  it("a missing target file surfaces a friendly 'Target file not found' via the ENOENT read path (no existsSync check-then-write race) @req:3800d995-2bae-401f-a23a-dac914505e9d", async () => {
    // A target that does not exist on disk. The `run` helper reads the file
    // back afterwards (which would itself throw for a missing file), so drive
    // the command directly and inspect the error log / exit codes.
    const missingRel = `${MOVIES_DIR}/00000000-0000-4000-8000-000000000000.md`;
    expect(fs.existsSync(path.join(vault, missingRel))).toBe(false);

    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [
        missingRel,
        "--vault",
        vault,
        "--frozen-clock",
        FROZEN_CLOCK,
        "--input",
        '{"property":"concept__Movie_watched","value":true}',
      ],
      { from: "user" },
    );
    const errorLog = errorSpy.mock.calls.flat().join("\n");

    // Non-zero exit + the FRIENDLY not-found message, mapped from ENOENT — NOT
    // a raw `ENOENT: no such file or directory` leak. Removing the `existsSync`
    // check WITHOUT the ENOENT→friendly mapping reddens both assertions (the raw
    // readFileSync error surfaces): this is the revert-verify axis for the
    // read-directly refactor that closed the js/file-system-race (#3907).
    expect(exitCodes).not.toContain(0);
    expect(errorLog).toMatch(/Target file not found/);
    expect(errorLog).not.toMatch(/no such file or directory/i);
  });
});

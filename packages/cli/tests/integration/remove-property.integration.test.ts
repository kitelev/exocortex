/**
 * Issue #3926 — `exocortex remove-property <path>` DELETES a non-guarded
 * frontmatter property from an existing asset (the delete-side counterpart of
 * `set-property` #3795 / #3848), closing the "raw-Edit / Bash-strip a frontmatter
 * line" dogfooding gap — while REFUSING state-machine / precondition-guarded
 * properties (so their dedicated `apply` commands are not bypassed) and the
 * immutable identity properties.
 *
 * Drives the REAL `removePropertyCommand()` action end-to-end against a temp
 * fixture vault and reads the written file back from disk — the production
 * remove-property pipeline (FrontmatterService.removeProperty + the shared guard
 * denylists + the canonical-YAML-key mapping), not hand-injected frontmatter
 * (test-fixture-realism).
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md) —
 * THREE independent axes in `remove-property.ts` + `propertyMutationShared.ts`,
 * each reddening exactly its own assertion when Edit-broken and GREEN restored:
 *   1. removal        — neutralise `fm.removeProperty(...)` (afterRemove =
 *      original) → the delete + updatedAt-bump assertions RED.
 *   2. guard          — remove the `GUARDED_PROPERTIES` / `IMMUTABLE_PROPERTIES`
 *      refusal → the guard assertions (status/label/uid/updatedAt) RED.
 *   3. canonical key  — neutralise `canonicalYamlKey` → removing
 *      `exo__Asset_aliases` no longer deletes the bare `aliases:` key → the
 *      canonical-key assertion RED.
 * The idempotent-no-op + dry-run + not-a-vault-asset negative controls isolate
 * non-vacuity.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

const { removePropertyCommand } = await import(
  "../../src/commands/remove-property.js"
);

const REQ = "@req:b160178e-309f-4ef8-9402-8dc8ee9494de";

const PROTOS_DIR = "assetspaces/kitelev/exoas-my/prototypes";
const TASKS_DIR = "assetspaces/kitelev/exoas-my/tasks";

const PROTO_UID = "b1b1b1b1-0000-4000-8000-000000000003";
const TASK_UID = "c1c1c1c1-0000-4000-8000-000000000004";
const ALIASED_UID = "e1e1e1e1-0000-4000-8000-000000000006";
const BLOCK_UID = "f1f1f1f1-0000-4000-8000-000000000007";
const BLOCK_SEP_UID = "f1f1f1f1-0000-4000-8000-000000000008";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

/** Frozen-clock instant → 2026-07-12T15:00:00 rendered in Asia/Almaty (UTC+5). */
const FROZEN_CLOCK = "2026-07-12T10:00:00Z";
const EXPECTED_UPDATED_AT = "2026-07-12T15:00:00";

/**
 * Parse the frontmatter of a written file with the REAL YAML parser.
 *
 * ⛤ The authoritative post-condition for a write command: its own JSON echo
 * reports the INTENDED outcome, which is precisely what was misleading in
 * ems__Bug 94fe70ac (echo `removed:true`, file unparseable).
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("no frontmatter block");
  return (parseFrontmatterAsReader(content) ?? {}) as Record<string, unknown>;
}

describe("Issue #3926: `cli remove-property` deletes a non-guarded frontmatter property", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  const protoPath = `${PROTOS_DIR}/${PROTO_UID}.md`;
  const taskPath = `${TASKS_DIR}/${TASK_UID}.md`;
  const aliasedPath = `${PROTOS_DIR}/${ALIASED_UID}.md`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3926-"));
    fs.mkdirSync(path.join(vault, PROTOS_DIR), { recursive: true });
    fs.mkdirSync(path.join(vault, TASKS_DIR), { recursive: true });

    // A recurring prototype carrying a non-guarded scalar property to remove.
    fs.writeFileSync(
      path.join(vault, protoPath),
      [
        "---",
        `exo__Asset_uid: ${PROTO_UID}`,
        'exo__Asset_label: "Weekly BAD course"',
        "ems__EffortPrototype_startTime: 09:00",
        "ems__EffortPrototype_endTime: 10:00",
        `exo__Asset_updatedAt: ${STALE_UPDATED_AT}`,
        "---",
        "body",
        "",
      ].join("\n"),
    );

    // A task asset for the guard cases (has exo__Asset_uid).
    fs.writeFileSync(
      path.join(vault, taskPath),
      [
        "---",
        `exo__Asset_uid: ${TASK_UID}`,
        'exo__Asset_label: "A task"',
        'ems__Effort_status: "[[done-uid]]"',
        `exo__Asset_updatedAt: ${STALE_UPDATED_AT}`,
        "---",
        "body",
        "",
      ].join("\n"),
    );

    // An asset with a bare `aliases:` list (canonical-key case).
    fs.writeFileSync(
      path.join(vault, aliasedPath),
      [
        "---",
        `exo__Asset_uid: ${ALIASED_UID}`,
        'exo__Asset_label: "Dreyfus model"',
        "aliases:",
        '  - "Модель Дрейфуса"',
        '  - "Dreyfus model"',
        `exo__Asset_updatedAt: ${STALE_UPDATED_AT}`,
        "---",
        "body",
        "",
      ].join("\n"),
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

  /** Run the real remove-property command; returns exit codes + on-disk content. */
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
    const cmd = removePropertyCommand();
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

  // ── happy path (revert axis: removal) ──

  it(`deletes a non-guarded scalar property + bumps updatedAt ${REQ}`, async () => {
    const out = await run(protoPath, [
      "--property",
      "ems__EffortPrototype_startTime",
    ]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    // The key is gone; the sibling non-target property survives.
    expect(out.content).not.toContain("ems__EffortPrototype_startTime");
    expect(out.content).toContain("ems__EffortPrototype_endTime: 10:00");
    // updatedAt bumped away from the stale value (a change occurred).
    expect(out.content).toContain(`exo__Asset_updatedAt: ${EXPECTED_UPDATED_AT}`);
    expect(out.content).not.toContain(STALE_UPDATED_AT);
    expect(out.stdout).toContain('"removed":true');
  });

  it(`--input '{"property":"<name>"}' form removes the property (scripting parity) ${REQ}`, async () => {
    const out = await run(protoPath, [
      "--input",
      '{"property":"ems__EffortPrototype_endTime"}',
    ]);

    expect(out.exit).toContain(0);
    expect(out.content).not.toContain("ems__EffortPrototype_endTime");
    expect(out.content).toContain("ems__EffortPrototype_startTime: 09:00");
  });

  // ── idempotent no-op negative control ──

  it(`removing an ABSENT property is an idempotent no-op (file byte-unchanged, no updatedAt bump) ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, protoPath), "utf-8");
    const out = await run(protoPath, [
      "--property",
      "ems__EffortPrototype_recurrence",
    ]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);
    // No change → file byte-identical, stale updatedAt NOT bumped.
    expect(out.content).toBe(before);
    expect(out.content).toContain(`exo__Asset_updatedAt: ${STALE_UPDATED_AT}`);
    expect(out.stdout).toContain('"removed":false');
  });

  // ── #3944 canonical YAML key (revert axis: canonical key) ──

  it(`remove-property exo__Asset_aliases deletes the canonical bare \`aliases:\` key ${REQ}`, async () => {
    const out = await run(aliasedPath, [
      "--property",
      "exo__Asset_aliases",
    ]);

    expect(out.exit).toContain(0);
    // The bare `aliases:` key AND its list items are gone.
    expect(out.content).not.toMatch(/^aliases:/m);
    expect(out.content).not.toContain("Модель Дрейфуса");
    // No literal `exo__Asset_aliases:` key was ever present or created.
    expect(out.content).not.toMatch(/^exo__Asset_aliases:/m);
    // The label (a different key) survives.
    expect(out.content).toContain('exo__Asset_label: "Dreyfus model"');
    expect(out.stdout).toContain('"removed":true');
  });

  // ── Guard: state-machine / precondition-guarded property (revert axis: guard) ──

  it(`REFUSES ems__Effort_status, naming the dedicated command, leaving the file unchanged ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");
    const out = await run(taskPath, [
      "--property",
      "ems__Effort_status",
    ]);

    expect(out.exit).toContain(1);
    expect(out.exit).not.toContain(0);
    expect(out.errorLog).toMatch(/Refusing to remove "ems__Effort_status"/);
    // ⛤ req 148ce5a4: the setters are no longer named. All five commands routed
    // for this property are TRANSITIONS — they assign a value, none removes the
    // key, so offering them sent the user down a path that does not exist.
    expect(out.errorLog).toMatch(/no dedicated command clears it/);
    expect(out.errorLog).not.toMatch(/mark-done|move-to-backlog|start-effort/);
    // File byte-identical — the guard did not delete anything.
    expect(out.content).toBe(before);
  });

  // ⛤ req 148ce5a4 split this table in two. The guarantee is unchanged for both
  // halves — refuse, leave the file byte-identical — but WHAT the refusal can
  // offer is not: only a property with a CLEARING command has a path to name.
  it.each([
    ["archived", /un-archive/],
  ])(
    `REFUSES guarded property %s → dedicated command, file unchanged ${REQ}`,
    async (prop, expectedCommand) => {
      const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");
      const out = await run(taskPath, ["--property", prop]);
      expect(out.exit).toContain(1);
      expect(out.errorLog).toMatch(
        new RegExp(`Refusing to remove "${prop}"`),
      );
      expect(out.errorLog).toMatch(expectedCommand);
      expect(out.content).toBe(before);
    },
  );

  it.each([
    ["exo__Asset_label"],
    ["ems__Effort_parent"],
    ["ems__Task_zone"],
    ["ems__Effort_plannedStartTimestamp"],
  ])(
    `REFUSES guarded property %s with no clearing command, file unchanged ${REQ}`,
    async (prop) => {
      const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");
      const out = await run(taskPath, ["--property", prop]);
      expect(out.exit).toContain(1);
      expect(out.errorLog).toMatch(
        new RegExp(`Refusing to remove "${prop}"`),
      );
      expect(out.errorLog).toMatch(/no dedicated command clears it/);
      expect(out.content).toBe(before);
    },
  );

  // ── Guard: immutable identity / self-managed (revert axis: guard) ──

  it.each([
    ["exo__Asset_uid", /asset identity|UID-canon/],
    ["exo__Asset_updatedAt", /auto-managed/],
  ])(
    `REFUSES immutable property %s, leaving the file unchanged ${REQ}`,
    async (prop, reason) => {
      const before = fs.readFileSync(path.join(vault, taskPath), "utf-8");
      const out = await run(taskPath, ["--property", prop]);
      expect(out.exit).toContain(1);
      expect(out.errorLog).toMatch(
        new RegExp(`Refusing to remove "${prop}"`),
      );
      expect(out.errorLog).toMatch(reason);
      expect(out.content).toBe(before);
    },
  );

  // ── dry-run + not-a-vault-asset negative controls ──

  it(`--dry-run previews the removal without writing ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, protoPath), "utf-8");
    const out = await run(protoPath, [
      "--property",
      "ems__EffortPrototype_startTime",
      "--dry-run",
    ]);

    expect(out.exit).toContain(0);
    // File on disk UNCHANGED; the preview went to stderr.
    expect(out.content).toBe(before);
    expect(out.stderr).toContain("DRY RUN PREVIEW");
    expect(out.stderr).not.toContain("ems__EffortPrototype_startTime");
  });

  // ── ems__Bug 94fe70ac — a BLOCK-SCALAR value must be removed WHOLE ──
  //
  // Only the key line used to be deleted; the block body survived as dangling
  // indented lines, making the frontmatter unparseable — the asset then dropped
  // out of the graph ENTIRELY while the command reported `removed: true`.

  it(`removes a BLOCK-SCALAR property whole — frontmatter stays parseable, no dangling body ${REQ}`, async () => {
    const blockPath = `${PROTOS_DIR}/${BLOCK_UID}.md`;
    fs.writeFileSync(
      path.join(vault, blockPath),
      [
        "---",
        `exo__Asset_uid: ${BLOCK_UID}`,
        // Block scalar in the MIDDLE: the key AFTER it must survive, proving the
        // span stops at the next column-0 line (no over-consumption).
        "concept__Concept_definition: |-",
        "  Dangling first line",
        "  Dangling second line",
        'exo__Asset_label: "Blocky"',
        `exo__Asset_updatedAt: ${STALE_UPDATED_AT}`,
        "---",
        "body",
        "",
      ].join("\n"),
    );

    const out = await run(blockPath, [
      "--property",
      "concept__Concept_definition",
    ]);

    expect(out.exit).toContain(0);
    // ⛤ Authoritative post-condition is the PARSE, not the `removed:true` echo —
    // the echo is exactly what lied in this bug.
    const parsed = parseFrontmatter(out.content);
    expect(parsed.concept__Concept_definition).toBeUndefined();
    expect(out.content).not.toContain("Dangling first line");
    expect(out.content).not.toContain("Dangling second line");
    // The key that FOLLOWED the block scalar was not swallowed with it.
    expect(parsed.exo__Asset_label).toBe("Blocky");
    // ⛤ The key BEFORE it is intact too. This is the QUIETER half of the bug: an
    // orphaned body after a PLAIN scalar does not break the parse at all — YAML
    // folds the dangling lines into the PRECEDING key's value. Pre-fix, this very
    // shape parsed "successfully" with exo__Asset_uid silently rewritten to
    // "<uid> Dangling first line Dangling second line", so nothing ever complained.
    expect(parsed.exo__Asset_uid).toBe(BLOCK_UID);
    expect(out.content).toContain(`exo__Asset_updatedAt: ${EXPECTED_UPDATED_AT}`);
  });

  it(`removing a BLOCK-SCALAR key leaves the blank separator before the next key ${REQ}`, async () => {
    // ⛤ Locks a guarantee the docstring states ("a blank line that trails the value
    // is left where it is, so removal never eats the separator before the next
    // key"). Without this axis the claim is unguarded: flipping the span's blank-line
    // branch to absorb unconditionally reddens NOTHING in the whole repo, so the
    // comment would be a claim rather than a fact.
    const sepPath = `${PROTOS_DIR}/${BLOCK_SEP_UID}.md`;
    fs.writeFileSync(
      path.join(vault, sepPath),
      [
        "---",
        `exo__Asset_uid: ${BLOCK_SEP_UID}`,
        "concept__Concept_definition: |-",
        "  Body line",
        "", // ← the separator under test
        'exo__Asset_label: "Spaced"',
        `exo__Asset_updatedAt: ${STALE_UPDATED_AT}`,
        "---",
        "body",
        "",
      ].join("\n"),
    );

    const out = await run(sepPath, ["--property", "concept__Concept_definition"]);

    expect(out.exit).toContain(0);
    const parsed = parseFrontmatter(out.content);
    expect(parsed.concept__Concept_definition).toBeUndefined();
    expect(out.content).not.toContain("Body line");
    expect(parsed.exo__Asset_label).toBe("Spaced");
    // The blank line survives: the key after it is still preceded by an empty line.
    expect(out.content).toContain('\n\nexo__Asset_label: "Spaced"');
  });

  it(`refuses a bare markdown file with no exo__Asset_uid ${REQ}`, async () => {
    const bareRel = `${PROTOS_DIR}/bare.md`;
    fs.writeFileSync(path.join(vault, bareRel), "# just a note\n");
    const out = await run(bareRel, ["--property", "ems__Effort_votes"]);
    // ems__Effort_votes IS guarded, but the not-a-vault-asset check runs first.
    expect(out.exit).not.toContain(0);
    expect(out.errorLog).toMatch(/Not a vault asset/);
  });

  it(`a missing target file surfaces a friendly 'Target file not found' ${REQ}`, async () => {
    // The `run` helper reads the file back afterwards (which would itself throw
    // for a missing file), so drive the command directly (mirrors set-property).
    const missingRel = `${PROTOS_DIR}/00000000-0000-4000-8000-000000000000.md`;
    expect(fs.existsSync(path.join(vault, missingRel))).toBe(false);
    const cmd = removePropertyCommand();
    await cmd.parseAsync(
      [
        missingRel,
        "--vault",
        vault,
        "--frozen-clock",
        FROZEN_CLOCK,
        "--property",
        "ems__EffortPrototype_startTime",
      ],
      { from: "user" },
    );
    const errorLog = errorSpy.mock.calls.flat().join("\n");
    // Non-zero exit + the FRIENDLY not-found message mapped from ENOENT — NOT a
    // raw `ENOENT: no such file or directory` leak.
    expect(exitCodes).not.toContain(0);
    expect(errorLog).toMatch(/Target file not found/);
    expect(errorLog).not.toMatch(/no such file or directory/i);
  });
});

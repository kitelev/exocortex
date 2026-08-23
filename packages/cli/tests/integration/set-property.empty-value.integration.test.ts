/**
 * req 501cdf2c — `set-property --value ""` MUST be refused fail-loud instead of
 * writing a junk `prop: ""` key.
 *
 * Drives the REAL `setPropertyCommand()` end-to-end against a temp fixture vault
 * and reads the written bytes back from disk (test-fixture-realism: the command's
 * own JSON echo reports what it INTENDED to write — precisely what was misleading
 * in ems__Bug 94fe70ac).
 *
 * ⛔ The boundary is STRICT (`value === ""`), deliberately NOT `value.trim() === ""`.
 * A whitespace-ONLY value is legitimate and live: a measurement of all three
 * canonical vaults (34 327 files / 331 263 top-level keys, 2026-08-23) found
 * **0** carriers of `key: ""` but **15** of `key: " "` — `exo__PrintedLiteral_literal`
 * (9) and `exo__DisplayNameSpec_separator` (6). `create --property k=<value>` strips
 * surrounding spaces, so `set-property --value ' · '` is the ONLY documented way to
 * write them; a trim() predicate would make those two properties unwritable by any
 * command. Hence the THIRD axis below — the first two pass with a trim() regression,
 * only `" "` catches it.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md) —
 * each axis reddens exactly its own assertions when the guard is Edit-broken:
 *   1. `assertNonEmptyValue` neutralised (`if (value !== "") return;` →
 *      unconditional `return`) → axes 1+2 (refusal) RED, axes 3+4+5 GREEN.
 *   2. predicate widened to `String(value).trim() === ""` → axis 4 (`" "` written)
 *      RED, all others GREEN.
 *   3. the call moved ABOVE the guarded-route check (i.e. into
 *      `resolvePropertyAndValue`, which the req's §Где чинить names) → axis 5
 *      (guarded property keeps its dedicated-command refusal) RED.
 * The negative controls (`false`, `" "`, guarded route) isolate non-vacuity.
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
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

const { setPropertyCommand } = await import(
  "../../src/commands/set-property.js"
);

const REQ = "@req:501cdf2c-5b1a-4cd7-8b4b-c76445ae48f9";

const ASSETS_DIR = "assetspaces/kitelev/exoas-my/assets";
const ANCHOR_UID = "a0a0a0a0-0000-4000-8000-000000000001";
const ASSET_UID = "b0b0b0b0-0000-4000-8000-000000000002";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";
const FROZEN_CLOCK = "2026-08-23T10:00:00Z";

/** Read the written frontmatter back with the REAL YAML reader. */
function parseFrontmatter(content: string): Record<string, unknown> {
  return (parseFrontmatterAsReader(content) ?? {}) as Record<string, unknown>;
}

function md(frontmatter: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
  lines.push("---", "body", "");
  return lines.join("\n");
}

describe(`req 501cdf2c: \`set-property\` refuses an EMPTY value (junk \`prop: ""\` key)`, () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCodes: number[];

  const assetRel = `${ASSETS_DIR}/${ASSET_UID}.md`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-501cdf2c-"));
    const dir = path.join(vault, ASSETS_DIR);
    fs.mkdirSync(dir, { recursive: true });

    // Ontology anchor (co-location target for the asset's isDefinedBy).
    fs.writeFileSync(
      path.join(dir, `${ANCHOR_UID}.md`),
      md({ exo__Asset_uid: ANCHOR_UID, exo__Asset_label: "concept__Assets" }),
    );

    // The asset under test. `concept__Movie_watched: false` is the negative
    // control for "a falsy-but-not-empty value still writes bare".
    fs.writeFileSync(
      path.join(dir, `${ASSET_UID}.md`),
      md({
        exo__Asset_uid: ASSET_UID,
        exo__Asset_isDefinedBy: `"[[${ANCHOR_UID}]]"`,
        exo__Asset_label: '"An asset"',
        concept__Movie_watched: "true",
        youtube__Video_channel: '"Existing channel"',
        exo__Asset_updatedAt: STALE_UPDATED_AT,
      }),
    );

    stdoutChunks = [];
    stderrChunks = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
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
  async function run(extraArgs: string[]): Promise<{
    exit: number[];
    content: string;
    stdout: string;
    stderr: string;
    errorLog: string;
  }> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [assetRel, "--vault", vault, "--frozen-clock", FROZEN_CLOCK, ...extraArgs],
      { from: "user" },
    );
    return {
      exit: [...exitCodes],
      content: fs.readFileSync(path.join(vault, assetRel), "utf-8"),
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      errorLog: errorSpy.mock.calls.flat().join("\n"),
    };
  }

  // ── AXIS 1 — the defect itself: `--value ""` must refuse, not write `prop: ""` ──

  it(`--property/--value with an EMPTY string is REFUSED and writes nothing ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, assetRel), "utf-8");

    const out = await run([
      "--property",
      "youtube__Video_description",
      "--value",
      "",
    ]);

    // Non-zero exit (fail-loud), never a silent success.
    expect(out.exit).not.toContain(0);
    expect(out.exit.some((c) => c !== 0)).toBe(true);

    // The refusal must NAME the dedicated clearing command (req Gherkin).
    const message = `${out.stdout}\n${out.stderr}\n${out.errorLog}`;
    expect(message).toContain("remove-property");
    expect(message).toContain("youtube__Video_description");

    // The file is byte-identical — no junk key, no updatedAt bump.
    expect(out.content).toBe(before);
    expect(out.content).not.toContain('youtube__Video_description: ""');
    expect(out.content).toContain(`exo__Asset_updatedAt: ${STALE_UPDATED_AT}`);
  });

  // ── AXIS 2 — the SECOND door: `--input {"value":""}` on an EXISTING property ──

  it(`--input with an EMPTY value is REFUSED and does not clobber the existing value ${REQ}`, async () => {
    const before = fs.readFileSync(path.join(vault, assetRel), "utf-8");

    const out = await run([
      "--input",
      '{"property":"youtube__Video_channel","value":""}',
    ]);

    expect(out.exit).not.toContain(0);
    expect(out.exit.some((c) => c !== 0)).toBe(true);

    const message = `${out.stdout}\n${out.stderr}\n${out.errorLog}`;
    expect(message).toContain("remove-property");

    // The pre-existing value survives untouched.
    const fm = parseFrontmatter(out.content);
    expect(fm.youtube__Video_channel).toBe("Existing channel");
    expect(out.content).toBe(before);
  });

  // ── AXIS 3 — negative control: falsy-but-not-empty values still WRITE ──

  it(`--value false / 0 are NOT empty and are written bare ${REQ}`, async () => {
    const boolOut = await run([
      "--input",
      '{"property":"concept__Movie_watched","value":false}',
    ]);

    expect(boolOut.exit).toContain(0);
    // Boolean serialises bare (YAML-native), NOT quoted.
    expect(boolOut.content).toContain("concept__Movie_watched: false");
    expect(boolOut.content).not.toContain('concept__Movie_watched: "false"');

    const numOut = await run([
      "--input",
      '{"property":"concept__Movie_rating","value":0}',
    ]);

    expect(numOut.exit).toContain(0);
    expect(numOut.content).toContain("concept__Movie_rating: 0");
    expect(numOut.content).not.toContain('concept__Movie_rating: "0"');
  });

  // ── AXIS 4 — the trim() catcher: a WHITESPACE-ONLY value is legitimate ──
  //
  // 15 live carriers across the three canonical vaults (exo__PrintedLiteral_literal,
  // exo__DisplayNameSpec_separator) and `set-property` is their ONLY writer, since
  // `create --property k=<v>` strips the surrounding spaces. Axes 1-3 all pass with
  // a `trim()`-widened predicate; only this one reddens.

  it(`--value " " (whitespace-only) is NOT empty and IS written, quoted ${REQ}`, async () => {
    const out = await run([
      "--property",
      "exo__DisplayNameSpec_separator",
      "--value",
      " · ",
    ]);

    expect(out.exit).toContain(0);
    expect(out.exit).not.toContain(1);

    // Round-trips through the real YAML reader with the spaces intact.
    const fm = parseFrontmatter(out.content);
    expect(fm.exo__DisplayNameSpec_separator).toBe(" · ");
    // Significant whitespace MUST be quoted or YAML eats it.
    expect(out.content).toContain('exo__DisplayNameSpec_separator: " · "');
  });

  // ── AXIS 5 — guard ORDER: a guarded property keeps its dedicated-command refusal ──
  //
  // Measured on the published CLI 16.234.0 (2026-08-23): `--property
  // ems__Effort_status --value ""` already refuses via the guarded route, and that
  // is the CORRECT answer — the property name is real, only the route is wrong.
  // Validating the value inside `resolvePropertyAndValue` (which the req's §Где
  // чинить names) would run BEFORE the guarded-route check and hijack this into an
  // "empty value" refusal, REGRESSING a behaviour the ticket records as correct.
  // Hence the guard lives with the other VALUE checks, after every NAME guard.

  it(`a GUARDED property with an empty value keeps the dedicated-command refusal ${REQ}`, async () => {
    const out = await run(["--property", "ems__Effort_status", "--value", ""]);

    expect(out.exit).not.toContain(0);

    const message = `${out.stdout}\n${out.stderr}\n${out.errorLog}`;
    // Routed by the NAME guard (dedicated command), NOT by the empty-value guard.
    expect(message).toContain("ems__Effort_status");
    expect(message).not.toContain("EMPTY value");
  });
});

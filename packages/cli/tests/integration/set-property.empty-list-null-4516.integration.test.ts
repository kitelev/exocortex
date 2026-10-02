/**
 * Req `5d2c7ede-b053-4dac-a667-7c4f5e4b22da` (issue #4516) — `cli set-property
 * --input '{"value":[]}'` MUST be refused fail-loud instead of writing a BARE
 * `prop:` key.
 *
 * Drives the REAL `setPropertyCommand()` end-to-end against a temp fixture vault
 * and reads the written bytes back from disk (test-fixture-realism: the
 * command's own JSON echo reports what it INTENDED to write).
 *
 * ⛤ MEASURED on `origin/main` `eb12e620`, 2026-10-03, before any code change:
 * an empty array passed `assertScalarOrScalarArray` VACUOUSLY — `[].every(…)`
 * is `true` for an empty array — and `FrontmatterService.updateProperty` wrote
 * a bare key. On an ABSENT property that is the junk key req `501cdf2c`'s own
 * message describes; on an EXISTING one it DESTROYED the value
 * (`"Existing channel"` → `null` for a YAML reader). Axis E2 is that second,
 * strictly worse half, and it is the reason this is data loss rather than
 * cosmetic litter.
 *
 * ⛔ `value: null` is NOT this req's business on this path, and E6 pins that:
 * `assertScalarOrScalarArray` runs FIRST and refuses it with its own, more
 * specific message. The shared predicate's `null` branch exists for the OTHER
 * writer (`createUpdatePropertyService`, axes W3/W4). E6 fails if this req ever
 * hijacks `null` into the generic "empty value" wording.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md) —
 * the mutants live in TWO specs, both under `packages/cli/tests/integration/`
 * and named here by repo-relative path on purpose (a bare basename is how a pointer to a spec goes dead unnoticed: check-spec-anchors.mjs parses the specs' `from` anchors, never their prose):
 *   - `packages/cli/tests/integration/set-property-empty-list-null-4516.setproperty-wiring.spec.json`
 *     — THIS file's call site (wiring).
 *   - `packages/cli/tests/integration/set-property-empty-list-null-4516.predicate.spec.json`
 *     — the shared predicate; its mutants redden axes in BOTH suites.
 * Expectations were taken by RUNNING the matrix, not predicted.
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
import { expectRefused } from "./helpers/exit-assertions.js";

const { setPropertyCommand } = await import(
  "../../src/commands/set-property.js"
);

const REQ = "@req:5d2c7ede-b053-4dac-a667-7c4f5e4b22da";

const ASSETS_DIR = "assetspaces/kitelev/exoas-my/assets";
const ANCHOR_UID = "a0a0a0a0-0000-4000-8000-000000000001";
const ASSET_UID = "b0b0b0b0-0000-4000-8000-000000000002";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";
const FROZEN_CLOCK = "2026-10-03T10:00:00Z";

function parseFrontmatter(content: string): Record<string, unknown> {
  return (parseFrontmatterAsReader(content) ?? {}) as Record<string, unknown>;
}

function md(frontmatter: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
  lines.push("---", "body", "");
  return lines.join("\n");
}

describe(`req 5d2c7ede: \`set-property\` refuses an EMPTY LIST (bare \`prop:\` key)`, () => {
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
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-5d2c7ede-"));
    const dir = path.join(vault, ASSETS_DIR);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, `${ANCHOR_UID}.md`),
      md({ exo__Asset_uid: ANCHOR_UID, exo__Asset_label: "concept__Assets" }),
    );

    // `youtube__Video_channel` is the EXISTING property axis E2 must not lose.
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

  async function run(extraArgs: string[]): Promise<{
    exit: number[];
    content: string;
    message: string;
  }> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [assetRel, "--vault", vault, "--frozen-clock", FROZEN_CLOCK, ...extraArgs],
      { from: "user" },
    );
    return {
      exit: [...exitCodes],
      content: fs.readFileSync(path.join(vault, assetRel), "utf-8"),
      message: `${stdoutChunks.join("")}\n${stderrChunks.join("")}\n${errorSpy.mock.calls.flat().join("\n")}`,
    };
  }

  it(`E1 ${REQ} --input with an EMPTY LIST is REFUSED and the file is byte-identical`, async () => {
    const before = fs.readFileSync(path.join(vault, assetRel), "utf-8");

    const out = await run([
      "--input",
      '{"property":"youtube__Video_description","value":[]}',
    ]);

    expectRefused(out.exit);
    expect(out.exit.some((c) => c !== 0)).toBe(true);
    // The refusal must NAME the property, the FORM and the clearing command.
    expect(out.message).toContain("youtube__Video_description");
    expect(out.message).toContain("empty list");
    expect(out.message).toContain("remove-property");
    // No bare key, no updatedAt bump — the refusal is TOTAL.
    expect(out.content).toBe(before);
    expect(out.content).not.toMatch(/^youtube__Video_description:/m);
    expect(out.content).toContain(`exo__Asset_updatedAt: ${STALE_UPDATED_AT}`);
  });

  it(`E2 ${REQ} --input with an EMPTY LIST does not DESTROY an existing value`, async () => {
    // ⛔ The strictly worse half, measured pre-fix: the bare key REPLACED
    // `youtube__Video_channel: "Existing channel"`, and a YAML reader then saw
    // `null`. A refusal that threw only AFTER the write would still satisfy
    // E1's "non-zero exit" — this axis is what makes it data-loss-proof.
    const before = fs.readFileSync(path.join(vault, assetRel), "utf-8");

    const out = await run([
      "--input",
      '{"property":"youtube__Video_channel","value":[]}',
    ]);

    expectRefused(out.exit);
    expect(out.content).toBe(before);
    expect(parseFrontmatter(out.content).youtube__Video_channel).toBe(
      "Existing channel",
    );
  });

  it(`E3 ${REQ} control — a POPULATED list is still written as a YAML sequence`, async () => {
    // THE too-broad control: a guard keyed on `Array.isArray(value)` rather
    // than on its LENGTH passes E1+E2 and kills every multi-value write.
    const out = await run([
      "--input",
      '{"property":"youtube__Video_description","value":["alpha","beta"]}',
    ]);

    expect(out.exit.every((c) => c === 0)).toBe(true);
    expect(parseFrontmatter(out.content).youtube__Video_description).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it(`E4 ${REQ} control — an EMPTY STRING is still refused (req 501cdf2c, unchanged)`, async () => {
    const before = fs.readFileSync(path.join(vault, assetRel), "utf-8");

    const out = await run([
      "--property",
      "youtube__Video_description",
      "--value",
      "",
    ]);

    expectRefused(out.exit);
    expect(out.message).toContain("empty string");
    expect(out.content).toBe(before);
  });

  it(`E5 ${REQ} control — a WHITESPACE-ONLY value is still written (the predicate does not trim)`, async () => {
    // 22 live carriers across the three canonical vaults, 2026-10-03.
    const out = await run([
      "--property",
      "exo__DisplayNameSpec_separator",
      "--value",
      " ",
    ]);

    expect(out.exit.every((c) => c === 0)).toBe(true);
    expect(out.content).toMatch(/^exo__DisplayNameSpec_separator: /m);
  });

  it(`E6 ${REQ} control — NULL keeps the EARLIER guard's own, more specific message`, async () => {
    // This req must not hijack `null` on this path into the generic "empty
    // value" wording: `assertScalarOrScalarArray` refuses it first and names
    // the TYPE problem, which is the better diagnosis for a `--input` payload.
    const before = fs.readFileSync(path.join(vault, assetRel), "utf-8");

    const out = await run([
      "--input",
      '{"property":"youtube__Video_description","value":null}',
    ]);

    expectRefused(out.exit);
    expect(out.message).toContain("must be a scalar");
    expect(out.message).not.toContain("remove-property");
    expect(out.content).toBe(before);
  });

  it(`E7 ${REQ} control — a FALSY but legitimate value is still written bare`, async () => {
    const out = await run([
      "--input",
      '{"property":"concept__Movie_watched","value":false}',
    ]);

    expect(out.exit.every((c) => c === 0)).toBe(true);
    expect(parseFrontmatter(out.content).concept__Movie_watched).toBe(false);
  });
});

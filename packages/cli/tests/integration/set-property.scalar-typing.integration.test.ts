/**
 * ems__Bug 34b0a52c — `set-property` decided YAML quoting with a CONSTANT
 * string-semantic flag (`serializeYamlScalar(value, true)`), so a scalar-shaped
 * `--property/--value` string (`2026-08-09`, `3`, `true`) was quoted on EVERY
 * property and parsed back as a STRING. The same property written by `create`
 * (`MetadataHelpers` → `STRING_SCALAR_PROPERTIES.has(key)`) stayed bare, so one
 * property carried two types across the vault depending on which command touched
 * it last. The fix passes the flag PER PROPERTY, converging on the create rule.
 *
 * Drives the REAL `setPropertyCommand()` (and the REAL `createCommand()` for the
 * parity scenario) against a temp fixture vault, reads the written file back from
 * disk, and asserts the PARSED TYPE via js-yaml — the parser Obsidian's
 * metadataCache uses, and the same one `yamlScalar.ts` replicates its resolvers
 * from. Asserting the parsed type rather than the emitted characters is
 * deliberate: `2026-08-09` and `"2026-08-09"` differ by two characters and by
 * everything that matters, which is exactly how this survived until now
 * (test-fixture-realism).
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * restore the constant in `serializeForWrite`
 *   (`STRING_SCALAR_PROPERTIES.has(yamlKey)` → `true`)
 * and the date + integer + parity assertions go RED, while the `aliases`,
 * free-text and `--input` assertions stay GREEN. Those three are the negative
 * controls: they prove the change is scoped to the ambiguous-scalar branch of a
 * non-string-semantic property and did NOT simply switch quoting off (which
 * would regress the #3750 MEDIUM-3 guarantee that a scalar-looking alias
 * survives as a string).
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

const { setPropertyCommand } = await import("../../src/commands/set-property.js");
const { createCommand } = await import("../../src/commands/create.js");

const DIR = "assetspaces/kitelev/exoas-my/episodes";
const ANCHOR_UID = "e1e1e1e1-0000-4000-8000-000000000001";
const EPISODE_UID = "e2e2e2e2-0000-4000-8000-000000000002";
const CLASS_UID = "e3e3e3e3-0000-4000-8000-000000000003";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

const FROZEN_CLOCK = "2026-07-12T10:00:00Z";

/** A date-only value: the shape js-yaml resolves to a Date when emitted bare. */
const DATE_VALUE = "2026-08-09";
/** An integer value: bare → number, quoted → string (breaks numeric ordering). */
const INT_VALUE = "3";

function md(frontmatter: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
  lines.push("---", "body", "");
  return lines.join("\n");
}

/** Parse the written file the way the production reader (metadataCache) does. */
function parseFrontmatter(content: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) throw new Error("no frontmatter in written file");
  return (yaml.load(m[1]) ?? {}) as Record<string, unknown>;
}

describe("ems__Bug 34b0a52c: set-property decides scalar quoting per property", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let exitCodes: number[];

  const episodePath = `${DIR}/${EPISODE_UID}.md`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-34b0a52c-"));
    const dir = path.join(vault, DIR);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, `${ANCHOR_UID}.md`),
      md({ exo__Asset_uid: ANCHOR_UID, exo__Asset_label: "life__Episodes" }),
    );
    fs.writeFileSync(
      path.join(dir, `${EPISODE_UID}.md`),
      md({
        exo__Asset_uid: EPISODE_UID,
        exo__Asset_isDefinedBy: `"[[${ANCHOR_UID}]]"`,
        exo__Asset_label: '"Summer break"',
        exo__Asset_updatedAt: STALE_UPDATED_AT,
      }),
    );

    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as never);
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

  async function setProp(
    relPath: string,
    extraArgs: string[],
  ): Promise<{ exit: number[]; content: string; parsed: Record<string, unknown> }> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [relPath, "--vault", vault, "--frozen-clock", FROZEN_CLOCK, ...extraArgs],
      { from: "user" },
    );
    const content = fs.readFileSync(path.join(vault, relPath), "utf-8");
    return { exit: [...exitCodes], content, parsed: parseFrontmatter(content) };
  }

  // ── the defect: a scalar-shaped --value on a NON-string-semantic property ──

  it("writes a date-shaped --value BARE so it parses as a Date @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", async () => {
    const out = await setProp(episodePath, [
      "--property",
      "life__Episode_end",
      "--value",
      DATE_VALUE,
    ]);

    expect(out.exit).not.toContain(1);
    expect(out.content).toContain(`life__Episode_end: ${DATE_VALUE}`);
    expect(out.content).not.toContain(`life__Episode_end: "${DATE_VALUE}"`);
    // The assertion that matters: the production reader yields a Date, not a string.
    expect(out.parsed.life__Episode_end).toBeInstanceOf(Date);
  });

  it("writes an integer-shaped --value BARE so it parses as a number (ordering compares numerically) @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", async () => {
    const out = await setProp(episodePath, [
      "--property",
      "exo__DisplayNamePart_order",
      "--value",
      INT_VALUE,
    ]);

    expect(out.exit).not.toContain(1);
    expect(out.content).toContain(`exo__DisplayNamePart_order: ${INT_VALUE}`);
    expect(typeof out.parsed.exo__DisplayNamePart_order).toBe("number");
    expect(out.parsed.exo__DisplayNamePart_order).toBe(3);
  });

  // ── negative control #1: the string-semantic property KEEPS its quoting ──

  it("still QUOTES the same shaped value on aliases, so a scalar-looking alias survives as a string (#3750 MEDIUM-3) @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", async () => {
    // `exo__Asset_aliases` canonicalises to the bare `aliases:` key (#3944) — the
    // member of STRING_SCALAR_PROPERTIES — so the lookup must use the CANONICAL
    // key, not the raw --property spelling.
    const out = await setProp(episodePath, [
      "--property",
      "exo__Asset_aliases",
      "--value",
      "2026-01-15",
    ]);

    expect(out.exit).not.toContain(1);
    expect(out.content).toContain('aliases: "2026-01-15"');
    expect(typeof out.parsed.aliases).toBe("string");
    expect(out.parsed.aliases).toBe("2026-01-15");
  });

  // ── negative control #2: a non-scalar-shaped value is untouched ──

  it("leaves a free-text --value exactly as before (only the ambiguous-scalar branch moved) @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", async () => {
    const out = await setProp(episodePath, [
      "--property",
      "life__Episode_note",
      "--value",
      "some free text",
    ]);

    expect(out.exit).not.toContain(1);
    expect(out.content).toContain("life__Episode_note: some free text");
    expect(out.parsed.life__Episode_note).toBe("some free text");
  });

  // ── negative control #3: the --input JSON path is byte-identical ──

  it("leaves the --input JSON-typed path unchanged (a JSON number was already bare) @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", async () => {
    const out = await setProp(episodePath, [
      "--input",
      '{"property":"exo__DisplayNamePart_order","value":3}',
    ]);

    expect(out.exit).not.toContain(1);
    expect(out.content).toContain("exo__DisplayNamePart_order: 3");
    expect(typeof out.parsed.exo__DisplayNamePart_order).toBe("number");
  });

  // ── the --input JSON *string* path DOES change, and that is intended ──
  //
  // A JSON string is a string, so it shares the serializer with `--value` and
  // takes the same per-property branch. This is the third revert axis: unlike
  // the two assertions above (a free-text value is not ambiguous, a JSON number
  // is not a string — neither consults the flag in either state), this one is
  // flag-sensitive and reds when the constant `true` is restored.
  it("applies the same per-property rule to an --input JSON STRING value @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", async () => {
    const out = await setProp(episodePath, [
      "--input",
      '{"property":"exo__DisplayNamePart_order","value":"007"}',
    ]);

    expect(out.exit).not.toContain(1);
    expect(out.content).toContain("exo__DisplayNamePart_order: 007");
    expect(out.content).not.toContain('exo__DisplayNamePart_order: "007"');
    expect(typeof out.parsed.exo__DisplayNamePart_order).toBe("number");
    expect(out.parsed.exo__DisplayNamePart_order).toBe(7);
  });

  // ── the user-facing point: create and set-property agree ──

  it("emits the same YAML form as `create` for the same property and value @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", async () => {
    // `create` writes the property through MetadataHelpers, which already decides
    // the flag per property; `set-property` must land on the identical form.
    const created = createCommand();
    await created.parseAsync(
      [
        "--vault",
        vault,
        "--class",
        CLASS_UID,
        "--label",
        "Parity probe",
        "--property",
        `life__Episode_end=${DATE_VALUE}`,
        "--format",
        "json",
      ],
      { from: "user" },
    );

    const createdFiles = fs
      .readdirSync(path.join(vault, DIR))
      .filter((f) => ![ANCHOR_UID, EPISODE_UID].some((u) => f.startsWith(u)));
    const createdPath = createdFiles.length
      ? path.join(vault, DIR, createdFiles[0])
      : findCreated(vault);
    const createdLine = lineFor(
      fs.readFileSync(createdPath, "utf-8"),
      "life__Episode_end",
    );

    const out = await setProp(episodePath, [
      "--property",
      "life__Episode_end",
      "--value",
      DATE_VALUE,
    ]);
    const setLine = lineFor(out.content, "life__Episode_end");

    expect(setLine).toBe(createdLine);
    expect(setLine).toBe(`life__Episode_end: ${DATE_VALUE}`);
  });
});

/** Locate the asset `create` wrote when it did not land in the episodes dir. */
function findCreated(vault: string): string {
  const stack = [vault];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (
        entry.name.endsWith(".md") &&
        fs.readFileSync(full, "utf-8").includes("life__Episode_end")
      ) {
        return full;
      }
    }
  }
  throw new Error("create did not write an asset carrying life__Episode_end");
}

function lineFor(content: string, key: string): string {
  const line = content
    .split("\n")
    .find((l) => l.startsWith(`${key}:`));
  if (!line) throw new Error(`no ${key} line in written file`);
  return line;
}

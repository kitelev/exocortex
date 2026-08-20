/**
 * ems__Bug 43e41c8f / req 869561bf — the canonical-YAML-key rule (#3944) was
 * DEFINED in `packages/cli/src/commands/propertyMutationShared.ts`, i.e. inside
 * one package's command folder, while the whitelist it consults
 * (`UNPREFIXED_ASSET_FIELDS`) already lived in core. The core-side frontmatter
 * writers therefore could not reach it and wrote raw keys: `GroundingExecutor`
 * emitted a literal, dead `exo__Asset_aliases:` key (and missed the string
 * semantics), and `create` let the prefixed spelling fall through to a generic
 * write. The divergence was UNREACHABILITY, not carelessness — so the fix moves
 * the function to core next to its data rather than patching the call sites.
 *
 * These are the CLI-side axes. The `GroundingExecutor` axis lives with its own
 * harness in `packages/core/tests/unit/services/GroundingExecutor.test.ts`.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * neutralise the SINGLE core function — make `canonicalYamlKey` the identity
 * (`return property;` in `NoteToRDFConverter.ts`) — and the axes go RED in BOTH
 * suites. "Red in all of them" is precisely what proves the source is now one:
 * if only some go red, the rule is still duplicated somewhere.
 *
 * The negative controls (a bare, already-canonical key; a prefixed property
 * whose field is NOT whitelisted) must stay GREEN in every state — they prove
 * canonicalisation did not start rewriting keys indiscriminately.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

const { setPropertyCommand } = await import("../../src/commands/set-property.js");
const { removePropertyCommand } = await import(
  "../../src/commands/remove-property.js"
);
const { createCommand } = await import("../../src/commands/create.js");

const DIR = "assetspaces/kitelev/exoas-my/notes";
const ANCHOR_UID = "a1a1a1a1-0000-4000-8000-000000000001";
const NOTE_UID = "a2a2a2a2-0000-4000-8000-000000000002";
const CLASS_UID = "a3a3a3a3-0000-4000-8000-000000000003";
const STALE_UPDATED_AT = "2020-01-01T00:00:00";

function md(frontmatter: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
  lines.push("---", "body", "");
  return lines.join("\n");
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) throw new Error("no frontmatter in written file");
  return (parseFrontmatterAsReader(content) ?? {}) as Record<string, unknown>;
}

describe("req 869561bf: one canonical-key source in core, used by every writer", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let exitCodes: number[];

  const notePath = `${DIR}/${NOTE_UID}.md`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-43e41c8f-"));
    const dir = path.join(vault, DIR);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, `${ANCHOR_UID}.md`),
      md({ exo__Asset_uid: ANCHOR_UID, exo__Asset_label: "notes__Anchor" }),
    );
    fs.writeFileSync(
      path.join(dir, `${CLASS_UID}.md`),
      md({ exo__Asset_uid: CLASS_UID, exo__Asset_label: "notes__Note" }),
    );
    fs.writeFileSync(
      path.join(dir, `${NOTE_UID}.md`),
      md({
        exo__Asset_uid: NOTE_UID,
        exo__Asset_isDefinedBy: `"[[${ANCHOR_UID}]]"`,
        exo__Asset_label: '"Probe note"',
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

  function read(): { content: string; parsed: Record<string, unknown> } {
    const content = fs.readFileSync(path.join(vault, notePath), "utf-8");
    return { content, parsed: parseFrontmatter(content) };
  }

  async function run(
    cmd: { parseAsync: (a: string[], o: { from: "user" }) => Promise<unknown> },
    args: string[],
  ): Promise<void> {
    await cmd.parseAsync(["--vault", vault, ...args], { from: "user" });
  }

  // ── axis: set-property (already canonicalised — must stay so after the move) ──

  it("set-property maps exo__Asset_aliases onto the canonical aliases key @req:869561bf-ae02-4028-bc6a-b32cfabda1ed", async () => {
    await run(setPropertyCommand(), [
      notePath,
      "--skip-wikilink-validation",
      "--property",
      "exo__Asset_aliases",
      "--value",
      "Probe alias",
    ]);

    const { content, parsed } = read();
    expect(content).not.toContain("exo__Asset_aliases:");
    expect(parsed.aliases).toBe("Probe alias");
  });

  // ── axis: remove-property (same shared helper) ──

  it("remove-property deletes the canonical aliases key given the prefixed name @req:869561bf-ae02-4028-bc6a-b32cfabda1ed", async () => {
    // seed a canonical aliases key, then remove it via the PREFIXED spelling
    await run(setPropertyCommand(), [
      notePath,
      "--skip-wikilink-validation",
      "--property",
      "aliases",
      "--value",
      "To be removed",
    ]);
    expect(read().parsed.aliases).toBe("To be removed");

    await run(removePropertyCommand(), [
      notePath,
      "--property",
      "exo__Asset_aliases",
    ]);

    expect(read().parsed.aliases).toBeUndefined();
  });

  // ── axis: create — refuses instead of silently dropping ──

  /**
   * `create` catches its own errors and exits non-zero rather than rejecting, so
   * the refusal is asserted on the EXIT CODE plus the message the user actually
   * sees — not on a rejected promise (which `process.exit` being mocked would
   * swallow, making the assertion pass for the wrong reason).
   */
  function refusalOutput(): string {
    return [...errorSpy.mock.calls, ...logSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
  }

  it("create REFUSES --property exo__Asset_aliases and names the dedicated flag @req:869561bf-ae02-4028-bc6a-b32cfabda1ed", async () => {
    await run(createCommand(), [
      "--class",
      CLASS_UID,
      "--label",
      "Refusal probe",
      "--property",
      "exo__Asset_aliases=Should not land",
    ]);

    expect(exitCodes).toContain(1);
    expect(refusalOutput()).toMatch(/--aliases/);
    expect(refusalOutput()).not.toMatch(/Should not land/);
  });

  it("create REFUSES the bare aliases spelling too (same canonical key) @req:869561bf-ae02-4028-bc6a-b32cfabda1ed", async () => {
    await run(createCommand(), [
      "--class",
      CLASS_UID,
      "--label",
      "Refusal probe 2",
      "--property",
      "aliases=Should not land",
    ]);

    expect(exitCodes).toContain(1);
    expect(refusalOutput()).toMatch(/--aliases/);
  });

  // ── axis: create's asset-building path (GenericAssetCreationService) ──

  /**
   * The second wired core writer. `create` refuses only the fields it manages
   * ITSELF (`aliases`); the other three `UNPREFIXED_ASSET_FIELDS` are ordinary
   * `--property` input and must land under their canonical key. Without this
   * axis the `GenericAssetCreationService` edit ships unverified — its own 101
   * tests stay green under a neutralised canonicaliser.
   */
  it("create writes exo__Asset_archived under the canonical archived key @req:869561bf-ae02-4028-bc6a-b32cfabda1ed", async () => {
    await run(createCommand(), [
      "--class",
      CLASS_UID,
      "--label",
      "Archived probe",
      "--property",
      "exo__Asset_archived=true",
    ]);

    // `create` places the asset by co-location (isDefinedBy), which this probe
    // does not pin — so locate it by content across the temp vault rather than
    // assuming a folder.
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        return e.isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
      });
    const created = walk(vault).filter((p) =>
      fs.readFileSync(p, "utf-8").includes("Archived probe"),
    );
    expect(created).toHaveLength(1);

    const content = fs.readFileSync(created[0], "utf-8");
    expect(content).not.toContain("exo__Asset_archived:");
    expect(parseFrontmatter(content).archived).toBe(true);
  });

  // ── negative controls: must stay GREEN in every state ──

  it("leaves a prefixed property outside the whitelist untouched @req:869561bf-ae02-4028-bc6a-b32cfabda1ed", async () => {
    await run(setPropertyCommand(), [
      notePath,
      "--skip-wikilink-validation",
      "--property",
      "exo__Asset_isDefinedBy",
      "--value",
      `[[${ANCHOR_UID}]]`,
    ]);

    // canonicalisation is the identity here — the key must survive verbatim
    expect(read().content).toContain("exo__Asset_isDefinedBy:");
  });

  it("leaves an ordinary domain property untouched @req:869561bf-ae02-4028-bc6a-b32cfabda1ed", async () => {
    await run(setPropertyCommand(), [
      notePath,
      "--skip-wikilink-validation",
      "--property",
      "notes__Note_mood",
      "--value",
      "calm",
    ]);

    expect(read().parsed.notes__Note_mood).toBe("calm");
  });
});

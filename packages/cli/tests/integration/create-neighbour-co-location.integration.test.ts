/**
 * Issue #3934 — `cli create` must co-locate a new asset by CLASS-neighbour when
 * `exo__Asset_isDefinedBy` yields no folder (a bang-anchor `[[!kitelev]]` /
 * `[[!aiKnow]]`, empty, or unresolvable). Instead of the `01 Inbox/` fallback,
 * the new asset is placed next to its EXISTING sibling instances of the same
 * class — the folder derived from where those instances already live
 * (data-driven, no hardcoded class→folder map; Andrey's design decision — the
 * product obeys the co-location invariant itself, no `--folder` flag).
 *
 * Exercises the REAL `createCommand()` action end-to-end against a temp fixture
 * vault (no service-level shortcut), parsing the command's JSON stdout
 * (`{ uuid, path, label }`) and stat-ing where the file physically lands.
 *
 * Revert-verify (~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * the "bang-anchor + sibling → neighbour folder" case FAILS pre-fix (the asset
 * lands in `01 Inbox/`) and PASSES post-fix. Reverting the priority-2
 * class-neighbour fallback in `create.ts` reds exactly this axis; the negative
 * controls (resolvable-isDefinedBy priority-1 wins; no-sibling → inbox) stay
 * green in both states, proving non-vacuity.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { createCommand } = await import("../../src/commands/create.js");

// Full-UUID class so `--class <uid>` pass-through fires deterministically and
// the resolver's UID-index branches match without a class-def file.
const CLASS_UID = "b0474610-5fa7-4ec4-a947-f85f26e93455";
const CLASS_LABEL = "inbox__ExoAssistantKnowledge";
// The sibling folder where existing instances of CLASS_UID already live.
const SIBLING_DIR = "assetspaces/kitelev/exoas-exodev/inbox";
// A second folder holding fewer siblings (for the majority-home case).
const MINORITY_DIR = "assetspaces/kitelev/exoas-exodev/misc";
// A resolvable ontology (priority-1) for the negative-control.
const ONTOLOGY_UID = "32d2374c-aaaa-bbbb-cccc-000000000000";
const ONTOLOGY_DIR = "assetspaces/kitelev/exoas-exodev/exodev";

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
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

/** Write a sibling instance of CLASS_UID at `dir/<uid>.md`, referencing the
 *  class by the given wikilink form(s). By default the class ref is QUOTED
 *  (the product's own `create` output form); pass `{ quoted: false }` to write
 *  the UNQUOTED form (common in hand-authored / raw-Write RFC/aiKnow assets). */
function writeSibling(
  vault: string,
  dir: string,
  uid: string,
  classRef: string | string[],
  opts: { quoted?: boolean } = {},
): void {
  const quoted = opts.quoted !== false;
  const q = (r: string): string => (quoted ? `"${r}"` : r);
  const abs = path.join(vault, dir);
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(
    path.join(abs, `${uid}.md`),
    md({
      exo__Asset_uid: uid,
      exo__Asset_isDefinedBy: '"[[!kitelev]]"',
      exo__Instance_class: Array.isArray(classRef)
        ? classRef.map(q)
        : q(classRef),
      exo__Asset_label: `sibling ${uid}`,
    }),
  );
}

describe("Issue #3934: `cli create` co-locates by class-neighbour for bang-anchor assets", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3934-"));
    // Inbox default must exist for the fail-open cases.
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });

    stdoutChunks = [];
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

  async function runCreate(
    classArg: string,
    extraArgs: string[],
  ): Promise<{ uuid: string; path: string; label: string }> {
    const cmd = createCommand();
    const argv = [
      "--class",
      classArg,
      "--label",
      "E2E-TEST neighbour co-location",
      "--vault",
      vault,
      "--skip-wikilink-validation",
      ...extraArgs,
    ];
    await cmd.parseAsync(argv, { from: "user" });

    const stderrLog = errorSpy.mock.calls.flat().join("\n");
    expect(exitCodes).toContain(0);
    expect(exitCodes).not.toContain(1);
    const json = stdoutChunks.join("").trim();
    if (!json) {
      throw new Error(`create emitted no stdout JSON. stderr: ${stderrLog}`);
    }
    return JSON.parse(json);
  }

  it("bang-anchor isDefinedBy + existing sibling instances → neighbour folder, not inbox @req:cec6af2c-420e-4a09-a5d3-6ecaf4c5413e", async () => {
    // Two siblings in SIBLING_DIR: one references the class by BARE-uid form
    // (like real inbox__ExoAssistantKnowledge), one by ALIAS form (like real
    // aiKnow__Memory*) — both must be matched via extractAssetReference.
    writeSibling(vault, SIBLING_DIR, "aaaaaaaa-0000-0000-0000-000000000001", `[[${CLASS_UID}]]`);
    writeSibling(
      vault,
      SIBLING_DIR,
      "aaaaaaaa-0000-0000-0000-000000000002",
      `[[${CLASS_UID}|${CLASS_LABEL}]]`,
    );

    const result = await runCreate(CLASS_UID, [
      "--property",
      "exo__Asset_isDefinedBy=[[!kitelev]]",
    ]);

    expect(result.path).toBe(`${SIBLING_DIR}/${result.uuid}.md`);
    expect(result.path.startsWith("01 Inbox/")).toBe(false);
    expect(fs.existsSync(path.join(vault, result.path))).toBe(true);
    expect(
      fs.existsSync(path.join(vault, "01 Inbox", `${result.uuid}.md`)),
    ).toBe(false);
  });

  it("negative control: resolvable isDefinedBy still wins (priority 1) even when class-neighbours exist elsewhere", async () => {
    // A resolvable ontology anchor…
    const ontologyDir = path.join(vault, ONTOLOGY_DIR);
    fs.mkdirSync(ontologyDir, { recursive: true });
    fs.writeFileSync(
      path.join(ontologyDir, `${ONTOLOGY_UID}.md`),
      md({ exo__Asset_uid: ONTOLOGY_UID, exo__Asset_label: "$exodev" }),
    );
    // …plus class-neighbours in a DIFFERENT folder (must be ignored here).
    writeSibling(vault, SIBLING_DIR, "aaaaaaaa-0000-0000-0000-000000000003", `[[${CLASS_UID}]]`);

    const result = await runCreate(CLASS_UID, [
      "--property",
      `exo__Asset_isDefinedBy=[[${ONTOLOGY_UID}]]`,
    ]);

    expect(result.path).toBe(`${ONTOLOGY_DIR}/${result.uuid}.md`);
    expect(result.path.startsWith(SIBLING_DIR)).toBe(false);
    expect(result.path.startsWith("01 Inbox/")).toBe(false);
  });

  it("fail-open: bang-anchor but NO sibling instances of the class → inbox default", async () => {
    // Vault has an UNRELATED-class instance, but zero instances of CLASS_UID.
    writeSibling(
      vault,
      SIBLING_DIR,
      "aaaaaaaa-0000-0000-0000-000000000004",
      "[[cccccccc-1111-1111-1111-111111111111]]",
    );

    const result = await runCreate(CLASS_UID, [
      "--property",
      "exo__Asset_isDefinedBy=[[!kitelev]]",
    ]);

    expect(result.path).toBe(`01 Inbox/${result.uuid}.md`);
    expect(fs.existsSync(path.join(vault, result.path))).toBe(true);
  });

  it("canonical home = the folder holding the MOST sibling instances", async () => {
    // 2 siblings in SIBLING_DIR, 1 in MINORITY_DIR → SIBLING_DIR wins.
    writeSibling(vault, SIBLING_DIR, "aaaaaaaa-0000-0000-0000-000000000005", `[[${CLASS_UID}]]`);
    writeSibling(vault, SIBLING_DIR, "aaaaaaaa-0000-0000-0000-000000000006", `[[${CLASS_UID}]]`);
    writeSibling(vault, MINORITY_DIR, "aaaaaaaa-0000-0000-0000-000000000007", `[[${CLASS_UID}]]`);

    const result = await runCreate(CLASS_UID, [
      "--property",
      "exo__Asset_isDefinedBy=[[!kitelev]]",
    ]);

    expect(result.path).toBe(`${SIBLING_DIR}/${result.uuid}.md`);
    expect(result.path.startsWith(MINORITY_DIR)).toBe(false);
  });

  it("class-neighbour matches the UNQUOTED `- [[uid]]` list form (hand-authored assets)", async () => {
    // Hand-authored / raw-Write RFC/aiKnow assets frequently write the class
    // ref UNQUOTED, which YAML parses as a nested flow-sequence. The neighbour
    // scan must still match it (the feature's own target population).
    writeSibling(
      vault,
      SIBLING_DIR,
      "aaaaaaaa-0000-0000-0000-000000000009",
      `[[${CLASS_UID}]]`,
      { quoted: false },
    );

    const result = await runCreate(CLASS_UID, [
      "--property",
      "exo__Asset_isDefinedBy=[[!kitelev]]",
    ]);

    expect(result.path).toBe(`${SIBLING_DIR}/${result.uuid}.md`);
    expect(result.path.startsWith("01 Inbox/")).toBe(false);
  });

  it("tie-break: equal sibling counts across folders → lexicographically-smallest folder wins", async () => {
    // 1 sibling each in MINORITY_DIR (…/misc) and SIBLING_DIR (…/inbox) →
    // deterministic lexicographic tie-break picks "…/inbox" (< "…/misc").
    writeSibling(vault, SIBLING_DIR, "aaaaaaaa-0000-0000-0000-00000000000a", `[[${CLASS_UID}]]`);
    writeSibling(vault, MINORITY_DIR, "aaaaaaaa-0000-0000-0000-00000000000b", `[[${CLASS_UID}]]`);

    const result = await runCreate(CLASS_UID, [
      "--property",
      "exo__Asset_isDefinedBy=[[!kitelev]]",
    ]);

    // "assetspaces/kitelev/exoas-exodev/inbox" < "…/misc" lexicographically.
    expect(result.path).toBe(`${SIBLING_DIR}/${result.uuid}.md`);
  });

  it("class-neighbour matches the LABEL-form class ref via the short-name (classLabel branch)", async () => {
    // A class-def so `--class <short-name>` resolves to CLASS_UID, and a
    // sibling that references the class by LABEL form `[[<short-name>]]`.
    const clsDir = path.join(vault, "assetspaces/kitelev/exoas-inbox/inbox");
    fs.mkdirSync(clsDir, { recursive: true });
    fs.writeFileSync(
      path.join(clsDir, `${CLASS_UID}.md`),
      md({
        exo__Asset_uid: CLASS_UID,
        exo__Instance_class: '"[[exo__Class]]"',
        exo__Asset_label: CLASS_LABEL,
      }),
    );
    writeSibling(
      vault,
      SIBLING_DIR,
      "aaaaaaaa-0000-0000-0000-000000000008",
      `[[${CLASS_LABEL}]]`,
    );

    const result = await runCreate(CLASS_LABEL, [
      "--property",
      "exo__Asset_isDefinedBy=[[!kitelev]]",
    ]);

    expect(result.path).toBe(`${SIBLING_DIR}/${result.uuid}.md`);
    expect(result.path.startsWith("01 Inbox/")).toBe(false);
  });
});

/**
 * `GroundingExecutor`'s BODY write channels reach the shared frontmatter
 * predicate — #4473.
 *
 * `replaceBody` / `extractBody` (the `body_template` grounding step, the
 * `create_instance` `cloneTargetBody` clone and the `userInput.body` literal
 * path) carried their OWN `/^---\r?\n[\s\S]*?\r?\n---/` long after #4452
 * widened `matchFrontmatterBlock` and #4469 converted the command write
 * channels onto it. Two defects, both PRE-EXISTING:
 *
 *   1. IDENTITY LOSS. `\r?\n` is indivisible so it needs at least one `\n`,
 *      and `^---` cannot reach past a `U+FEFF` byte — so on a lone-CR-fenced
 *      or BOM-prefixed asset the match was `null` and `replaceBody` returned
 *      the template body VERBATIM: the file became the body and every
 *      pre-existing property (`exo__Asset_uid`, `exo__Instance_class`, …) was
 *      discarded. `stampUpdatedAt` returns early for exactly that shape
 *      (`if (!parse(updated).exists) return updated`), so nothing downstream
 *      flagged it either.
 *   2. THE SEAM. `` `${fmMatch[0]}\n${body}` `` inserted a bare LF between the
 *      closing fence and the body regardless of the file's EOL — a
 *      mixed-terminator file on every CRLF asset it DID match. The rule is req
 *      `2d072437-c19d-49a4-ae89-f20b6185571f` decision 2.
 *
 * ⛤ WHY THE AXES ASSERT INSIDE `matchFrontmatterBlock(written).body` AND NOT
 * `written.toContain("exo__Asset_uid")`. A `toContain` over the whole file is
 * vacuous for the MIRROR defect: when `extractBody` fails to match, the
 * source's frontmatter text is carried INTO the new asset's body, so the uid
 * string is still present in the file — just in the wrong half. The axes name
 * the half.
 *
 * ⛤ EVERY fixture carries at least TWO distinguishable frontmatter keys and TWO
 * body lines ([[integration-test-revert-verify]] §A129): the pre-existing
 * sibling axis "preserves CRLF line endings if source has them" in
 * `packages/services` is GREEN on the unfixed code precisely because its block
 * holds ONE line, so the join that mixes the terminators is never reached.
 *
 * Revert-verify ([[integration-test-revert-verify]]): mutant M1 restores the
 * local `\r?\n` regex in both helpers → A1/A2/A5/A6 RED; mutant M2 restores the
 * bare-LF seam → A3 RED; A4/A7/A8 (the LF control) stay GREEN under both, which
 * is the byte-parity proof.
 */

import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import {
  clearResolvers,
  installDefaultResolvers,
} from "../../../src/services/SubstitutionResolverRegistry";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import { frozenClock } from "../../../src/services/IClock";
import { matchFrontmatterBlock } from "../../../src/utilities/frontmatterBlock";

const CLOCK = frozenClock("2026-06-20T12:00:00");
const STAMP = "exo__Asset_updatedAt: 2026-06-20T12:00:00";
const TARGET_IRI = "https://exocortex.my/assets/area-123";
const TARGET_PATH = "/vault/note.md";

/** In-memory fs honouring read-after-write (mirrors the real contract). */
function makeFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const reader = {
    readFile: jest.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    }),
    fileExists: jest.fn(async (path: string) => files.has(path)),
    getMarkdownFiles: jest.fn(async () => Array.from(files.keys())),
  };
  const writer = {
    createFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
      return path;
    }),
    updateFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    writeFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    deleteFile: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
  return { files, reader, writer };
}

function gnd(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-4473",
    label: "Body write channel",
    ...overrides,
  } as unknown as GroundingDefinition;
}

/**
 * Two distinguishable frontmatter keys + two distinguishable body lines, in a
 * chosen EOL. `uid` is what identity loss destroys; `class` is the second
 * member that makes the fixture a COLLECTION rather than a single element.
 */
function asset(eol: string, bom = "", uid = "u-4473"): string {
  return (
    bom +
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      'exo__Instance_class: "[[deadbeef-0000-4000-a000-000000000001]]"',
      "---",
      "OLD BODY LINE ONE",
      "OLD BODY LINE TWO",
    ].join(eol)
  );
}

const NEW_BODY = ["## NEW PLAN", "- step one", "- step two"].join("\n");

/** The frontmatter HALF of a written file, or `null` when identity was lost. */
function writtenFrontmatter(content: string): string | null {
  return matchFrontmatterBlock(content)?.body ?? null;
}

async function runBodyTemplate(seedContent: string): Promise<string> {
  const { files, reader, writer } = makeFs({ [TARGET_PATH]: seedContent });
  const exec = new GroundingExecutor(
    reader,
    writer,
    new ServiceRegistry(),
    undefined,
    { clock: CLOCK },
  );
  const res = await exec.execute(
    gnd({ type: GroundingType.BODY_TEMPLATE, bodyTemplate: NEW_BODY }),
    TARGET_IRI,
    TARGET_PATH,
  );
  expect(res.success).toBe(true);
  return files.get(TARGET_PATH) as string;
}

// ---------------------------------------------------------------------------
// extractBody is reached through the real `create_instance` cloneTargetBody
// pipeline — the channel the LIVE `create-next-iteration` command uses.
// ---------------------------------------------------------------------------

const CLONE_GROUNDING: GroundingDefinition = {
  id: "gnd-4473-clone",
  label: "Clone target body",
  type: GroundingType.CREATE_INSTANCE,
  targetClass: "ems__WaitingCheckTask",
  targetFolder: "01 Inbox",
  cloneTargetBody: true,
} as unknown as GroundingDefinition;

async function runCloneTargetBody(
  seedContent: string,
): Promise<{ created: string; createdBody: string | null }> {
  const { files, reader, writer } = makeFs({ [TARGET_PATH]: seedContent });
  const exec = new GroundingExecutor(
    reader,
    writer,
    new ServiceRegistry(),
    undefined,
    { clock: CLOCK },
  );
  const res = await exec.execute(CLONE_GROUNDING, TARGET_IRI, TARGET_PATH);
  expect(res.success).toBe(true);
  const createdPath = Array.from(files.keys()).find((p) => p !== TARGET_PATH);
  if (!createdPath) throw new Error("no instance was created");
  const created = files.get(createdPath) as string;
  const block = matchFrontmatterBlock(created);
  return {
    created,
    createdBody: block ? created.slice(block.blockEnd).replace(/^(?:\r\n|\r|\n)/, "") : null,
  };
}

describe("GroundingExecutor — body write channels reach the shared predicate (#4473)", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  describe("replaceBody — the body_template write channel", () => {
    it("A1 a lone-CR-fenced asset keeps its IDENTITY: the frontmatter block survives the body write", async () => {
      const written = await runBodyTemplate(asset("\r", "", "cr-uid-4473"));

      // The defect returned the template body VERBATIM: no block at all.
      const fm = writtenFrontmatter(written);
      expect(fm).not.toBeNull();
      expect(fm).toContain("exo__Asset_uid: cr-uid-4473");
      expect(fm).toContain("exo__Instance_class");
      expect(fm).toContain("deadbeef-0000-4000-a000-000000000001");
      // The body WAS replaced (the step still does its job).
      expect(written).toContain("## NEW PLAN");
      expect(written).not.toContain("OLD BODY LINE ONE");
      // And the write is now stamped, because the content it produces HAS a
      // frontmatter block (`stampUpdatedAt` no longer takes its early return).
      expect(fm).toContain(STAMP);
    });

    it("A2 a BOM-prefixed asset (a RUN of two) keeps its identity and keeps a BOM", async () => {
      const written = await runBodyTemplate(
        asset("\n", "\uFEFF\uFEFF", "bom-uid-4473"),
      );

      const fm = writtenFrontmatter(written);
      expect(fm).not.toBeNull();
      expect(fm).toContain("exo__Asset_uid: bom-uid-4473");
      expect(fm).toContain("exo__Instance_class");
      expect(written).toContain("## NEW PLAN");
      // The mark stays where the user put it — and a RUN collapses to exactly
      // ONE, the policy `FrontmatterService.spliceBlock` and
      // `FileSystemVaultAdapter.replaceFrontmatter` already take (#4469).
      expect(written.startsWith("\uFEFF")).toBe(true);
      expect(written.charCodeAt(1)).not.toBe(0xfeff);
    });

    it("A3 a CRLF-fenced asset gets a CRLF seam — the write introduces no mixed terminator", async () => {
      const written = await runBodyTemplate(asset("\r\n", "", "crlf-uid-4473"));

      const fm = writtenFrontmatter(written);
      expect(fm).not.toBeNull();
      expect(fm).toContain("exo__Asset_uid: crlf-uid-4473");

      // The seam: the closing fence is followed by CRLF, never a bare LF.
      expect(written).toContain("---\r\n## NEW PLAN");
      expect(written).not.toContain("---\n## NEW PLAN");

      // And no line INSIDE the block lost its `\r` either: every LF in the
      // frontmatter half is preceded by a CR.
      const block = matchFrontmatterBlock(written)!;
      const head = written.slice(0, block.blockEnd);
      expect(head.match(/(?<!\r)\n/g)).toBeNull();
    });

    it("A4 the LF-fenced path is byte-identical to the pre-#4473 behaviour (control)", async () => {
      const written = await runBodyTemplate(asset("\n", "", "lf-uid-4473"));

      // Byte-exact: this is the shape the local-regex implementation produced,
      // so a mutant restoring that regex must leave THIS axis green.
      expect(written).toBe(
        [
          "---",
          "exo__Asset_uid: lf-uid-4473",
          'exo__Instance_class: "[[deadbeef-0000-4000-a000-000000000001]]"',
          STAMP,
          "---",
          "## NEW PLAN",
          "- step one",
          "- step two",
        ].join("\n"),
      );
    });

    it("A9 a frontmatter-less target still becomes the body verbatim — no block is invented (req 454ccedf B8)", async () => {
      const written = await runBodyTemplate("# plain markdown\nno fences here");
      expect(written).toBe(NEW_BODY);
      expect(matchFrontmatterBlock(written)).toBeNull();
    });
  });

  describe("extractBody — the create_instance cloneTargetBody channel", () => {
    const EXPECTED_BODY_LINES = ["OLD BODY LINE ONE", "OLD BODY LINE TWO"];

    it("A5 a lone-CR-fenced $target clones only its BODY — its frontmatter never leaks into the new asset's body", async () => {
      const { createdBody } = await runCloneTargetBody(
        asset("\r", "", "cr-src-4473"),
      );

      // The defect returned the WHOLE source file as "the body", so the clone
      // carried the source's identity into its own body half.
      expect(createdBody).not.toContain("exo__Asset_uid");
      expect(createdBody).not.toContain("cr-src-4473");
      expect(createdBody).not.toContain("---");
      // Byte-exact, NOT `toContain`: the seam separator must be swallowed too.
      // `/^\r?\n/` cannot strip a lone `\r`, so a laxer assertion would stay
      // green with the separator glued to the first body line.
      expect(createdBody).toBe(EXPECTED_BODY_LINES.join("\r"));
    });

    it("A6 a BOM-prefixed $target clones only its BODY", async () => {
      const { createdBody } = await runCloneTargetBody(
        asset("\n", "\uFEFF\uFEFF", "bom-src-4473"),
      );

      expect(createdBody).not.toContain("exo__Asset_uid: bom-src-4473");
      expect(createdBody).not.toContain("\uFEFF");
      expect(createdBody).not.toContain("---");
      // Byte-exact: slicing by the RECONSTRUCTION's length instead of
      // `leadingBlock().end` differs by exactly the normalised BOM bytes and
      // leaks a dash of the closing fence — a `toContain` would not see it.
      expect(createdBody).toBe(EXPECTED_BODY_LINES.join("\n"));
    });

    it("A7 a CRLF-fenced $target clones its body with the CR line endings intact (control)", async () => {
      const { createdBody } = await runCloneTargetBody(
        asset("\r\n", "", "crlf-src-4473"),
      );

      expect(createdBody).toBe(EXPECTED_BODY_LINES.join("\r\n"));
    });

    it("A8 an LF-fenced $target clones its body byte-identically (control)", async () => {
      const { createdBody } = await runCloneTargetBody(
        asset("\n", "", "lf-src-4473"),
      );

      expect(createdBody).toBe(EXPECTED_BODY_LINES.join("\n"));
    });
  });

  describe("round trip through the real channels", () => {
    it("A10 body_template then cloneTargetBody returns the written body verbatim in all three encodings", async () => {
      for (const [name, eol, bom] of [
        ["LF", "\n", ""],
        ["CRLF", "\r\n", ""],
        ["lone-CR", "\r", ""],
        ["BOM+LF", "\n", "\uFEFF"],
      ] as const) {
        const written = await runBodyTemplate(asset(eol, bom, `rt-${name}`));
        const { createdBody } = await runCloneTargetBody(written);
        expect(createdBody).toBe(NEW_BODY);
      }
    });
  });
});

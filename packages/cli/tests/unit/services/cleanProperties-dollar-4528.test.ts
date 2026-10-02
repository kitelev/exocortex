import { describe, it, expect } from "@jest/globals";
import {
  FrontmatterService,
  PropertyCleanupService,
} from "@kitelev/exocortex-core";
import { createCleanPropertiesService } from "@kitelev/exocortex-services";

/**
 * Req `a00031b2-43cd-47fa-8486-4493e22f4386` (issue #4528) — the defect sits on
 * the REPAIR path, the one path whose entire job is to leave every surviving
 * value byte-identical. `removeEmptyPropertiesFromContent` passed a string built
 * from the file's OWN frontmatter as `String.replace`'s second argument, so
 * `$$`, `$&`, `` $` ``, `$'` and `$1`..`$99` inside a surviving VALUE were read
 * as replacement patterns.
 *
 * ⛤ Measured on `origin/main` `cbff7ef5` through the real service (bytes read
 * back; input = `exo__Asset_label: Keeper` + the value + one empty property +
 * body `body text`):
 *   `cost $& ref`   → the WHOLE matched block inlined: a duplicate
 *                     `exo__Asset_label`, the empty key the repair had just
 *                     removed RESURRECTED, a stray `--- ref`, two closing `---`
 *                     (93 → 155 bytes)
 *   `cost $1 ref`   → capture group 1 (the original frontmatter) inlined
 *   `cost $100`     → ⛔ an ORDINARY money value: `$1` expands and `00` lands on
 *                     the next key (`ems__Effort_area:00`)
 *   `` cost $` ref `` → everything BEFORE the match (empty) — silently deleted
 *   `cost $' ref`   → everything AFTER the match — the note BODY — swallowed
 *   `cost $$100`    → silently becomes `cost $100`
 *
 * ⛔ WHY BOTH `$&` AND `$100` ARE AXES. The generic floor says a `$1` fixture is
 * vacuous because JS leaves `$1` literal on a pattern WITHOUT capture groups —
 * true in general, FALSE here: `frontmatterRegex` is
 * `/^---\n([\s\S]*?)\n---/` and has one group, measured rather than inherited.
 * `$&` stays the primary axis (it survives a refactor that drops the group);
 * `$100` is the realistic one — 79 live assets across the three canonical vaults
 * carry a frontmatter value with a form that actually corrupts (2026-10-03).
 *
 * ⛔ WHICH FORMS CORRUPT IS A MEASUREMENT, NOT A READING: pushing every token
 * through this exact regex shows `$$`, `$&`, `` $` ``, `$'`, `$01` and `$1` with
 * any trailing digits corrupt, while `$0` and `$2`..`$9` are INERT — with ONE
 * capture group, groups 2..9 do not exist, so JS leaves them literal (`cost $2
 * 500` comes out byte-identical). The first revision of these axes said "169",
 * counting every `$`+digit bucket — a predicate WIDER than "corrupts", inflating
 * the figure 2.1×. P4 therefore carries only forms proven to corrupt.
 *
 * ⛔ WHY THESE AXES LIVE IN `packages/cli`. The subject is in `packages/core`,
 * but the path the product reaches it through (`createCleanPropertiesService` →
 * `apply clean-properties`) is in `packages/services`, which NO workflow
 * jest-runs (`test-ci-batched.sh` drives obsidian-plugin / cli / core only).
 * `packages/cli/jest.config.js` has no allow-list and maps both packages to
 * SOURCE, so these axes exercise the real service through the real factory and
 * are gated by `test-coverage-cli` → `test-coverage`. Precedent: axis W8 of req
 * `5d2c7ede` in `updateProperty-empty-list-null-4516.test.ts`.
 *
 * Mutants — `packages/cli/tests/unit/services/cleanProperties-dollar-4528.spec.json`
 * (one per `.replace` site plus a control on the repair logic itself).
 */

const REQ = "@req:a00031b2-43cd-47fa-8486-4493e22f4386";

const PATH = "tasks/a.md";
const BODY = "body text\n\nsecond paragraph\n";

function makeVault(files: Map<string, string>) {
  return {
    async read(file: { path: string }): Promise<string> {
      const c = files.get(file.path);
      if (c === undefined) throw new Error(`not found: ${file.path}`);
      return c;
    },
    async modify(file: { path: string }, content: string): Promise<void> {
      files.set(file.path, content);
    },
    getFileByPath(path: string): { path: string } {
      return { path };
    },
  } as never;
}

/** Drives the REAL repair through the REAL grounding-service factory. */
async function repair(content: string): Promise<string> {
  const files = new Map([[PATH, content]]);
  const vault = makeVault(files);
  const service = createCleanPropertiesService(
    vault,
    new PropertyCleanupService(vault),
    { resolveFile: (iri: string) => ({ path: iri }) as never },
  );
  await service.execute(PATH);
  return files.get(PATH) as string;
}

function assetWith(value: string): string {
  return (
    `---\nexo__Asset_label: Keeper\n` +
    `ems__Effort_result: ${value}\n` +
    `ems__Effort_area:\n---\n${BODY}`
  );
}

describe("cleanEmptyProperties — surviving values stay byte-identical (#4528)", () => {
  it(`P1 ${REQ} a value carrying $& survives BYTE-IDENTICAL and the empty property is still removed`, async () => {
    const value = "cost $& ref";
    const after = await repair(assetWith(value));
    // ⛔ Byte-level by construction: comparing the LINE verbatim, never through a
    // regexp — a regexp built from the value would need `$` escaping and could
    // pass while the bytes differ.
    expect(after.split("\n")).toContain(`ems__Effort_result: ${value}`);
    expect(after).not.toMatch(/^ems__Effort_area:/m);
  });

  it(`P2 ${REQ} the $&-bearing asset keeps EXACTLY the expected keys — no duplicate, no stray delimiter`, async () => {
    // ⛔ The damage was structural, not only textual: the inlined block produced
    // a second `exo__Asset_label`, a resurrected empty key and two closing
    // `---`. Counting the delimiters and the keys is what notices that.
    const after = await repair(assetWith("cost $& ref"));
    expect(after.split("\n").filter((l) => l === "---")).toHaveLength(2);
    expect(
      after.split("\n").filter((l) => l.startsWith("exo__Asset_label:")),
    ).toHaveLength(1);
    const parsed = new FrontmatterService().parseObject(after) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual([
      "ems__Effort_result",
      "exo__Asset_label",
    ]);
  });

  it(`P3 ${REQ} an ORDINARY money value ($100) survives BYTE-IDENTICAL`, async () => {
    // The realistic carrier: `$1` expands HERE because frontmatterRegex has a
    // capture group, so `$100` was rewritten into the captured frontmatter plus
    // a stray `00`. Nothing exotic is needed to lose data.
    const after = await repair(assetWith("cost $100"));
    expect(after.split("\n")).toContain("ems__Effort_result: cost $100");
    expect(after).not.toMatch(/^ems__Effort_area/m);
  });

  it(`P4 ${REQ} every other replacement pattern survives BYTE-IDENTICAL`, async () => {
    for (const value of [
      "cost $` ref",
      "cost $' ref",
      "cost $$100",
      "cost $1 ref",
      "a $01 $10 $1000 mix",
    ]) {
      const after = await repair(assetWith(value));
      expect(after.split("\n")).toContain(`ems__Effort_result: ${value}`);
    }
  });

  it(`P5 ${REQ} the note BODY appears EXACTLY ONCE — $' copies it INTO the frontmatter`, async () => {
    // ⛔ This axis was WEAK on first writing and the matrix caught it: asserting
    // only `after.endsWith(\`---\\n\${BODY}\`)` passes on the CORRUPTED output too,
    // because `$'` (everything AFTER the match) does not MOVE the body — it
    // COPIES it into the value while the real tail stays in place. The honest
    // predicate is the occurrence COUNT; the tail check is kept as the second
    // half (integration-test-revert-verify: an axis satisfied by the broken
    // state is not an axis).
    const after = await repair(assetWith("cost $' ref"));
    expect(after.split("second paragraph").length - 1).toBe(1);
    expect(after.split(BODY).length - 1).toBe(1);
    expect(after.endsWith(`---\n${BODY}`)).toBe(true);
  });

  it(`P6 ${REQ} control — the repair still removes EVERY empty form and keeps the real ones`, async () => {
    // ⛔ The too-broad control: a "fix" that stopped rewriting the block at all
    // would pass P1-P5 and silently turn the repair into a no-op.
    const damaged =
      `---\nexo__Asset_label: Keeper\n` +
      `ems__Effort_result: ""\n` +
      `ems__Effort_parent: null\n` +
      `ems__Effort_votes: []\n` +
      `ems__Effort_meta: {}\n` +
      `ems__Effort_area:\n` +
      `ems__Effort_tags:\n  - \n  - ""\n` +
      `ems__Effort_status: real\n---\n${BODY}`;
    const after = await repair(damaged);
    for (const key of [
      "ems__Effort_result",
      "ems__Effort_parent",
      "ems__Effort_votes",
      "ems__Effort_meta",
      "ems__Effort_area",
      "ems__Effort_tags",
    ]) {
      expect(after).not.toMatch(new RegExp(`^${key}:`, "m"));
    }
    // Canary: the repair is not a no-op and does not take the real values with it.
    expect(after).toMatch(/^ems__Effort_status: real$/m);
    expect(after).toMatch(/^exo__Asset_label: Keeper$/m);
  });

  it(`P7 ${REQ} control — a POPULATED list is kept whole (the list branch is not collateral)`, async () => {
    const withList =
      `---\nexo__Asset_label: Keeper\n` +
      `ems__Effort_tags:\n  - alpha\n  - beta\n` +
      `ems__Effort_area:\n---\n${BODY}`;
    const after = await repair(withList);
    expect(after).toMatch(/^ems__Effort_tags:$/m);
    expect(after.split("\n")).toContain("  - alpha");
    expect(after.split("\n")).toContain("  - beta");
    expect(after).not.toMatch(/^ems__Effort_area/m);
  });

  it(`P8 ${REQ} control — an asset with NOTHING empty is left byte-identical`, async () => {
    const clean = `---\nexo__Asset_label: Keeper\nems__Effort_status: real\n---\n${BODY}`;
    expect(await repair(clean)).toBe(clean);
  });
});

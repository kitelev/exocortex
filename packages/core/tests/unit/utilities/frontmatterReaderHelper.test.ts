import { describe, it, expect } from "@jest/globals";
import * as yaml from "js-yaml";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

/**
 * Guards the shared test helper that replaced 29 hand-rolled copies of
 * `yaml.load(match[1])` (#4174).
 *
 * ⛤ This suite lives in `packages/core/tests` ON PURPOSE, not next to the helper
 * in `packages/test-utils/tests`: `ci.yml` never invokes that package's jest, so
 * an axis placed there would be an orphan suite — green forever, gating nothing.
 * `test-coverage-exocortex` runs this config in full, so this one is gated.
 *
 * What it locks: the helper reproduces js-yaml 4's DEFAULT_SCHEMA, which is what
 * the real readers still behave like (Obsidian's metadataCache;
 * `parseYamlFrontmatterTolerant`). js-yaml 5 moved the default to CORE, where a
 * bare date is a plain string — so the helper must name YAML11_SCHEMA, and if
 * someone drops that argument these axes go red.
 */
describe("parseFrontmatterAsReader (shared test helper, #4174)", () => {
  it("gives a bare date-like scalar the Date type the production readers see", () => {
    const parsed = parseFrontmatterAsReader(
      '---\nexo__Asset_createdAt: 2026-08-19\nexo__Asset_label: "2026-08-19"\n---\nbody\n',
    );

    expect(parsed.exo__Asset_createdAt).toBeInstanceOf(Date);
    expect((parsed.exo__Asset_createdAt as Date).toISOString()).toBe(
      "2026-08-19T00:00:00.000Z",
    );
    // The other half of the dual typing — quoted stays a string.
    expect(parsed.exo__Asset_label).toBe("2026-08-19");
  });

  it("canary: the ambient js-yaml default does NOT do this, so the axis above is about the helper", () => {
    // ⛤ Without this the suite could pass because js-yaml happened to default
    // to YAML 1.1 — i.e. for a reason that has nothing to do with the helper.
    expect(yaml.load("d: 2026-08-19")).toEqual({ d: "2026-08-19" });
  });

  it("returns {} for a file with no frontmatter rather than throwing", () => {
    expect(parseFrontmatterAsReader("plain text, no fences\n")).toEqual({});
  });

  it("returns {} when the block is not a mapping", () => {
    // A sequence or a scalar is not frontmatter; callers expect a record.
    expect(parseFrontmatterAsReader("---\n- a\n- b\n---\n")).toEqual({});
  });
});

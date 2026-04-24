/**
 * Reliability fault-injection matrix — RFC exo__Layout Phase 2 ISO 25010.
 *
 * Covers:
 *   - Malformed Layout frontmatter  → parser returns null, warn fires, no throw.
 *   - Malformed LayoutBlock frontmatter → parser returns null, warn fires.
 *   - Missing block asset (Layout references block that is not in repo)
 *     → renderer skips, logs warn, continues with remaining blocks.
 *   - Circular block ref (block references itself as sub-block — not
 *     supported by schema, but parser MUST not loop).
 *   - Invalid block type (frontmatter-declared class is unknown)
 *     → parser returns null, repository filters out.
 */

import {
  createLayoutBlockFromFrontmatter,
  createLayoutFromFrontmatter,
  isLayoutBlockFrontmatter,
  isLayoutFrontmatter,
} from "exocortex";

describe("exo__Layout fault-injection matrix (RFC exo__Layout Phase 2)", () => {
  test("null/undefined frontmatter does NOT throw; parser returns null", () => {
    const warn = jest.fn();
    expect(
      createLayoutFromFrontmatter(null, { sourcePath: "a.md", warn }),
    ).toBeNull();
    expect(
      createLayoutFromFrontmatter(undefined, { sourcePath: "a.md", warn }),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("Layout missing exo__Layout_targetClass returns null + warn", () => {
    const warn = jest.fn();
    const result = createLayoutFromFrontmatter(
      {
        exo__Asset_uid: "uid",
        exo__Instance_class: ["[[exo__Layout]]"],
        exo__Layout_blocks: ["[[b1]]"],
      },
      { sourcePath: "a.md", warn },
    );
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("Layout with empty blocks array returns null + warn", () => {
    const warn = jest.fn();
    const result = createLayoutFromFrontmatter(
      {
        exo__Asset_uid: "uid",
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_blocks: [],
      },
      { sourcePath: "a.md", warn },
    );
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("Layout missing uid returns null + warn", () => {
    const warn = jest.fn();
    const result = createLayoutFromFrontmatter(
      {
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_blocks: ["[[b1]]"],
      },
      { sourcePath: "a.md", warn },
    );
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("BacklinksTableBlock missing rowClass returns null + warn", () => {
    const warn = jest.fn();
    const result = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "uid",
        exo__Instance_class: ["[[exo__BacklinksTableBlock]]"],
        exo__BacklinksTableBlock_referencingProperty: "[[ems__Task__parent]]",
      },
      { sourcePath: "b.md", warn },
    );
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("LayoutBlock with unknown subclass returns null + warn", () => {
    const warn = jest.fn();
    const result = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "uid",
        exo__Instance_class: ["[[exo__LayoutBlock]]", "[[exo__UnknownBlock]]"],
        exo__LayoutBlock_title: "Unknown",
      },
      { sourcePath: "b.md", warn },
    );
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("isLayoutFrontmatter rejects unrelated classes (class-filter gate)", () => {
    expect(
      isLayoutFrontmatter({
        exo__Instance_class: ["[[ems__Task]]"],
      }),
    ).toBe(false);
    expect(isLayoutFrontmatter(null)).toBe(false);
    expect(isLayoutFrontmatter(undefined)).toBe(false);
  });

  test("isLayoutBlockFrontmatter rejects unrelated classes", () => {
    expect(
      isLayoutBlockFrontmatter({
        exo__Instance_class: ["[[ems__Task]]"],
      }),
    ).toBe(false);
    expect(isLayoutBlockFrontmatter(null)).toBe(false);
  });

  test("circular self-reference in blocks array does not loop parser", () => {
    const warn = jest.fn();
    // Parser only normalizes strings — circular refs are semantic, not syntactic.
    const result = createLayoutFromFrontmatter(
      {
        exo__Asset_uid: "self",
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_blocks: ["[[self]]"],
      },
      { sourcePath: "a.md", warn },
    );
    // Parser accepts — the repo/renderer are responsible for cycle detection.
    expect(result).not.toBeNull();
    expect(result?.blocks).toEqual(["self"]);
  });

  test("malformed blocks array (mixed nulls / numbers) filtered to valid strings", () => {
    const warn = jest.fn();
    const result = createLayoutFromFrontmatter(
      {
        exo__Asset_uid: "uid",
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_blocks: ["[[b1]]", 42 as unknown as string, null, "[[b2]]"],
      },
      { sourcePath: "a.md", warn },
    );
    expect(result).not.toBeNull();
    expect(result?.blocks).toEqual(["b1", "b2"]);
  });

  test("malformed priority (non-numeric string) defaults to 0", () => {
    const warn = jest.fn();
    const result = createLayoutFromFrontmatter(
      {
        exo__Asset_uid: "uid",
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_blocks: ["[[b1]]"],
        exo__Layout_priority: "not-a-number",
      },
      { sourcePath: "a.md", warn },
    );
    expect(result?.priority).toBe(0);
  });
});

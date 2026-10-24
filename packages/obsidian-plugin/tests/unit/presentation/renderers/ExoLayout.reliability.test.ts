/**
 * Reliability fault-injection matrix — RFC exo__Layout Phase 2 ISO 25010.
 *
 * Covers:
 *   - Malformed Layout frontmatter  → parser returns null, warn fires, no throw.
 *   - Malformed LayoutBlock frontmatter → parser returns null, warn fires.
 *   - Missing block asset (Layout references block that is not in repo)
 *     → renderer skips, logs warn, continues with remaining blocks.
 *   - Block → Layout link (RFC 9821a379 decision 3): `exo__Layout_blocks` is
 *     not read; a Layout no block names is dropped by `assembleLayoutBlocks`
 *     (warn), a malformed link attaches the block to nothing (warn, no loop).
 *   - Invalid block type (frontmatter-declared class is unknown)
 *     → parser returns null, repository filters out.
 */

import {
  assembleLayoutBlocks,
  createLayoutBlockFromFrontmatter,
  createLayoutFromFrontmatter,
  isLayoutBlockFrontmatter,
  isLayoutFrontmatter,
} from "@kitelev/exocortex-core";

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
      },
      { sourcePath: "a.md", warn },
    );
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("Layout that no block names is dropped by assembly + warn (exo__Layout_blocks is not read)", () => {
    const warn = jest.fn();
    const parsed = createLayoutFromFrontmatter(
      {
        exo__Asset_uid: "uid",
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_blocks: ["[[b1]]"],
      },
      { sourcePath: "a.md", warn },
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.blocks).toEqual([]);
    const b1 = createLayoutBlockFromFrontmatter(
      { exo__Asset_uid: "b1", exo__Instance_class: ["[[exo__PropertiesBlock]]"] },
      { sourcePath: "b1.md", warn },
    );
    const assembled = assembleLayoutBlocks(parsed ? [parsed] : [], b1 ? [b1] : [], warn);
    expect(assembled).toEqual([]);
    expect(
      warn.mock.calls.some(([m]) => String(m).includes("exo__Layout_blocks is no longer read")),
    ).toBe(true);
  });

  test("Layout missing uid returns null + warn", () => {
    const warn = jest.fn();
    const result = createLayoutFromFrontmatter(
      {
        exo__Layout_targetClass: "[[ems__Task]]",
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

  test("a block naming another block (not a Layout) attaches to nothing — single pass, no loop", () => {
    const warn = jest.fn();
    const layout = createLayoutFromFrontmatter(
      { exo__Asset_uid: "L", exo__Layout_targetClass: "[[ems__Task]]" },
      { sourcePath: "L.md", warn },
    );
    const self = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "self",
        exo__Instance_class: ["[[exo__PropertiesBlock]]"],
        exo__LayoutBlock_layout: "[[self]]",
      },
      { sourcePath: "self.md", warn },
    );
    const assembled = assembleLayoutBlocks(layout ? [layout] : [], self ? [self] : [], warn);
    expect(assembled).toEqual([]);
    expect(
      warn.mock.calls.some(([m]) => String(m).includes("names no known Layout")),
    ).toBe(true);
  });

  test("malformed exo__LayoutBlock_layout (number / list) — block belongs to no Layout + warn", () => {
    for (const bad of [42, ["[[L]]"]]) {
      const warn = jest.fn();
      const block = createLayoutBlockFromFrontmatter(
        {
          exo__Asset_uid: "b",
          exo__Instance_class: ["[[exo__PropertiesBlock]]"],
          exo__LayoutBlock_layout: bad,
        },
        { sourcePath: "b.md", warn },
      );
      expect(block?.layoutRef).toBeNull();
      expect(
        warn.mock.calls.some(([m]) => String(m).includes("must be a single wikilink")),
      ).toBe(true);
    }
  });

  test("malformed priority (non-numeric string) defaults to 0", () => {
    const warn = jest.fn();
    const result = createLayoutFromFrontmatter(
      {
        exo__Asset_uid: "uid",
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_priority: "not-a-number",
      },
      { sourcePath: "a.md", warn },
    );
    expect(result?.priority).toBe(0);
  });
});

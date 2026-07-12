/**
 * LayoutBlock parser — the new `visible` flag (RL#4a) and the
 * `daily-efforts-by-class` block kind (RL#4b). Covers the model-extension half
 * of req a38ac95b.
 *
 * @req:a38ac95b-b347-42e4-8522-f481ab422337
 *
 * revert-verify:
 *  - removing the `daily-efforts-by-class` branch in
 *    `createLayoutBlockFromFrontmatter` → "parses daily-efforts-by-class block"
 *    goes RED (returns null), other kinds stay GREEN.
 *  - changing `coerceVisible` to always return `true` → the
 *    "visible: false parsed" test goes RED.
 */

import {
  DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI,
  DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID,
  PROPERTIES_BLOCK_CLASS_IRI,
  createLayoutBlockFromFrontmatter,
  isDailyEffortsByClassBlock,
  isLayoutBlockFrontmatter,
} from "../../../src/domain/layout/LayoutBlock";

const SRC = { sourcePath: "block.md" };

describe("LayoutBlock — visible flag (RL#4a, req a38ac95b)", () => {
  test("omitted exo__LayoutBlock_visible → undefined (back-compat visible)", () => {
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "u1",
        exo__Instance_class: [`[[${PROPERTIES_BLOCK_CLASS_IRI}]]`],
      },
      SRC,
    );
    expect(block).not.toBeNull();
    expect(block?.visible).toBeUndefined();
  });

  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 exo__LayoutBlock_visible: false → visible=false", () => {
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "u1",
        exo__Instance_class: [`[[${PROPERTIES_BLOCK_CLASS_IRI}]]`],
        exo__LayoutBlock_visible: false,
      },
      SRC,
    );
    expect(block?.visible).toBe(false);
  });

  test("exo__LayoutBlock_visible: \"false\" (string) → visible=false", () => {
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "u1",
        exo__Instance_class: [`[[${PROPERTIES_BLOCK_CLASS_IRI}]]`],
        exo__LayoutBlock_visible: "false",
      },
      SRC,
    );
    expect(block?.visible).toBe(false);
  });
});

describe("LayoutBlock — daily-efforts-by-class kind (RL#4b, req a38ac95b)", () => {
  test("isLayoutBlockFrontmatter recognises the new block class (IRI + UID)", () => {
    expect(
      isLayoutBlockFrontmatter({
        exo__Instance_class: [`[[${DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI}]]`],
      }),
    ).toBe(true);
    expect(
      isLayoutBlockFrontmatter({
        exo__Instance_class: [`[[${DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID}]]`],
      }),
    ).toBe(true);
  });

  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 parses a daily-efforts-by-class block with a valid partition", () => {
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "daily-actions",
        exo__Asset_label: "Действия",
        exo__Instance_class: [`[[${DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID}]]`],
        exo__DailyEffortsByClassBlock_partition: "actions",
        exo__LayoutBlock_visible: false,
      },
      SRC,
    );
    expect(block).not.toBeNull();
    expect(block?.kind).toBe("daily-efforts-by-class");
    expect(block && isDailyEffortsByClassBlock(block)).toBe(true);
    if (block && isDailyEffortsByClassBlock(block)) {
      expect(block.partition).toBe("actions");
      expect(block.title).toBe("Действия");
      expect(block.visible).toBe(false);
    }
  });

  test("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 parses a daily-efforts-by-class block with the 'closed' partition (issue #3781)", () => {
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "daily-closed",
        exo__Asset_label: "Closed today",
        exo__Instance_class: [`[[${DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID}]]`],
        exo__DailyEffortsByClassBlock_partition: "closed",
      },
      SRC,
    );
    expect(block).not.toBeNull();
    expect(block?.kind).toBe("daily-efforts-by-class");
    expect(block && isDailyEffortsByClassBlock(block)).toBe(true);
    if (block && isDailyEffortsByClassBlock(block)) {
      expect(block.partition).toBe("closed");
      expect(block.title).toBe("Closed today");
    }
  });

  test.each(["actions", "tasks", "projects", "closed", "CLOSED", "  Closed "])(
    "accepts and normalises partition %p",
    (raw) => {
      const block = createLayoutBlockFromFrontmatter(
        {
          exo__Asset_uid: "b",
          exo__Instance_class: [
            `[[${DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI}]]`,
          ],
          exo__DailyEffortsByClassBlock_partition: raw,
        },
        SRC,
      );
      expect(block?.kind).toBe("daily-efforts-by-class");
    },
  );

  test("rejects (returns null) an invalid / missing partition", () => {
    const warnings: string[] = [];
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b",
        exo__Instance_class: [`[[${DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI}]]`],
        exo__DailyEffortsByClassBlock_partition: "bogus",
      },
      { ...SRC, warn: (m) => warnings.push(m) },
    );
    expect(block).toBeNull();
    expect(warnings.some((w) => w.includes("partition"))).toBe(true);
  });
});

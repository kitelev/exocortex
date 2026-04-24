import {
  createRelationColumnSetFromFrontmatter,
  isRelationColumnSet,
  isRelationColumnSetFrontmatter,
  normalizeRef,
  RELATION_COLUMN_SET_CLASS_IRI,
  RELATION_COLUMN_SET_CLASS_UID,
  type CreateRelationColumnSetOptions,
} from "../../../src/domain/layout/RelationColumnSet";

const SOURCE_PATH = "03 Knowledge/ui/a.md";
const OTHER_PATH = "03 Knowledge/ui/foobar.md";

function makeWarn() {
  const messages: string[] = [];
  const warn = (m: string) => {
    messages.push(m);
  };
  return { warn, messages };
}

describe("normalizeRef", () => {
  test("returns bare identifier for wikilink", () => {
    expect(normalizeRef("[[foo]]")).toBe("foo");
  });

  test("strips alias after pipe", () => {
    expect(normalizeRef("[[uuid|Display Name]]")).toBe("uuid");
  });

  test("preserves raw identifier when no wikilink", () => {
    expect(normalizeRef("ems__Effort_status")).toBe("ems__Effort_status");
  });

  test("trims whitespace", () => {
    expect(normalizeRef("  [[foo]]  ")).toBe("foo");
  });

  test("returns null for empty string", () => {
    expect(normalizeRef("")).toBeNull();
    expect(normalizeRef("   ")).toBeNull();
  });

  test("returns null for non-string input", () => {
    expect(normalizeRef(42)).toBeNull();
    expect(normalizeRef(null)).toBeNull();
    expect(normalizeRef(undefined)).toBeNull();
    expect(normalizeRef({})).toBeNull();
  });

  test("normalization is idempotent", () => {
    const first = normalizeRef("[[alpha|Label]]");
    const second = first ? normalizeRef(first) : null;
    expect(second).toBe(first);
  });

  test("returns null for wikilink with empty content", () => {
    expect(normalizeRef("[[|alias]]")).toBeNull();
  });
});

describe("createRelationColumnSetFromFrontmatter — happy path", () => {
  test("parses a fully-populated asset", () => {
    const { warn, messages } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "6533ca08-uid",
        ui__RelationColumnSet_label: "Week → WeeklyObjective",
        ui__RelationColumnSet_targetClass: ["[[ems__WeeklyObjective]]"],
        ui__RelationColumnSet_referencingProperty: "[[ems__WeeklyObjective__week]]",
        ui__RelationColumnSet_columns: [
          "[[exo__Asset_createdAt]]",
          "[[exo__Asset_label]]",
        ],
        ui__RelationColumnSet_priority: 10,
      },
      { sourcePath: SOURCE_PATH, warn },
    );

    expect(result).not.toBeNull();
    expect(result).toEqual({
      uid: "6533ca08-uid",
      label: "Week → WeeklyObjective",
      targetClasses: ["ems__WeeklyObjective"],
      referencingProperty: "ems__WeeklyObjective__week",
      columns: ["[[exo__Asset_createdAt]]", "[[exo__Asset_label]]"],
      priority: 10,
      sourcePath: SOURCE_PATH,
    });
    expect(messages).toHaveLength(0);
    expect(isRelationColumnSet(result)).toBe(true);
  });

  test("accepts targetClass as a bare string (single)", () => {
    const { warn } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "single-class",
        ui__RelationColumnSet_targetClass: "[[ems__WeeklyObjective]]",
        ui__RelationColumnSet_columns: ["[[exo__Asset_label]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result?.targetClasses).toEqual(["ems__WeeklyObjective"]);
  });

  test("multi-class targetClass preserves declaration order", () => {
    const { warn } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "multi",
        ui__RelationColumnSet_targetClass: [
          "[[ems__WeeklyObjective]]",
          "[[ems__Objective]]",
          "[[ems__KR]]",
        ],
        ui__RelationColumnSet_columns: ["[[col]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result?.targetClasses).toEqual([
      "ems__WeeklyObjective",
      "ems__Objective",
      "ems__KR",
    ]);
  });

  test("label defaults to basename when absent", () => {
    const { warn } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "no-label",
        ui__RelationColumnSet_targetClass: ["[[X]]"],
        ui__RelationColumnSet_columns: ["[[y]]"],
      },
      { sourcePath: OTHER_PATH, warn },
    );
    expect(result?.label).toBe("foobar");
  });

  test("priority parses numeric string", () => {
    const { warn } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "str-prio",
        ui__RelationColumnSet_targetClass: ["[[X]]"],
        ui__RelationColumnSet_columns: ["[[c]]"],
        ui__RelationColumnSet_priority: "-3",
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result?.priority).toBe(-3);
  });

  test("priority defaults to 0 when missing or invalid", () => {
    const cases: unknown[] = [undefined, null, "abc", NaN, { x: 1 }];
    for (const value of cases) {
      const { warn } = makeWarn();
      const result = createRelationColumnSetFromFrontmatter(
        {
          exo__Asset_uid: "p",
          ui__RelationColumnSet_targetClass: ["[[X]]"],
          ui__RelationColumnSet_columns: ["[[c]]"],
          ui__RelationColumnSet_priority: value,
        },
        { sourcePath: SOURCE_PATH, warn },
      );
      expect(result?.priority).toBe(0);
    }
  });

  test("property-only matcher (no targetClass) allowed", () => {
    const { warn } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "prop-only",
        ui__RelationColumnSet_referencingProperty: "[[some_prop]]",
        ui__RelationColumnSet_columns: ["[[col]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result?.targetClasses).toBeNull();
    expect(result?.referencingProperty).toBe("some_prop");
  });

  test("class-only matcher (no referencingProperty) allowed", () => {
    const { warn } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "cls-only",
        ui__RelationColumnSet_targetClass: ["[[X]]"],
        ui__RelationColumnSet_columns: ["[[col]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result?.targetClasses).toEqual(["X"]);
    expect(result?.referencingProperty).toBeNull();
  });
});

describe("createRelationColumnSetFromFrontmatter — invalid inputs", () => {
  test("skips assets missing both targetClass and referencingProperty", () => {
    const { warn, messages } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "no-keys",
        ui__RelationColumnSet_columns: ["[[col]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result).toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("no-keys");
  });

  test("skips assets missing uid", () => {
    const { warn, messages } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        ui__RelationColumnSet_targetClass: ["[[X]]"],
        ui__RelationColumnSet_columns: ["[[col]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result).toBeNull();
    expect(messages[0]).toMatch(/exo__Asset_uid missing/);
  });

  test("skips assets with empty columns array", () => {
    const { warn, messages } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "empty-cols",
        ui__RelationColumnSet_targetClass: ["[[X]]"],
        ui__RelationColumnSet_columns: [],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result).toBeNull();
    expect(messages[0]).toMatch(/columns array/);
  });

  test("skips when columns array has only blanks", () => {
    const { warn, messages } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "blank-cols",
        ui__RelationColumnSet_targetClass: ["[[X]]"],
        ui__RelationColumnSet_columns: ["", "   ", null],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result).toBeNull();
    expect(messages[0]).toMatch(/columns array/);
  });

  test("tolerates missing frontmatter (null)", () => {
    const { warn, messages } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(null, {
      sourcePath: SOURCE_PATH,
      warn,
    });
    expect(result).toBeNull();
    expect(messages[0]).toContain(SOURCE_PATH);
  });

  test("optional warn function — default noop does not throw", () => {
    const options: CreateRelationColumnSetOptions = { sourcePath: SOURCE_PATH };
    expect(() =>
      createRelationColumnSetFromFrontmatter(
        { exo__Asset_uid: "" },
        options,
      ),
    ).not.toThrow();
  });

  test("whitespace-only uid rejected", () => {
    const { warn, messages } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "   ",
        ui__RelationColumnSet_targetClass: ["[[X]]"],
        ui__RelationColumnSet_columns: ["[[c]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result).toBeNull();
    expect(messages[0]).toMatch(/exo__Asset_uid/);
  });

  test("invalid wikilinks in targetClass are dropped", () => {
    const { warn } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "mixed",
        ui__RelationColumnSet_targetClass: [
          "[[A]]",
          42,
          "",
          "[[B|Alias]]",
          null,
        ],
        ui__RelationColumnSet_columns: ["[[c]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result?.targetClasses).toEqual(["A", "B"]);
  });
});

describe("isRelationColumnSet", () => {
  const valid = {
    uid: "x",
    label: "l",
    targetClasses: ["a"],
    referencingProperty: null,
    columns: ["[[c]]"],
    priority: 0,
    sourcePath: "p",
  };

  test("accepts a well-formed object", () => {
    expect(isRelationColumnSet(valid)).toBe(true);
  });

  test("accepts null referencingProperty + non-null targetClasses", () => {
    expect(isRelationColumnSet({ ...valid, targetClasses: null, referencingProperty: "p" })).toBe(
      true,
    );
  });

  test("rejects when uid empty", () => {
    expect(isRelationColumnSet({ ...valid, uid: "" })).toBe(false);
  });

  test("rejects when columns empty", () => {
    expect(isRelationColumnSet({ ...valid, columns: [] })).toBe(false);
  });

  test("rejects when priority NaN", () => {
    expect(isRelationColumnSet({ ...valid, priority: NaN })).toBe(false);
  });

  test("rejects non-object inputs", () => {
    expect(isRelationColumnSet(null)).toBe(false);
    expect(isRelationColumnSet(undefined)).toBe(false);
    expect(isRelationColumnSet("x")).toBe(false);
  });

  test("rejects non-string targetClasses entries", () => {
    expect(isRelationColumnSet({ ...valid, targetClasses: [1, 2] as unknown as string[] })).toBe(
      false,
    );
  });

  test("rejects when referencingProperty is neither null nor string", () => {
    expect(
      isRelationColumnSet({
        ...valid,
        referencingProperty: 42 as unknown as string,
      }),
    ).toBe(false);
  });

  test("rejects when label is not a string", () => {
    expect(isRelationColumnSet({ ...valid, label: 1 as unknown as string })).toBe(false);
  });

  test("rejects when columns contain non-string entries", () => {
    expect(
      isRelationColumnSet({ ...valid, columns: ["a", 1 as unknown as string] }),
    ).toBe(false);
  });

  test("rejects when sourcePath not a string", () => {
    expect(
      isRelationColumnSet({ ...valid, sourcePath: 1 as unknown as string }),
    ).toBe(false);
  });

  test("rejects when targetClasses is not an array nor null", () => {
    expect(
      isRelationColumnSet({
        ...valid,
        targetClasses: "oops" as unknown as string[],
      }),
    ).toBe(false);
  });
});

describe("toStringArray edge cases (via factory)", () => {
  test("accepts object-valued targetClass (dropped, no classes, rejected)", () => {
    const { warn, messages } = makeWarn();
    const result = createRelationColumnSetFromFrontmatter(
      {
        exo__Asset_uid: "weird",
        ui__RelationColumnSet_targetClass: { x: "y" },
        ui__RelationColumnSet_columns: ["[[col]]"],
      },
      { sourcePath: SOURCE_PATH, warn },
    );
    expect(result).toBeNull();
    expect(messages[0]).toMatch(/at least one of/);
  });
});

describe("isRelationColumnSetFrontmatter", () => {
  test("recognises class in wikilink form", () => {
    expect(
      isRelationColumnSetFrontmatter({
        exo__Instance_class: [`[[${RELATION_COLUMN_SET_CLASS_IRI}]]`],
      }),
    ).toBe(true);
  });

  test("recognises aliased wikilink (UUID + class-name alias — starter-kit convention)", () => {
    expect(
      isRelationColumnSetFrontmatter({
        exo__Instance_class: [
          `[[${RELATION_COLUMN_SET_CLASS_UID}|${RELATION_COLUMN_SET_CLASS_IRI}]]`,
        ],
      }),
    ).toBe(true);
  });

  test("recognises bare class UUID", () => {
    expect(
      isRelationColumnSetFrontmatter({
        exo__Instance_class: [`[[${RELATION_COLUMN_SET_CLASS_UID}]]`],
      }),
    ).toBe(true);
  });

  test("recognises plain string class", () => {
    expect(
      isRelationColumnSetFrontmatter({
        exo__Instance_class: RELATION_COLUMN_SET_CLASS_IRI,
      }),
    ).toBe(true);
  });

  test("rejects unrelated classes", () => {
    expect(
      isRelationColumnSetFrontmatter({
        exo__Instance_class: ["[[ems__Task]]"],
      }),
    ).toBe(false);
  });

  test("tolerates missing frontmatter / wrong shape", () => {
    expect(isRelationColumnSetFrontmatter(null)).toBe(false);
    expect(isRelationColumnSetFrontmatter(undefined)).toBe(false);
    expect(isRelationColumnSetFrontmatter({})).toBe(false);
  });
});

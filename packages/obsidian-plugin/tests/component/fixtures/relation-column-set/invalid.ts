/**
 * Invalid fixture — frontmatter-shaped inputs that must be rejected by
 * `createRelationColumnSetFromFrontmatter`.  The repository skips these and
 * logs a warning, so UniversalLayout renders with the default fallback.
 *
 * RFC v2 §"Риски" reliability gate: no fault-injection case may throw or
 * bring down the React tree.
 */

type FrontmatterCase = {
  readonly name: string;
  readonly frontmatter: Record<string, unknown>;
  readonly sourcePath: string;
  readonly why: string;
};

export const invalidFrontmatterCases: readonly FrontmatterCase[] = [
  {
    name: "missing exo__Asset_uid",
    sourcePath: "_fixtures/relation-column-set/invalid-no-uid.md",
    frontmatter: {
      exo__Instance_class: ["[[ui__RelationColumnSet]]"],
      ui__RelationColumnSet_targetClass: ["[[ems__Task]]"],
      ui__RelationColumnSet_columns: ["exo__Asset_label"],
    },
    why: "uid missing → skip + warn",
  },
  {
    name: "neither targetClass nor referencingProperty",
    sourcePath: "_fixtures/relation-column-set/invalid-no-keys.md",
    frontmatter: {
      exo__Instance_class: ["[[ui__RelationColumnSet]]"],
      exo__Asset_uid: "00000000-0000-0000-0000-000000000001",
      ui__RelationColumnSet_columns: ["exo__Asset_label"],
    },
    why: "at least one of targetClass/referencingProperty required",
  },
  {
    name: "empty columns array",
    sourcePath: "_fixtures/relation-column-set/invalid-empty-columns.md",
    frontmatter: {
      exo__Instance_class: ["[[ui__RelationColumnSet]]"],
      exo__Asset_uid: "00000000-0000-0000-0000-000000000002",
      ui__RelationColumnSet_targetClass: ["[[ems__Task]]"],
      ui__RelationColumnSet_columns: [],
    },
    why: "columns≥1 required",
  },
  {
    name: "columns contains circular self-reference wikilink",
    sourcePath: "_fixtures/relation-column-set/invalid-circular.md",
    frontmatter: {
      exo__Instance_class: ["[[ui__RelationColumnSet]]"],
      exo__Asset_uid: "00000000-0000-0000-0000-000000000003",
      ui__RelationColumnSet_targetClass: ["[[ems__Task]]"],
      ui__RelationColumnSet_columns: [
        "[[00000000-0000-0000-0000-000000000003]]",
      ],
    },
    why: "circular wikilink — accepted by parser, resolver will surface undefined at render time (auto-escaped)",
  },
  {
    name: "non-existent property reference",
    sourcePath: "_fixtures/relation-column-set/invalid-missing-prop.md",
    frontmatter: {
      exo__Instance_class: ["[[ui__RelationColumnSet]]"],
      exo__Asset_uid: "00000000-0000-0000-0000-000000000004",
      ui__RelationColumnSet_targetClass: ["[[ems__Task]]"],
      ui__RelationColumnSet_columns: ["nonexistent__Property"],
    },
    why: "unknown property — renderer shows empty cell, never throws",
  },
  {
    name: "malformed frontmatter (null exo__Instance_class)",
    sourcePath: "_fixtures/relation-column-set/invalid-malformed.md",
    frontmatter: {
      exo__Instance_class: null,
      exo__Asset_uid: "00000000-0000-0000-0000-000000000005",
      ui__RelationColumnSet_columns: ["exo__Asset_label"],
    },
    why: "malformed — isRelationColumnSetFrontmatter returns false, silently ignored",
  },
];

export type { FrontmatterCase };

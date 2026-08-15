/**
 * printName: `exo__PrintedProperty_property` as an ORDERED PREFERENCE LIST.
 *
 * A multi-value `exo__PrintedProperty_property` means "print the FIRST of these
 * that has a value", not "print all of them". The motivating case is a date
 * whose authoritative source degrades: `ems__Effort_endTimestamp` →
 * `ems__Effort_plannedEndTimestamp` → `ems__Effort_startTimestamp` →
 * `ems__Effort_plannedStartTimestamp`.
 *
 * ⛔ Why a list and NOT four separate parts: four parts print EVERY candidate
 * that happens to be set, so an effort carrying both an end and a start
 * timestamp would render both dates. That is a concatenation, not a preference.
 *
 * Production-shape: the fixture vault carries the real class-def and real
 * property-defs, and the test drives the REAL
 * `PrintNameRuleService.scanVault()` → `DisplayNameResolver.resolve()` pipeline.
 * The template under test is COMPILED from the fixture's `exo__DisplayNameSpec`
 * + `exo__PrintedProperty` assets exactly as the plugin compiles the live vault
 * — nothing is hand-injected.
 *
 * Revert-verify: dropping the multi-candidate walk in
 * `DisplayNameTemplateEngine.resolveValue` turns the fallback axes RED while the
 * single-candidate axis stays GREEN; dropping the `join("|")` in
 * `PrintNameRuleService.resolvePropertyKey` turns them RED the same way from the
 * compile side.
 */
import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "@plugin/domain/settings/ExocortexSettings";
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";

const EXO_CLASS_METACLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9";
const DISPLAY_NAME_SPEC_UID = "07eab746-0874-4676-9d98-dbaad1bc6fb8";
const PRINTED_PROPERTY_UID = "7d58de40-d941-4a66-88e2-13afc4fdc41d";
const DATATYPE_PROPERTY_UID = "ae56ca4c-b610-42a4-a25d-058c23673296";

const ACTION_CLASS_UID = "6a99d2ca-d402-4734-a10b-33f5f1a1aa42";
const SPEC_UID = "dddddddd-0000-4000-8000-000000000001";
const SINGLE_SPEC_UID = "dddddddd-0000-4000-8000-000000000002";

const PROP_END = "eeeeeeee-0000-4000-8000-00000000000a";
const PROP_PLANNED_END = "eeeeeeee-0000-4000-8000-00000000000b";
const PROP_START = "eeeeeeee-0000-4000-8000-00000000000c";
const PROP_PLANNED_START = "eeeeeeee-0000-4000-8000-00000000000d";
const PROP_PROTOTYPE = "eeeeeeee-0000-4000-8000-00000000000e";

interface Fixture {
  path: string;
  frontmatter: Record<string, unknown>;
}

function createMockApp(files: Fixture[]): App {
  const fileCache = new Map<string, CachedMetadata>();
  const mockFiles: TFile[] = [];
  for (const f of files) {
    const tfile = new TFile(f.path);
    tfile.basename = f.path.replace(/\.md$/, "");
    tfile.extension = "md";
    mockFiles.push(tfile);
    fileCache.set(f.path, { frontmatter: f.frontmatter } as CachedMetadata);
  }
  return {
    vault: { getMarkdownFiles: () => mockFiles },
    metadataCache: {
      getFileCache: (file: TFile) => fileCache.get(file.path) ?? null,
      getFirstLinkpathDest: (p: string) => {
        const clean = p.endsWith(".md") ? p : `${p}.md`;
        return mockFiles.find((f) => f.path === clean) ?? null;
      },
    },
  } as unknown as App;
}

/** A property DEF asset — so resolvePropertyKey's second hop resolves for real. */
function propertyDef(uid: string, label: string): Fixture {
  return {
    path: `${uid}.md`,
    frontmatter: {
      exo__Asset_uid: uid,
      exo__Instance_class: [`[[${DATATYPE_PROPERTY_UID}]]`],
      exo__Asset_label: label,
    },
  };
}

function baseFixtures(): Fixture[] {
  return [
    {
      path: `${ACTION_CLASS_UID}.md`,
      frontmatter: {
        exo__Asset_uid: ACTION_CLASS_UID,
        exo__Instance_class: [`[[${EXO_CLASS_METACLASS}]]`],
        exo__Asset_label: "ems__Action",
      },
    },
    propertyDef(PROP_END, "ems__Effort_endTimestamp"),
    propertyDef(PROP_PLANNED_END, "ems__Effort_plannedEndTimestamp"),
    propertyDef(PROP_START, "ems__Effort_startTimestamp"),
    propertyDef(PROP_PLANNED_START, "ems__Effort_plannedStartTimestamp"),
    propertyDef(PROP_PROTOTYPE, "exo__Asset_prototype"),
  ];
}

function printedProperty(
  uid: string,
  specUid: string,
  order: number,
  property: string | string[],
  format?: string,
): Fixture {
  return {
    path: `${uid}.md`,
    frontmatter: {
      exo__Asset_uid: uid,
      exo__Instance_class: [`[[${PRINTED_PROPERTY_UID}]]`],
      exo__DisplayNamePart_of: `[[${specUid}]]`,
      exo__DisplayNamePart_order: order,
      exo__PrintedProperty_property: property,
      ...(format ? { exo__PrintedProperty_format: format } : {}),
    },
  };
}

/** Spec: one part carrying the 4-deep date preference list, formatted. */
function fallbackSpecFixtures(): Fixture[] {
  return [
    {
      path: `${SPEC_UID}.md`,
      frontmatter: {
        exo__Asset_uid: SPEC_UID,
        exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_UID}]]`],
        exo__DisplayNameSpec_appliesToClass: `[[${ACTION_CLASS_UID}|ems__Action]]`,
        exo__DisplayNameSpec_priority: 400,
        exo__DisplayNameSpec_separator: " ",
      },
    },
    printedProperty("ffffffff-0000-4000-8000-000000000001", SPEC_UID, 1, [
      `[[${PROP_PROTOTYPE}]]`,
    ]),
    printedProperty(
      "ffffffff-0000-4000-8000-000000000002",
      SPEC_UID,
      2,
      [
        `[[${PROP_END}]]`,
        `[[${PROP_PLANNED_END}]]`,
        `[[${PROP_START}]]`,
        `[[${PROP_PLANNED_START}]]`,
      ],
      "YYYY-MM-DD HH:mm",
    ),
  ];
}

/** Control spec: the SAME shape with a single-value property (pre-list form). */
function singleSpecFixtures(): Fixture[] {
  return [
    {
      path: `${SINGLE_SPEC_UID}.md`,
      frontmatter: {
        exo__Asset_uid: SINGLE_SPEC_UID,
        exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_UID}]]`],
        exo__DisplayNameSpec_appliesToClass: `[[${ACTION_CLASS_UID}|ems__Action]]`,
        exo__DisplayNameSpec_priority: 400,
        exo__DisplayNameSpec_separator: " ",
      },
    },
    printedProperty(
      "ffffffff-0000-4000-8000-000000000011",
      SINGLE_SPEC_UID,
      1,
      [`[[${PROP_PROTOTYPE}]]`],
    ),
    printedProperty(
      "ffffffff-0000-4000-8000-000000000012",
      SINGLE_SPEC_UID,
      2,
      `[[${PROP_END}]]`,
      "YYYY-MM-DD HH:mm",
    ),
  ];
}

function resolverFor(files: Fixture[]): DisplayNameResolver {
  const app = createMockApp(files);
  const service = new PrintNameRuleService(app);
  service.initialize();
  return new DisplayNameResolver(
    DEFAULT_DISPLAY_NAME_SETTINGS,
    service,
    service.createMetadataResolver(),
  );
}

/** A prototype asset the part's first slot dereferences to its label. */
const PROTOTYPE_UID = "aaaa1111-0000-4000-8000-000000000001";
function prototypeAsset(): Fixture {
  return {
    path: `${PROTOTYPE_UID}.md`,
    frontmatter: {
      exo__Asset_uid: PROTOTYPE_UID,
      exo__Asset_label: "Выпить Пантокальцин после обеда",
    },
  };
}

function action(fm: Record<string, unknown>): Record<string, unknown> {
  return {
    exo__Instance_class: [`[[${ACTION_CLASS_UID}|ems__Action]]`],
    exo__Asset_prototype: `[[${PROTOTYPE_UID}]]`,
    ...fm,
  };
}

const PROTO_LABEL = "Выпить Пантокальцин после обеда";

describe("printName — exo__PrintedProperty_property as an ordered preference list", () => {
  it("prints the FIRST candidate when every candidate is present", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...fallbackSpecFixtures(),
    ]);
    const name = r.resolve({
      metadata: action({
        ems__Effort_endTimestamp: "2026-08-14T17:23:18",
        ems__Effort_plannedEndTimestamp: "2026-08-13T10:00:00",
        ems__Effort_startTimestamp: "2026-08-12T09:00:00",
        ems__Effort_plannedStartTimestamp: "2026-08-11T08:00:00",
      }),
      basename: "x",
    });
    // Only ONE date — the first — not a concatenation of all four.
    expect(name).toBe(`${PROTO_LABEL} 2026-08-14 17:23`);
  });

  it("falls through to the SECOND candidate when the first is absent", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...fallbackSpecFixtures(),
    ]);
    const name = r.resolve({
      metadata: action({
        ems__Effort_plannedEndTimestamp: "2026-08-13T10:00:00",
        ems__Effort_startTimestamp: "2026-08-12T09:00:00",
      }),
      basename: "x",
    });
    expect(name).toBe(`${PROTO_LABEL} 2026-08-13 10:00`);
  });

  it("falls through to the LAST candidate when only it is present", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...fallbackSpecFixtures(),
    ]);
    const name = r.resolve({
      metadata: action({
        ems__Effort_plannedStartTimestamp: "2026-08-11T08:00:00",
      }),
      basename: "x",
    });
    expect(name).toBe(`${PROTO_LABEL} 2026-08-11 08:00`);
  });

  it("drops the field WITH its separator when no candidate has a value", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...fallbackSpecFixtures(),
    ]);
    const name = r.resolve({ metadata: action({}), basename: "x" });
    // Same behaviour a single absent property already had — no dangling space.
    expect(name).toBe(PROTO_LABEL);
  });

  it("applies the part's format to whichever candidate won, not only to the first", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...fallbackSpecFixtures(),
    ]);
    const name = r.resolve({
      metadata: action({ ems__Effort_startTimestamp: "2026-08-12T09:07:00" }),
      basename: "x",
    });
    // The raw value is a full ISO string; the declared YYYY-MM-DD HH:mm applied.
    expect(name).toBe(`${PROTO_LABEL} 2026-08-12 09:07`);
    expect(name).not.toContain("T09:07");
  });

  it("a format containing the SEPARATOR itself survives (space-bearing format under a space separator)", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...singleSpecFixtures(),
    ]);
    const name = r.resolve({
      metadata: action({ ems__Effort_endTimestamp: "2026-08-14T17:23:18" }),
      basename: "x",
    });
    // Splitting the TEMPLATE naively on " " cut `{{key::YYYY-MM-DD HH:mm}}` in
    // half and leaked the raw placeholder into the name.
    expect(name).not.toContain("{{");
    expect(name).not.toContain("::");
    expect(name).toBe(`${PROTO_LABEL} 2026-08-14 17:23`);
  });

  it("no-regression control for the splitter: a format WITHOUT the separator is unaffected", () => {
    const spaceFreeSpec: Fixture[] = [
      {
        path: `${SINGLE_SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SINGLE_SPEC_UID,
          exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_UID}]]`],
          exo__DisplayNameSpec_appliesToClass: `[[${ACTION_CLASS_UID}|ems__Action]]`,
          exo__DisplayNameSpec_priority: 400,
          exo__DisplayNameSpec_separator: " ",
        },
      },
      printedProperty(
        "ffffffff-0000-4000-8000-000000000021",
        SINGLE_SPEC_UID,
        1,
        [`[[${PROP_PROTOTYPE}]]`],
      ),
      printedProperty(
        "ffffffff-0000-4000-8000-000000000022",
        SINGLE_SPEC_UID,
        2,
        `[[${PROP_END}]]`,
        "YYYY-MM-DD",
      ),
    ];
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...spaceFreeSpec,
    ]);
    expect(
      r.resolve({
        metadata: action({ ems__Effort_endTimestamp: "2026-08-14T17:23:18" }),
        basename: "x",
      }),
    ).toBe(`${PROTO_LABEL} 2026-08-14`);
  });

  it("no-regression control: a SINGLE-value property behaves exactly as before", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...singleSpecFixtures(),
    ]);
    expect(
      r.resolve({
        metadata: action({ ems__Effort_endTimestamp: "2026-08-14T17:23:18" }),
        basename: "x",
      }),
    ).toBe(`${PROTO_LABEL} 2026-08-14 17:23`);
    // …and still drops cleanly when that one property is absent — the single
    // candidate must NOT accidentally pick up a sibling timestamp.
    expect(
      r.resolve({
        metadata: action({ ems__Effort_startTimestamp: "2026-08-12T09:00:00" }),
        basename: "x",
      }),
    ).toBe(PROTO_LABEL);
  });
});

/**
 * The SECOND consumer of the key resolver: `exo__DisplayNameSpec_matchPath`.
 *
 * `resolvePropertyKey` is shared, and the preference-list semantics must NOT leak
 * into it: `matcherSatisfied` looks the resolved key up in the note's frontmatter,
 * so a joined `a|b` string is not a key, the lookup yields `undefined`, and the
 * conditional spec silently stops matching — a behaviour regression with NO error,
 * NO type change and no coverage from the list axes above (they never build a
 * conditional spec). Hence a dedicated axis, on its own class so exactly one spec
 * participates and the assertion has a single cause.
 */
describe("printName — matchPath keeps SINGLE-key semantics (list-resolution must not leak)", () => {
  const COND_CLASS_UID = "6a99d2ca-d402-4734-a10b-33f5f1a1aa43";
  const COND_SPEC_UID = "dddddddd-0000-4000-8000-000000000003";
  const PROP_STATUS = "eeeeeeee-0000-4000-8000-00000000000f";
  const STATUS_DOING = "cccccccc-0000-4000-8000-000000000001";

  function condFixtures(matchPath: string | string[]): Fixture[] {
    return [
      propertyDef(PROP_STATUS, "ems__Effort_status"),
      {
        path: `${STATUS_DOING}.md`,
        frontmatter: {
          exo__Asset_uid: STATUS_DOING,
          exo__Asset_label: "ems__EffortStatusDoing",
        },
      },
      {
        path: `${COND_SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: COND_SPEC_UID,
          exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_UID}]]`],
          exo__DisplayNameSpec_appliesToClass: `[[${COND_CLASS_UID}|ems__CondAction]]`,
          exo__DisplayNameSpec_priority: 400,
          exo__DisplayNameSpec_separator: " ",
          exo__DisplayNameSpec_matchPath: matchPath,
          exo__DisplayNameSpec_matchValue: `[[${STATUS_DOING}|ems__EffortStatusDoing]]`,
        },
      },
      printedProperty(
        "ffffffff-0000-4000-8000-000000000021",
        COND_SPEC_UID,
        1,
        [`[[${PROP_PROTOTYPE}]]`],
      ),
      printedProperty(
        "ffffffff-0000-4000-8000-000000000022",
        COND_SPEC_UID,
        2,
        `[[${PROP_END}]]`,
        "YYYY",
      ),
    ];
  }

  /** Doing-status note of the conditional class; falls back to its raw label if unmatched. */
  function condNote(): Record<string, unknown> {
    return {
      exo__Instance_class: [`[[${COND_CLASS_UID}|ems__CondAction]]`],
      exo__Asset_prototype: `[[${PROTOTYPE_UID}]]`,
      exo__Asset_label: "RAW LABEL",
      ems__Effort_status: `[[${STATUS_DOING}|ems__EffortStatusDoing]]`,
      ems__Effort_endTimestamp: "2026-08-14T17:23:18",
    };
  }

  it("a MULTI-VALUE matchPath still matches on its FIRST element (pre-list behaviour)", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...condFixtures([`[[${PROP_STATUS}]]`, `[[${PROP_END}]]`]),
    ]);
    // Giving matchPath the list semantics compiles matchKey to
    // "ems__Effort_status|ems__Effort_endTimestamp", which is not a frontmatter
    // key → matcher never fires → this renders "RAW LABEL" instead.
    expect(r.resolve({ metadata: condNote(), basename: "x" })).toBe(
      `${PROTO_LABEL} 2026`,
    );
  });

  it("control: a SINGLE-value matchPath matches, and a non-matching value does not", () => {
    const r = resolverFor([
      ...baseFixtures(),
      prototypeAsset(),
      ...condFixtures(`[[${PROP_STATUS}]]`),
    ]);
    expect(r.resolve({ metadata: condNote(), basename: "x" })).toBe(
      `${PROTO_LABEL} 2026`,
    );
    expect(
      r.resolve({
        metadata: {
          ...condNote(),
          ems__Effort_status: "[[something-else|ems__EffortStatusDone]]",
        },
        basename: "x",
      }),
    ).toBe("RAW LABEL");
  });
});

/**
 * printName: vault-declared separator + value format (issue #4012, onto-RFC 0ba349ed).
 *
 * Production-shape: the fixture vault carries the real CLASS-DEF and real PROPERTY-DEFs, and the
 * test drives the REAL PrintNameRuleService.scanVault() → DisplayNameResolver.resolve() pipeline.
 * Nothing is hand-injected: the templates under test are COMPILED from the fixture's
 * exo__DisplayNameSpec + exo__PrintedProperty/exo__PrintedLiteral assets, exactly as the plugin
 * compiles the live vault.
 */
import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "@plugin/domain/settings/ExocortexSettings";
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";

const EXO_CLASS_METACLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9";
const DISPLAY_NAME_SPEC_UID = "07eab746-0874-4676-9d98-dbaad1bc6fb8";
const PRINTED_PROPERTY_UID = "7d58de40-d941-4a66-88e2-13afc4fdc41d";
const PRINTED_LITERAL_UID = "4d5437c9-788e-4a6d-9be0-4af3a84554f4";
const DATATYPE_PROPERTY_UID = "ae56ca4c-b610-42a4-a25d-058c23673296";

const DISH_CLASS_UID = "cc78dcc2-e01f-4e9c-98eb-b734f41b1e63";
const SPEC_UID = "aaaaaaaa-0000-4000-8000-000000000001";
const PLAIN_SPEC_UID = "aaaaaaaa-0000-4000-8000-000000000002";
const PREFIX_SPEC_UID = "aaaaaaaa-0000-4000-8000-000000000003";

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

const PROP_RATING = "bbbbbbbb-0000-4000-8000-00000000000a";
const PROP_DISH = "bbbbbbbb-0000-4000-8000-00000000000b";
const PROP_PLACE = "bbbbbbbb-0000-4000-8000-00000000000c";
const PROP_TS = "bbbbbbbb-0000-4000-8000-00000000000d";
const PROP_LABEL = "bbbbbbbb-0000-4000-8000-00000000000e";

/** The shared production-shape base: class-def + property-defs. */
function baseFixtures(): Fixture[] {
  return [
    {
      // CLASS-DEF — without it the spec's appliesToClass would not resolve to the label form.
      path: `${DISH_CLASS_UID}.md`,
      frontmatter: {
        exo__Asset_uid: DISH_CLASS_UID,
        exo__Instance_class: [`[[${EXO_CLASS_METACLASS}]]`],
        exo__Asset_label: "meal__DishServing",
      },
    },
    propertyDef(PROP_RATING, "meal__DishServing_rating"),
    propertyDef(PROP_DISH, "meal__DishServing_dish"),
    propertyDef(PROP_PLACE, "meal__DishServing_place"),
    propertyDef(PROP_TS, "exo__Event_timestamp"),
    propertyDef(PROP_LABEL, "exo__Asset_label"),
  ];
}

function printedProperty(
  uid: string,
  specUid: string,
  order: number,
  propUid: string,
  format?: string,
): Fixture {
  return {
    path: `${uid}.md`,
    frontmatter: {
      exo__Asset_uid: uid,
      exo__Instance_class: [`[[${PRINTED_PROPERTY_UID}]]`],
      exo__DisplayNamePart_of: `[[${specUid}]]`,
      exo__DisplayNamePart_order: order,
      exo__PrintedProperty_property: `[[${propUid}]]`,
      ...(format ? { exo__PrintedProperty_format: format } : {}),
    },
  };
}

/** The separator-bearing serving spec: rating · dish · place · timestamp(DD.MM). */
function servingSpecFixtures(separator?: string): Fixture[] {
  return [
    {
      path: `${SPEC_UID}.md`,
      frontmatter: {
        exo__Asset_uid: SPEC_UID,
        exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_UID}]]`],
        exo__DisplayNameSpec_appliesToClass: `[[${DISH_CLASS_UID}|meal__DishServing]]`,
        exo__DisplayNameSpec_priority: 100,
        ...(separator === undefined ? {} : { exo__DisplayNameSpec_separator: separator }),
      },
    },
    printedProperty("cccccccc-0000-4000-8000-000000000001", SPEC_UID, 1, PROP_RATING),
    printedProperty("cccccccc-0000-4000-8000-000000000002", SPEC_UID, 2, PROP_DISH),
    printedProperty("cccccccc-0000-4000-8000-000000000003", SPEC_UID, 3, PROP_PLACE),
    printedProperty("cccccccc-0000-4000-8000-000000000004", SPEC_UID, 4, PROP_TS, "DD.MM"),
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

function serving(fm: Record<string, unknown>): Record<string, unknown> {
  return { exo__Instance_class: [`[[${DISH_CLASS_UID}|meal__DishServing]]`], ...fm };
}

const FULL = {
  meal__DishServing_rating: 6.5,
  meal__DishServing_dish: "Панкейки",
  meal__DishServing_place: "Teplo",
  exo__Event_timestamp: "2026-07-31T11:30:00",
};

describe("printName separator + value format [@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff]", () => {
  describe("AC-A — separator joins only NON-EMPTY parts", () => {
    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff renders every field when all are present", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      expect(r.resolve({ metadata: serving(FULL), basename: "x" })).toBe(
        "6.5 · Панкейки · Teplo · 31.07",
      );
    });

    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff drops the LEADING separator when the first field is empty", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      const { meal__DishServing_rating: _drop, ...noRating } = FULL;
      expect(r.resolve({ metadata: serving(noRating), basename: "x" })).toBe(
        "Панкейки · Teplo · 31.07",
      );
    });

    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff drops the TRAILING separator when the last field is empty", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      const { exo__Event_timestamp: _drop, ...noTs } = FULL;
      expect(r.resolve({ metadata: serving(noTs), basename: "x" })).toBe(
        "6.5 · Панкейки · Teplo",
      );
    });

    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff leaves exactly ONE separator when both ends are empty", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      const name = r.resolve({
        metadata: serving({
          meal__DishServing_dish: "Тирамису",
          meal__DishServing_place: "Teplo",
        }),
        basename: "x",
      });
      expect(name).toBe("Тирамису · Teplo");
    });

    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff collapses a MIDDLE empty field without doubling the separator", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      const name = r.resolve({
        metadata: serving({
          meal__DishServing_dish: "Омлет",
          exo__Event_timestamp: "2026-07-31T09:40:00",
        }),
        basename: "x",
      });
      expect(name).toBe("Омлет · 31.07");
      expect(name).not.toContain("·  ·");
    });

    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff never splits a VALUE that itself contains the separator", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      const name = r.resolve({
        metadata: serving({ ...FULL, meal__DishServing_dish: "Кофе · Латте" }),
        basename: "x",
      });
      expect(name).toBe("6.5 · Кофе · Латте · Teplo · 31.07");
    });
  });

  describe("AC-B — vault-declared value format", () => {
    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff formats an ISO string per the declared DD.MM", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      const name = r.resolve({
        metadata: serving({ ...FULL, exo__Event_timestamp: "2026-01-31T13:28:20" }),
        basename: "x",
      });
      expect(name).toBe("6.5 · Панкейки · Teplo · 31.01");
    });

    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff formats a Date to the SAME literal digits (no tz shift, no quotes, no .000Z)", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      const name = r.resolve({
        // A zone-less YAML timestamp parses to a Date read as UTC.
        metadata: serving({ ...FULL, exo__Event_timestamp: new Date("2026-01-31T13:28:20Z") }),
        basename: "x",
      });
      expect(name).toBe("6.5 · Панкейки · Teplo · 31.01");
      expect(name).not.toContain("Z");
      expect(name).not.toContain('"');
    });

    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff FAILS OPEN — a non-date value prints unchanged", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(" · ")]);
      const name = r.resolve({
        metadata: serving({ ...FULL, exo__Event_timestamp: "как-нибудь потом" }),
        basename: "x",
      });
      expect(name).toBe("6.5 · Панкейки · Teplo · как-нибудь потом");
    });

    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff never fabricates a component the value does not carry", () => {
      const files = [
        ...baseFixtures(),
        {
          path: `${SPEC_UID}.md`,
          frontmatter: {
            exo__Asset_uid: SPEC_UID,
            exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_UID}]]`],
            exo__DisplayNameSpec_appliesToClass: `[[${DISH_CLASS_UID}|meal__DishServing]]`,
            exo__DisplayNameSpec_priority: 100,
          },
        },
        // HH cannot be filled from a date-only value → print the value unchanged.
        printedProperty("cccccccc-0000-4000-8000-00000000000f", SPEC_UID, 1, PROP_TS, "DD.MM HH:mm"),
      ];
      const r = resolverFor(files);
      expect(
        r.resolve({ metadata: serving({ exo__Event_timestamp: "2026-01-31" }), basename: "x" }),
      ).toBe("2026-01-31");
    });
  });

  describe("AC-C — no separator declared ⇒ the v1 path, unchanged", () => {
    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff keeps the legacy join(\"\") behaviour when no separator is declared", () => {
      const r = resolverFor([...baseFixtures(), ...servingSpecFixtures(undefined)]);
      // Parts are concatenated with no separator, exactly as before this change.
      expect(r.resolve({ metadata: serving(FULL), basename: "x" })).toBe(
        "6.5ПанкейкиTeplo31.07",
      );
    });
  });

  describe("AC-D — composition keeps the core spec's separator", () => {
    it("@req:1a6525eb-0c6e-4063-980b-8c1bd7bef0ff composes a prefix spec over a separator-bearing core spec", () => {
      const files: Fixture[] = [
        ...baseFixtures(),
        ...servingSpecFixtures(" · "),
        // A higher-priority spec contributing ONLY a prefix marker.
        {
          path: `${PREFIX_SPEC_UID}.md`,
          frontmatter: {
            exo__Asset_uid: PREFIX_SPEC_UID,
            exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_UID}]]`],
            exo__DisplayNameSpec_appliesToClass: `[[${DISH_CLASS_UID}|meal__DishServing]]`,
            exo__DisplayNameSpec_priority: 200,
          },
        },
        {
          path: `${PLAIN_SPEC_UID}.md`,
          frontmatter: {
            exo__Asset_uid: PLAIN_SPEC_UID,
            exo__Instance_class: [`[[${PRINTED_LITERAL_UID}]]`],
            exo__DisplayNamePart_of: `[[${PREFIX_SPEC_UID}]]`,
            exo__DisplayNamePart_order: 1,
            exo__PrintedLiteral_literal: "🍽 ",
          },
        },
      ];
      const r = resolverFor(files);
      const name = r.resolve({
        metadata: serving({
          meal__DishServing_dish: "Тирамису",
          meal__DishServing_place: "Teplo",
        }),
        basename: "x",
      });
      // Prefix marker preserved AND the core's separator semantics still collapse the empties.
      expect(name).toBe("🍽 Тирамису · Teplo");
    });
  });
});

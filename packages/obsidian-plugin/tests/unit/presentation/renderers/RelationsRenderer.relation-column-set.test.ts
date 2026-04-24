/**
 * RelationsRenderer integration with RelationColumnSetResolver.
 *
 * RFC be70f741 Phase 3 — AC coverage for the resolver lookup inside
 * `buildGroupSpecificProperties` + feature-flag gate + legacy fallback.
 *
 * These tests target the pure method; the render path is already exercised
 * by the sibling `RelationsRenderer.test.ts` legacy suite.
 */

jest.mock("exocortex", () => ({
  MetadataHelpers: {
    findAllReferencingProperties: jest.fn().mockReturnValue([]),
    isAssetArchived: jest.fn().mockReturnValue(false),
    getPropertyValue: jest.fn(),
  },
}));

jest.mock("@plugin/presentation/utils/BlockerHelpers", () => ({
  BlockerHelpers: {
    isEffortBlocked: jest.fn().mockReturnValue(false),
  },
}));

import type {
  RelationColumnSet,
  RelationColumnSetResolver,
} from "exocortex";
import {
  LEGACY_HARDCODED_GROUP_SPECIFIC_PROPERTIES,
  RelationsRenderer,
} from "@plugin/presentation/renderers/layout/RelationsRenderer";
import type { AssetRelation } from "@plugin/presentation/renderers/layout/types";
import type { ExocortexSettings } from "@plugin/domain/settings/ExocortexSettings";

function makeRelation(
  propertyName: string | undefined,
  instanceClasses: readonly string[] | string | undefined,
): AssetRelation {
  return {
    file: { path: `row/${propertyName ?? "body"}.md`, basename: "row" } as AssetRelation["file"],
    path: `row/${propertyName ?? "body"}.md`,
    title: "row",
    metadata:
      instanceClasses === undefined
        ? {}
        : { exo__Instance_class: instanceClasses },
    propertyName,
    isBodyLink: !propertyName,
    isArchived: false,
    isBlocked: false,
    created: 0,
    modified: 0,
  };
}

function makeSettings(
  enableRelationColumnSetResolver: boolean,
): ExocortexSettings {
  return {
    enableRelationColumnSetResolver,
  } as unknown as ExocortexSettings;
}

function makeResolver(
  entries: ReadonlyMap<string, RelationColumnSet | null>,
): RelationColumnSetResolver {
  const calls: Array<{ rowClasses: readonly string[]; property: string | null | undefined }> = [];
  return {
    resolve: jest.fn(
      (
        rowClasses: readonly string[] | null | undefined,
        property: string | null | undefined,
      ) => {
        calls.push({
          rowClasses: rowClasses ? [...rowClasses] : [],
          property: property ?? null,
        });
        const key = `${rowClasses?.join("|") ?? ""}::${property ?? ""}`;
        return entries.get(key) ?? null;
      },
    ),
  } as unknown as RelationColumnSetResolver;
}

function configFor(
  uid: string,
  columns: readonly string[],
): RelationColumnSet {
  return {
    uid,
    label: uid,
    targetClasses: null,
    referencingProperty: null,
    columns,
    priority: 0,
    sourcePath: `inbox/${uid}.md`,
  };
}

function newRenderer(
  settings: ExocortexSettings,
  resolver: RelationColumnSetResolver | null = null,
): RelationsRenderer {
  const reactRenderer = { render: jest.fn(), cleanup: jest.fn() } as unknown as never;
  const backlinksCacheManager = {
    getBacklinks: jest.fn().mockReturnValue(null),
    invalidate: jest.fn(),
  } as unknown as never;
  const metadataService = {
    getAssetLabel: jest.fn().mockReturnValue(null),
  } as unknown as never;
  const plugin = { saveSettings: jest.fn() } as unknown as never;
  const vaultAdapter = {} as unknown as never;
  const app = {} as unknown as never;
  const refresh = jest.fn().mockResolvedValue(undefined);
  return new RelationsRenderer(
    app,
    settings,
    reactRenderer,
    backlinksCacheManager,
    metadataService,
    plugin,
    refresh,
    vaultAdapter,
    resolver,
  );
}

describe("RelationsRenderer.buildGroupSpecificProperties (RFC be70f741 Phase 3)", () => {
  describe("legacy fallback path", () => {
    it("returns the hardcoded map when feature-flag is disabled", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(false), resolver);
      const relations = [makeRelation("ems__Effort_parent", ["ems__Task"])];

      const out = renderer.buildGroupSpecificProperties(relations);

      expect(out).toEqual({
        ems__Effort_parent: ["ems__Effort_status"],
        ems__Effort_area: ["ems__Effort_status"],
      });
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it("returns the hardcoded map when resolver is absent", () => {
      const renderer = newRenderer(makeSettings(true), null);
      const relations = [makeRelation("ems__Effort_parent", ["ems__Task"])];

      const out = renderer.buildGroupSpecificProperties(relations);

      expect(out).toEqual({
        ems__Effort_parent: ["ems__Effort_status"],
        ems__Effort_area: ["ems__Effort_status"],
      });
    });

    it("returns a fresh object on every call (not the LEGACY constant)", () => {
      const renderer = newRenderer(makeSettings(false), null);
      const out = renderer.buildGroupSpecificProperties([]);

      expect(out).not.toBe(LEGACY_HARDCODED_GROUP_SPECIFIC_PROPERTIES);
      expect(() => {
        out.ems__Effort_parent.push("mutated");
      }).not.toThrow();
    });
  });

  describe("resolver-backed path", () => {
    it("uses resolver columns for a matched propertyName (MVG)", () => {
      const matched = configFor("cfg-week", ["exo__Asset_createdAt", "exo__Asset_label"]);
      const resolver = makeResolver(
        new Map([
          [
            "[[ems__WeeklyObjective]]::ems__WeeklyObjective__week",
            matched,
          ],
        ]),
      );
      const renderer = newRenderer(makeSettings(true), resolver);
      const relations = [
        makeRelation("ems__WeeklyObjective__week", ["[[ems__WeeklyObjective]]"]),
      ];

      const out = renderer.buildGroupSpecificProperties(relations);

      expect(out.ems__WeeklyObjective__week).toEqual([
        "exo__Asset_createdAt",
        "exo__Asset_label",
      ]);
      // Legacy keys preserved for snapshot stability when resolver did not replace them
      expect(out.ems__Effort_parent).toEqual(["ems__Effort_status"]);
      expect(out.ems__Effort_area).toEqual(["ems__Effort_status"]);
      expect(resolver.resolve).toHaveBeenCalledTimes(1);
    });

    it("falls back to legacy hardcoded when resolver returns null for a known key", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(true), resolver);
      const relations = [
        makeRelation("ems__Effort_parent", ["ems__Task"]),
      ];

      const out = renderer.buildGroupSpecificProperties(relations);

      expect(out.ems__Effort_parent).toEqual(["ems__Effort_status"]);
      expect(out.ems__Effort_area).toEqual(["ems__Effort_status"]);
    });

    it("resolver-hit takes precedence over legacy hardcoded for same key", () => {
      const override = configFor("cfg-override", ["custom__Column"]);
      const resolver = makeResolver(
        new Map([["ems__Task::ems__Effort_parent", override]]),
      );
      const renderer = newRenderer(makeSettings(true), resolver);
      const relations = [makeRelation("ems__Effort_parent", ["ems__Task"])];

      const out = renderer.buildGroupSpecificProperties(relations);

      expect(out.ems__Effort_parent).toEqual(["custom__Column"]);
      expect(out.ems__Effort_area).toEqual(["ems__Effort_status"]);
    });

    it("returns empty map when zero relations and legacy preserved", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(true), resolver);

      const out = renderer.buildGroupSpecificProperties([]);

      expect(out).toEqual({
        ems__Effort_parent: ["ems__Effort_status"],
        ems__Effort_area: ["ems__Effort_status"],
      });
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it("dedupes propertyName across multiple relations", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(true), resolver);
      const relations = [
        makeRelation("ems__Effort_parent", ["ems__Task"]),
        makeRelation("ems__Effort_parent", ["ems__Task"]),
        makeRelation("ems__Effort_parent", ["ems__Task"]),
      ];

      renderer.buildGroupSpecificProperties(relations);

      expect(resolver.resolve).toHaveBeenCalledTimes(1);
    });

    it("skips body-link relations (propertyName undefined)", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(true), resolver);
      const relations = [makeRelation(undefined, ["ems__Task"])];

      const out = renderer.buildGroupSpecificProperties(relations);

      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(out).toEqual({
        ems__Effort_parent: ["ems__Effort_status"],
        ems__Effort_area: ["ems__Effort_status"],
      });
    });

    it("passes multi-class array to resolver in declaration order", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(true), resolver);
      const relations = [
        makeRelation("period__Week_belongsTo", [
          "[[ems__WeeklyObjective]]",
          "[[ems__Effort]]",
        ]),
      ];

      renderer.buildGroupSpecificProperties(relations);

      expect(resolver.resolve).toHaveBeenCalledWith(
        ["[[ems__WeeklyObjective]]", "[[ems__Effort]]"],
        "period__Week_belongsTo",
      );
    });

    it("accepts exo__Instance_class as a bare string", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(true), resolver);
      const relations = [makeRelation("prop__X", "ems__Task")];

      renderer.buildGroupSpecificProperties(relations);

      expect(resolver.resolve).toHaveBeenCalledWith(["ems__Task"], "prop__X");
    });

    it("filters non-string entries out of exo__Instance_class", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(true), resolver);
      const rel = makeRelation("prop__X", undefined);
      // Inject a mixed array to simulate malformed frontmatter.
      (rel.metadata as Record<string, unknown>).exo__Instance_class = [
        "ems__Task",
        42,
        null,
        "ems__Project",
      ];

      renderer.buildGroupSpecificProperties([rel]);

      expect(resolver.resolve).toHaveBeenCalledWith(
        ["ems__Task", "ems__Project"],
        "prop__X",
      );
    });

    it("treats missing metadata exo__Instance_class as empty array (graceful degradation)", () => {
      const resolver = makeResolver(new Map());
      const renderer = newRenderer(makeSettings(true), resolver);
      const relations = [makeRelation("prop__X", undefined)];

      const out = renderer.buildGroupSpecificProperties(relations);

      expect(resolver.resolve).toHaveBeenCalledWith([], "prop__X");
      // Unknown property, resolver miss, no legacy entry → not added to map
      expect(out.prop__X).toBeUndefined();
      // Legacy map still survives for snapshot stability
      expect(out.ems__Effort_parent).toEqual(["ems__Effort_status"]);
    });
  });
});

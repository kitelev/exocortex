/**
 * Happy-path fixture for RelationColumnSet Phase 3 component tests.
 *
 * Shape: one `period__Week` row-asset referenced by three
 * `ems__WeeklyObjective` assets via `ems__WeeklyObjective__week`.  One
 * `ui__RelationColumnSet` config scopes the columns to
 * `[exo__Asset_createdAt, exo__Asset_label]` — the MVG case in RFC v2.
 */

import type { RelationColumnSet } from "exocortex";
import type { AssetRelation } from "../../../../src/presentation/components/AssetRelationsTable";

const WEEK_CREATED = new Date("2026-03-01T00:00:00Z").getTime();

export const happyPathRelations: AssetRelation[] = [
  {
    path: "Objectives/wo-1.md",
    title: "Ship RFC be70f741 Phase 3",
    propertyName: "ems__WeeklyObjective__week",
    isBodyLink: false,
    created: WEEK_CREATED + 10 * 60_000,
    modified: WEEK_CREATED + 60 * 60_000,
    metadata: {
      exo__Instance_class: ["[[ems__WeeklyObjective]]"],
      exo__Asset_label: "Ship RFC be70f741 Phase 3",
      exo__Asset_createdAt: "2026-03-01T00:10:00+0500",
    },
  },
  {
    path: "Objectives/wo-2.md",
    title: "Close CI Speedup Phase 4",
    propertyName: "ems__WeeklyObjective__week",
    isBodyLink: false,
    created: WEEK_CREATED + 20 * 60_000,
    modified: WEEK_CREATED + 30 * 60_000,
    metadata: {
      exo__Instance_class: ["[[ems__WeeklyObjective]]"],
      exo__Asset_label: "Close CI Speedup Phase 4",
      exo__Asset_createdAt: "2026-03-01T00:20:00+0500",
    },
  },
  {
    path: "Objectives/wo-3.md",
    title: "Vault audit backlog",
    propertyName: "ems__WeeklyObjective__week",
    isBodyLink: false,
    created: WEEK_CREATED + 40 * 60_000,
    modified: WEEK_CREATED + 50 * 60_000,
    metadata: {
      exo__Instance_class: ["[[ems__WeeklyObjective]]"],
      exo__Asset_label: "Vault audit backlog",
      exo__Asset_createdAt: "2026-03-01T00:40:00+0500",
    },
  },
];

export const happyPathConfig: RelationColumnSet = {
  uid: "fixture-week-objectives",
  label: "Weekly Objectives columns",
  targetClasses: ["ems__WeeklyObjective"],
  referencingProperty: "ems__WeeklyObjective__week",
  columns: ["exo__Asset_createdAt", "exo__Asset_label"],
  priority: 10,
  sourcePath: "_fixtures/relation-column-set/week-objectives.md",
};

export const happyPathConfigs: readonly RelationColumnSet[] = [happyPathConfig];

export const happyPathGroupSpecificProperties: Record<string, string[]> = {
  ems__WeeklyObjective__week: ["exo__Asset_createdAt", "exo__Asset_label"],
};

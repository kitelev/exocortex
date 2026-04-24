/**
 * No-config fixture — vault без `ui__RelationColumnSet` ассетов.
 *
 * Resolver returns null for every query; renderer falls back to the legacy
 * hardcoded map.  Test uses this to assert that the absence of configs
 * produces the historical pre-Phase-3 behaviour.
 */

import type { RelationColumnSet } from "exocortex";
import type { AssetRelation } from "../../../../src/presentation/components/AssetRelationsTable";

export const noConfigRelations: AssetRelation[] = [
  {
    path: "Tasks/task-parent.md",
    title: "Parent task",
    propertyName: "ems__Effort_parent",
    isBodyLink: false,
    created: 0,
    modified: 0,
    metadata: {
      exo__Instance_class: ["[[ems__Task]]"],
      exo__Asset_label: "Parent task",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
    },
  },
];

export const noConfigConfigs: readonly RelationColumnSet[] = [];

export const noConfigExpectedLegacyColumns: readonly string[] = [
  "ems__Effort_status",
];

/**
 * Collision fixture — 2 `ui__RelationColumnSet` assets share the same
 * (tier, priority) bucket.  RFC v2 tiebreaker is `priority DESC → uid ASC`
 * — the asset with the alphabetically-lower `exo__Asset_uid` wins.
 *
 * The resolver emits `log.warn` on every tied collision (debugging aid,
 * R2 mitigation).  Test asserts deterministic winner + warning.
 */

import type { RelationColumnSet } from "exocortex";
import type { AssetRelation } from "../../../../src/presentation/components/AssetRelationsTable";

export const collisionRelations: AssetRelation[] = [
  {
    path: "Tasks/task-collision.md",
    title: "Task with collision",
    propertyName: "ems__Effort_parent",
    isBodyLink: false,
    created: 0,
    modified: 0,
    metadata: {
      exo__Instance_class: ["[[ems__Task]]"],
      exo__Asset_label: "Task with collision",
    },
  },
];

export const collisionWinner: RelationColumnSet = {
  uid: "aaaaaaaa-0000-0000-0000-000000000000",
  label: "Collision — lower uid",
  targetClasses: ["ems__Task"],
  referencingProperty: "ems__Effort_parent",
  columns: ["colA__chosen"],
  priority: 5,
  sourcePath: "_fixtures/relation-column-set/collision-a.md",
};

export const collisionLoser: RelationColumnSet = {
  uid: "bbbbbbbb-0000-0000-0000-000000000000",
  label: "Collision — higher uid",
  targetClasses: ["ems__Task"],
  referencingProperty: "ems__Effort_parent",
  columns: ["colB__losing"],
  priority: 5,
  sourcePath: "_fixtures/relation-column-set/collision-b.md",
};

export const collisionConfigs: readonly RelationColumnSet[] = [
  collisionLoser,
  collisionWinner,
];

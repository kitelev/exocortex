import type { MetadataRecord } from '@plugin/types';

export interface AssetRelationFile {
  path: string;
  basename: string;
}

export interface AssetRelation {
  file: AssetRelationFile;
  path: string;
  title: string;
  metadata: MetadataRecord;
  propertyName?: string;
  isBodyLink: boolean;
  isArchived?: boolean;
  isBlocked?: boolean;
  created: number;
  modified: number;
  /**
   * RFC `93a0b2ee` Task 1.3 — where this relation was sourced from:
   *  - `inline`  — a frontmatter / backlink reference (the legacy path);
   *  - `reified` — backed by an `exo__Statement` instance.
   * Absent on relations produced before Task 1.3 wired the unified list
   * (treated as `inline` by consumers). A later phase renders the factual
   * "reified · &lt;AS&gt;" marker from this + {@link statementPath}.
   */
  provenance?: "inline" | "reified";
  /**
   * req `3f65eb4a` — the related asset's HOMOICONIC display name, resolved by
   * {@link RelationsRenderer.getAssetRelations} through the vault
   * `exo__DisplayNameSpec` system (the SAME `DisplayNameResolver` stack as native
   * Obsidian links + the DailyNote tasks table, sibling of req a577316f). Carries
   * the status/class prefix (`🔄 ` while Doing, …) from vault data, so the layout
   * relation/children/query table cell shows it consistently with those surfaces.
   * `undefined` when the resolver is unavailable (no `printNameRuleService`, e.g. a
   * unit-test mock) or yields nothing → the table falls back to the plain
   * `exo__Asset_label` / {@link title} (byte-identical to pre-3f65eb4a, no regression).
   */
  displayName?: string;
  /**
   * RFC `93a0b2ee` Task 1.3 — vault-relative path of the backing
   * `exo__Statement` asset for a `reified` relation (provenance). `undefined`
   * for inline relations or when the statement IRI is not a vault-asset IRI.
   */
  statementPath?: string;
  /**
   * RFC `93a0b2ee` Task 2 (C2) — the AssetSpace segment (`exoas-<name>`) the
   * backing `exo__Statement` asset lives in, parsed from {@link statementPath}
   * by the Task 1.1 helper. Drives the factual "reified · &lt;AS&gt;" marker.
   * `undefined` for inline relations or when the statement path has no
   * `exoas-*` segment (the marker then shows a bare "reified").
   */
  assetSpace?: string;
}

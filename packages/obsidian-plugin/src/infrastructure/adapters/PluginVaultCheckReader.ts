/**
 * Plugin-side vault-validation wiring (RFC f402002b, M1.5 — Desktop↔Mobile
 * parity). The plugin reads the warm `metadataCache` (NEVER re-reading +
 * re-parsing each file — the "iPhone reindex 10 minutes" anti-pattern). Both
 * desktop AND mobile use exactly this path; there is no `Platform.isMobile`
 * gate.
 *
 * SHACL/DAG runner thunks are deferred to M2 (the same unification the CLI
 * defers — `CliFsCheckReader` provides neither), so the portable checks
 * (uid-uniqueness, co-location) run on mobile from the warm asset array, and
 * enabling SHACL/DAG is reported FAIL-LOUD (never a silent skip). The optional
 * `shaclRunner` constructor seam is where M2 wires the warm-store SHACL runner.
 *
 * The units here are pure over structural slices (no `obsidian` runtime import)
 * so they are unit-testable; `ExocortexPlugin` injects the concrete Obsidian
 * `vault`/`metadataCache` slices at onload.
 */
import {
  readUid,
  readIsDefinedByRef,
  type CheckContext,
  type IVaultCheckReader,
  type ShaclViolationLike,
  type VaultAssetRecord,
} from "@kitelev/exocortex-core";

/**
 * Structural slice of the Obsidian vault + metadataCache the reader needs.
 * `listMarkdownPaths` ← `vault.getMarkdownFiles().map(f => f.path)`;
 * `frontmatterOf` ← `metadataCache.getFileCache(file)?.frontmatter` (warm).
 */
export interface WarmVaultSource {
  listMarkdownPaths(): readonly string[];
  frontmatterOf(path: string): Readonly<Record<string, unknown>> | undefined;
}

/**
 * Plugin warm-cache check-reader (RFC f402002b, M1.5). One `read()` builds the
 * asset array from the warm metadataCache; the portable checks (uid-uniqueness,
 * co-location) run from it with no platform machinery — that IS the
 * "validate on iPhone" value.
 *
 * SHACL + DAG runner thunks are deferred to M2 (the same unification the CLI
 * defers — `CliFsCheckReader` provides neither), so enabling either is reported
 * FAIL-LOUD, never a silent skip. The optional `shaclRunner` constructor arg is
 * the seam where M2 wires the warm-store SHACL runner (the warm triple store
 * holds DOMAIN triples, so that wiring needs the same domain→algebra conversion
 * the CLI's `runShapesValidation` performs — promoted to a shared home in M2).
 */
export class PluginVaultCheckReader implements IVaultCheckReader {
  constructor(
    private readonly source: WarmVaultSource,
    private readonly shaclRunner?: () => Promise<readonly ShaclViolationLike[]>,
  ) {}

  async read(): Promise<CheckContext> {
    const assets: VaultAssetRecord[] = [];
    for (const path of this.source.listMarkdownPaths()) {
      const frontmatter = this.source.frontmatterOf(path);
      if (frontmatter === undefined) continue; // no cache entry yet → skip (warm-only)
      assets.push({ path, frontmatter });
    }
    return { assets, runShacl: this.shaclRunner };
  }
}

/** A scaffold target: an ontology (co-location anchor) + the folder its assets live in. */
export interface OntologyChoice {
  readonly uid: string;
  readonly label: string;
  readonly folder: string;
}

/**
 * List candidate ontologies for `Scaffold validation settings`: assets that
 * anchor a co-location group — i.e. are the `exo__Asset_isDefinedBy` target of
 * at least one asset present in the vault. Each resolves to its own
 * `{uid, label, folder}` so the scaffold writes the 4 check-Settings co-located
 * in that ontology's folder (the co-location invariant). Pure over the warm
 * asset array.
 */
export function listOntologyCandidates(
  assets: readonly VaultAssetRecord[],
): OntologyChoice[] {
  const byUid = new Map<string, { label: string; folder: string }>();
  for (const a of assets) {
    const uid = readUid(a.frontmatter);
    if (uid === null) continue;
    const label =
      typeof a.frontmatter["exo__Asset_label"] === "string"
        ? (a.frontmatter["exo__Asset_label"] as string)
        : uid;
    const slash = a.path.lastIndexOf("/");
    const folder = slash >= 0 ? a.path.slice(0, slash) : "";
    byUid.set(uid, { label, folder });
  }

  const anchorUids = new Set<string>();
  for (const a of assets) {
    const ref = readIsDefinedByRef(a.frontmatter);
    if (ref !== null) anchorUids.add(ref);
  }

  const out: OntologyChoice[] = [];
  for (const uid of anchorUids) {
    const meta = byUid.get(uid);
    if (meta === undefined) continue; // unresolvable / cross-vault anchor → not a local scaffold target
    out.push({ uid, label: meta.label, folder: meta.folder });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

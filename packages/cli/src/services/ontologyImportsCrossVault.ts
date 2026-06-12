import { extractAssetReference } from "exocortex";
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import { findReferencedFile } from "../executors/folderRepairHelpers.js";
import { isNodeModulesPath, isTemplatesPath } from "../utils/vaultPathFilters.js";
import { resolveTargetPath } from "./ontologyImportsResolve.js";
import type { OntologyRef } from "../commands/audit-ontology-imports.js";

/**
 * A link target classified as cross-vault: it does NOT resolve in the primary
 * vault but DOES resolve in one of the `--also` secondary vaults.
 */
export interface CrossVaultHit {
  /** The secondary vault root where the target was found. */
  vaultPath: string;
  /** Vault-relative path of the target asset in the secondary vault. */
  targetPath: string;
  /**
   * The target asset's ontology in the secondary vault (`exo__Asset_isDefinedBy`
   * resolved there), or null when the target asset itself has no resolvable
   * ontology in that vault.
   */
  ontology: OntologyRef | null;
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string");
    return (first as string) ?? null;
  }
  return typeof value === "string" ? value : null;
}

function refList(value: unknown): string[] {
  const raw =
    Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const refs: string[] = [];
  for (const item of raw) {
    const ref = extractAssetReference(item);
    if (ref) refs.push(ref);
  }
  return refs;
}

/**
 * RFC df39007b VL#13 — cross-vault link classifier for the `--also` flag.
 *
 * `--also <path>` adds one or more secondary vaults that are consulted ONLY to
 * tell a cross-vault reference (the target asset lives in another vault) apart
 * from a genuinely broken link. It NEVER legitimizes the cross-vault link: such
 * a link stays a violation (per-vault model is kept clean — an ontology cannot
 * import an ontology from another vault). The flag only routes the occurrence
 * from the fail-open `broken` skip bucket into the dedicated `cross-vault`
 * violation category, so the data-cleanup work (Phase 4) is visible.
 *
 * A target that resolves in BOTH the primary and a secondary vault is never
 * cross-vault — the primary scan resolves it normally and it never reaches
 * this classifier (only primary-broken targets are passed here).
 */
export class CrossVaultClassifier {
  private readonly vaults: Array<{
    vaultPath: string;
    adapter: CachingNodeFsAdapter;
    ontologyByPath: Map<string, string>;
    ontologyMeta: Map<string, OntologyRef>;
    metaByPath: Map<string, Record<string, unknown>>;
  }> = [];

  constructor(
    private readonly alsoPaths: string[],
    private readonly ontologyClassUid: string,
  ) {}

  /** Build the secondary-vault indexes once (one disk pass per `--also` path). */
  async build(): Promise<void> {
    for (const vaultPath of this.alsoPaths) {
      // Frontmatter is enough — secondary vaults are consulted for target
      // resolution + ontology lookup, never for their own body-link graph.
      const adapter = new CachingNodeFsAdapter(vaultPath, {
        cacheContent: false,
      });
      const assets = await adapter.indexedAssets();
      const ontologyByPath = new Map<string, string>();
      const ontologyMeta = new Map<string, OntologyRef>();
      const metaByPath = new Map<string, Record<string, unknown>>();
      for (const asset of assets) {
        metaByPath.set(asset.path, asset.metadata);
        if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) {
          continue;
        }
        const classRefs = refList(asset.metadata["exo__Instance_class"]);
        if (!classRefs.includes(this.ontologyClassUid)) continue;
        const uid = firstString(asset.metadata["exo__Asset_uid"]);
        if (!uid) continue;
        const label = firstString(asset.metadata["exo__Asset_label"]) ?? asset.path;
        ontologyByPath.set(asset.path, uid);
        if (!ontologyMeta.has(uid)) {
          ontologyMeta.set(uid, { uid, label, path: asset.path });
        }
      }
      this.vaults.push({
        vaultPath,
        adapter,
        ontologyByPath,
        ontologyMeta,
        metaByPath,
      });
    }
  }

  /**
   * Returns the first secondary vault in which `target` resolves (with the
   * target's ontology there, when resolvable), or null when the target is not
   * found in any `--also` vault (→ the link is genuinely broken).
   */
  async classify(target: string): Promise<CrossVaultHit | null> {
    for (const vault of this.vaults) {
      const path = await resolveTargetPath(vault.adapter, target);
      if (!path || path === "ambiguous") continue;

      // The target itself may BE an ontology; otherwise resolve its
      // exo__Asset_isDefinedBy within this secondary vault.
      let ontology: OntologyRef | null = null;
      const directUid = vault.ontologyByPath.get(path);
      if (directUid) {
        ontology = vault.ontologyMeta.get(directUid) ?? null;
      } else {
        const meta = vault.metaByPath.get(path);
        const ref = extractAssetReference(
          firstString(meta?.["exo__Asset_isDefinedBy"]),
        );
        if (ref && !ref.startsWith("!")) {
          const ontPath = await findReferencedFile(vault.adapter, ref, path);
          const uid = ontPath ? vault.ontologyByPath.get(ontPath) : undefined;
          if (uid) ontology = vault.ontologyMeta.get(uid) ?? null;
        }
      }
      return { vaultPath: vault.vaultPath, targetPath: path, ontology };
    }
    return null;
  }
}

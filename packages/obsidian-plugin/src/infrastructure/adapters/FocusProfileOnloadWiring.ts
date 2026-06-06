import type { App, TFile } from "obsidian";
import { derivePath, type ILogger } from "exocortex";

import { isAssetSpaceFrontmatter } from "./AssetSpaceFrontmatter";
import type { FocusProfileSwitchManager } from "./FocusProfileSwitchManager";

/**
 * Issue #3324 — wire the persisted `activeProfileUid` into the
 * `VaultRDFIndexer` filter at plugin onload, before the first `convertVault`
 * pass runs. Sibling to {@link FocusProfileSwitchManager} (B.4) which handles
 * runtime switches; this module handles cold-start application of the
 * previously-saved selection.
 *
 * ## Filter semantics — Ontology UID vs AssetSpace UID
 *
 * `VaultRDFIndexer.setEffectiveOntologies(set)` operates on **AssetSpace UIDs**
 * (per `shouldSkipFileForEffectiveSet` in `NoteToRDFConverter`): a file under
 * `assetspaces/<folder>/` is included iff the folder maps to an AS UID in the
 * effective set. User-authored `exo__FocusProfile` ABox assets, however,
 * declare wikilinks to **Ontology UIDs** (`_alwaysOnOverlay`, `_includes`) —
 * Ontology is the homoiconic semantic primitive, AssetSpace is its container.
 *
 * The wiring bridges the two via the `exo__AssetSpace_containsOntology`
 * predicate: each AS asset declares the Ontology UIDs it owns. We build a
 * reverse `Ontology → AS` map at onload and translate the profile's effective
 * set through it. UIDs in the profile that are already AS UIDs (declared
 * directly, future-proof shape) pass through unchanged.
 *
 * ## Safe-degrade contract (R15 mitigation)
 *
 * Production vault data may have incomplete `containsOntology` declarations
 * (e.g. shared-identities AS deliberately omits it — мульти-anchor pattern).
 * When the translated set has zero overlap with the live folder map, engaging
 * the filter would skip every `assetspaces/<folder>/` file and brick the
 * plugin. To prevent that, the helper degrades to no-filter and logs a WARN
 * — same shape as the converter's R15 fallback, surfaced one layer earlier so
 * the indexer never sees the broken set.
 *
 * The TS-floor (Vision Lock #17) is always added at AS UID level so that
 * `$exo`, `$exocmd`, and `$shared-identities` survive any profile config —
 * users cannot accidentally exclude the plugin's own TBox foundations.
 */

/** AssetSpace UID of `$exo` (per `assetspaces/exo/49fd2e56-...md`). */
export const TS_FLOOR_AS_UID_EXO = "49fd2e56-4656-4ca7-a789-f472b16ea260";
/** AssetSpace UID of `$exocmd` (per `assetspaces/exocmd/c9c65b0f-...md`). */
export const TS_FLOOR_AS_UID_EXOCMD = "c9c65b0f-1e01-47c1-a1f9-1bf70b11df6a";
/**
 * AssetSpace UID of `$shared-identities` (per
 * `assetspaces/shared-identities/0cde1557-...md`). Container for cross-cutting
 * Ontology anchors (`$shared-identities`, `$kitelev`, ...) — its TBox must
 * remain reachable to keep the UID-canon resolver functioning.
 */
export const TS_FLOOR_AS_UID_SHARED_IDENTITIES =
  "0cde1557-6320-4bd0-a7c4-8b72afc38720";

/** TS-floor AssetSpace UIDs (Vision Lock #17, AS-UID level). */
export const TS_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> = new Set([
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
]);

/**
 * Shape of the indexer surface this helper writes into. Narrowed to the
 * three methods we touch so unit tests can substitute a stub without
 * dragging the full `VaultRDFIndexer` lifecycle.
 */
export interface IEffectiveOntologyAwareIndexer {
  setEffectiveOntologies(set: ReadonlySet<string> | null): void;
  setAssetSpaceFolderToUid(map: ReadonlyMap<string, string> | null): void;
}

export interface ApplyActiveProfileFilterOptions {
  app: App;
  switchMgr: FocusProfileSwitchManager;
  indexer: IEffectiveOntologyAwareIndexer;
  activeProfileUid: string | null;
  logger: ILogger;
}

export interface ApplyActiveProfileFilterResult {
  /**
   * `"engaged"` — filter wired; cold-start walk will honour the effective set.
   * `"no-profile"` — `activeProfileUid` is null; no filter wired (full vault).
   * `"degraded"` — translation produced zero overlap with folder map; filter
   *   skipped to prevent self-brick; cold-start indexes full vault.
   * `"error"` — resolution / scan threw; filter skipped; full vault.
   */
  outcome: "engaged" | "no-profile" | "degraded" | "error";
  /** Effective AS-UID set that was wired (or `null` when no engagement). */
  effective: ReadonlySet<string> | null;
  /** Folder→AS-UID map that was wired (or `null` when no engagement). */
  folderMap: ReadonlyMap<string, string> | null;
}

/**
 * Apply the persisted `activeProfileUid` to the indexer's filter setters.
 * Idempotent — caller may invoke at onload AND at every metadata-resolved
 * re-scan; the helper recomputes from current vault state each time.
 *
 * Never throws — failures degrade to `outcome: "error"` with full-vault
 * fallback. Caller's onload chain remains unblocked.
 */
export async function applyActiveProfileFilter(
  options: ApplyActiveProfileFilterOptions,
): Promise<ApplyActiveProfileFilterResult> {
  const { app, switchMgr, indexer, activeProfileUid, logger } = options;

  if (activeProfileUid === null) {
    // Explicit null wipes prior state so a previous engagement does not
    // bleed into the next onload after the user clears the profile.
    indexer.setEffectiveOntologies(null);
    indexer.setAssetSpaceFolderToUid(null);
    return { outcome: "no-profile", effective: null, folderMap: null };
  }

  let declaredSet: Set<string>;
  try {
    declaredSet = await switchMgr.resolveEffectiveSet(activeProfileUid);
  } catch (e) {
    logger.warn(
      `[FocusProfileOnloadWiring] resolveEffectiveSet(${activeProfileUid}) threw — falling back to no-filter. ${String(e)}`,
    );
    indexer.setEffectiveOntologies(null);
    indexer.setAssetSpaceFolderToUid(null);
    return { outcome: "error", effective: null, folderMap: null };
  }

  let folderMap: Map<string, string>;
  let ontologyToAs: Map<string, string>;
  try {
    const scan = scanAssetSpaces(app);
    folderMap = scan.folderMap;
    ontologyToAs = scan.ontologyToAs;
  } catch (e) {
    logger.warn(
      `[FocusProfileOnloadWiring] AssetSpace vault scan threw — falling back to no-filter. ${String(e)}`,
    );
    indexer.setEffectiveOntologies(null);
    indexer.setAssetSpaceFolderToUid(null);
    return { outcome: "error", effective: null, folderMap: null };
  }

  // Translate Ontology UIDs → AS UIDs. Pass-through entries that are already
  // AS UIDs (folder map values), so a future migration to declaring AS UIDs
  // directly in profiles works without changing this helper.
  const folderMapValues = new Set(folderMap.values());
  const effectiveAsUids = new Set<string>();
  // Track UIDs that fell through translation so the engagement log can
  // surface them — without this breadcrumb a user investigating «why does
  // my filter look weak» has no diagnostic. Distinct from the zero-overlap
  // R15 degradation below (which trips when NO entry translates); this
  // catches the partial case (some entries translate, others don't).
  const untranslated: string[] = [];
  for (const uid of declaredSet) {
    if (folderMapValues.has(uid)) {
      // Already an AS UID — accept directly.
      effectiveAsUids.add(uid);
      continue;
    }
    const translated = ontologyToAs.get(uid);
    if (translated !== undefined) {
      effectiveAsUids.add(translated);
      continue;
    }
    // Unmapped UID — Ontology with no declaring AssetSpace (e.g.
    // shared-identities anchors per мульти-anchor pattern). Surface in
    // engagement log so the user can trace which references silently dropped.
    untranslated.push(uid);
  }

  // Always lay in the TS-floor at AS-UID level (Vision Lock #17).
  for (const floorUid of TS_FLOOR_ASSETSPACE_UIDS) {
    effectiveAsUids.add(floorUid);
  }

  // Safety: if the effective set has zero overlap with known folders, the
  // filter would skip every `assetspaces/` file. Degrade to no-filter so the
  // plugin remains usable — the user's intent ("show only profile-X scope")
  // cannot be honoured with the current vault data, and silently bricking
  // is worse than indexing everything with a warn-log breadcrumb.
  const hasFolderMatch = Array.from(effectiveAsUids).some((uid) =>
    folderMapValues.has(uid),
  );
  if (!hasFolderMatch) {
    logger.warn(
      `[FocusProfileOnloadWiring] activeProfileUid=${activeProfileUid} produced an effective set with zero AssetSpace folder overlap ` +
        `(${effectiveAsUids.size} UIDs after translation + TS-floor; ${folderMap.size} folders known). ` +
        `Likely cause: profile declares Ontology UIDs not covered by any AssetSpace_containsOntology declaration ` +
        `(e.g. shared-identities мульти-anchor pattern). Degrading to no-filter — full vault will be indexed. ` +
        `Resolve by either declaring AS UIDs directly in the profile or adding containsOntology to the relevant AssetSpaces.`,
    );
    indexer.setEffectiveOntologies(null);
    indexer.setAssetSpaceFolderToUid(null);
    return { outcome: "degraded", effective: null, folderMap: null };
  }

  indexer.setEffectiveOntologies(effectiveAsUids);
  indexer.setAssetSpaceFolderToUid(folderMap);
  const untranslatedSummary =
    untranslated.length === 0
      ? ""
      : ` ${untranslated.length} declared UIDs failed translation (no AssetSpace_containsOntology mapping; ` +
        `examples: ${untranslated.slice(0, 3).join(", ")}${untranslated.length > 3 ? ", …" : ""}). ` +
        `Likely the shared-identities мульти-anchor case — see PR #3328 body.`;
  logger.info(
    `[FocusProfileOnloadWiring] activeProfileUid=${activeProfileUid} wired — ` +
      `${effectiveAsUids.size} effective AS UIDs (incl. ${TS_FLOOR_ASSETSPACE_UIDS.size} floor), ` +
      `${folderMap.size} folders mapped.${untranslatedSummary}`,
  );
  return {
    outcome: "engaged",
    effective: effectiveAsUids,
    folderMap,
  };
}

/**
 * Single vault walk producing both data products the wiring needs.
 * - `folderMap`: `assetspaces/<ns>` → AS UID, used by `shouldSkipFileForEffectiveSet`.
 * - `ontologyToAs`: each declared `exo__AssetSpace_containsOntology` Ontology
 *   UID → owning AS UID, used to translate profile-declared Ontology
 *   references to AS UIDs the filter understands.
 *
 * Walking once is intentional — `vault.getMarkdownFiles()` is the hot loop
 * and the AssetSpace count is small (~10), so the cost is dominated by the
 * `metadataCache.getFileCache` lookup per file regardless of how the data is
 * carved.
 */
function scanAssetSpaces(app: App): {
  folderMap: Map<string, string>;
  ontologyToAs: Map<string, string>;
} {
  const folderMap = new Map<string, string>();
  const ontologyToAs = new Map<string, string>();

  for (const file of app.vault.getMarkdownFiles()) {
    const fm = readFrontmatter(app, file);
    if (!fm) continue;
    if (!isAssetSpaceFrontmatter(fm)) continue;

    const uid = fm["exo__Asset_uid"];
    if (typeof uid !== "string" || uid.length === 0) continue;

    // Path-prefix source (legacy, preserved for all 18 live descriptors whose
    // file lives inside the AssetSpace it describes). RFC 01a83de8 v10 T3 —
    // discovery is a UNION; the path-prefix branch is never removed in 1a.
    const folder = parentFolder(file.path);
    if (folder.length > 0) {
      folderMap.set(folder, uid);
    }

    // Derived-path source (registry model, RFC v10 UD1). When a descriptor
    // declares `_source` (or legacy `_git`), the AssetSpace it describes mounts
    // at `derivePath(source)` = `assetspaces/<owner>/<repo>` — which may differ
    // from where the descriptor file itself lives (e.g. a registry descriptor
    // pointing at a separate test-library mount). Add that mapping alongside the
    // path-prefix one. For legacy descriptors whose `_git` host/repo differs
    // from their on-disk folder this yields a phantom entry (no files live under
    // the derived path → harmless; never matched by the consumer filter). The
    // 1b fleet migration flips the live folders onto the derived layout.
    const source = readAssetSpaceSource(fm);
    if (source !== null) {
      const derived = derivePath(source);
      if (derived !== null) {
        folderMap.set(derived, uid);
      }
    }

    const rawContains = fm["exo__AssetSpace_containsOntology"];
    const declared: unknown[] = Array.isArray(rawContains)
      ? rawContains
      : rawContains !== undefined && rawContains !== null
        ? [rawContains]
        : [];
    for (const raw of declared) {
      if (typeof raw !== "string") continue;
      const ontologyUid = extractUidFromWikilink(raw);
      if (ontologyUid === null) continue;
      // Last-writer wins on duplicate Ontology declarations (semantically
      // illegal — an Ontology lives in exactly one AS). The warn is left
      // off the hot path; SHACL-lite already catches multi-AS Ontology shapes.
      ontologyToAs.set(ontologyUid, uid);
    }
  }

  return { folderMap, ontologyToAs };
}

function readFrontmatter(
  app: App,
  file: TFile,
): Record<string, unknown> | null {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache || !cache.frontmatter) return null;
  return cache.frontmatter as Record<string, unknown>;
}

function parentFolder(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx < 0 ? "" : filePath.slice(0, idx);
}

/**
 * Read an AssetSpace's clone URL with the RFC 01a83de8 v10 dual-read contract:
 * the new `exo__AssetSpace_source` takes precedence, falling back to the legacy
 * `exo__AssetSpace_git` during the transition. Returns null when neither is a
 * non-empty string.
 */
function readAssetSpaceSource(fm: Record<string, unknown>): string | null {
  const source = fm["exo__AssetSpace_source"];
  if (typeof source === "string" && source.length > 0) return source;
  const git = fm["exo__AssetSpace_git"];
  if (typeof git === "string" && git.length > 0) return git;
  return null;
}

function extractUidFromWikilink(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .trim();
  return cleaned.length === 0 ? null : cleaned;
}

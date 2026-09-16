import type { App, TFile } from "obsidian";
import {
  resolveSubsumedClassKeys,
  instanceClassMatches,
  type ClassDefinitionLike,
} from "@kitelev/exocortex-core";
import type { AssetRefCandidate } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

/**
 * T1 "Create Instance" homoiconic button (project bbe40f8c) — collect the
 * candidate assets for a reusable fuzzy reference-picker field, i.e. every
 * vault asset that is an instance of `classUid` (the field's `targetClassUid`)
 * OR — req 15f48fa1 (ticket 8df9e6eb) — of any class whose
 * `exo__Class_superClass` chain reaches it (`ems__Effort` ⇒ instances of
 * `ems__Task` ∪ `ems__Project` ∪ `ems__Action` ∪ …), so a `targetClassUid`
 * naming an abstract / parent class is a usable picker rather than a dead one.
 *
 * Matching tolerates the dual IRI scheme (UID-canon + legacy symbolic): an
 * `exo__Instance_class` entry matches when its extracted target equals a
 * subsumed class's UID OR `exo__Asset_label`; `exo__Class_superClass` refs are
 * matched the same way (`resolveSubsumedClassKeys`, `@kitelev/exocortex-core`).
 * The class definitions are collected in the SAME metadata-cache pass that
 * scans the instances (one scan per call).
 *
 * Returns `{uid, label}` pairs sorted by label, so the picker shows a stable,
 * human-ordered list. Empty array when the metadata-cache API is unavailable
 * or nothing matches. Works on desktop and mobile (metadata cache only — no
 * `Platform.isMobile` gating).
 */
export function findAssetRefCandidates(
  app: App,
  classUid: string,
): AssetRefCandidate[] {
  if (!classUid) return [];

  const metadataCache = app.metadataCache;
  const vault = app.vault;
  if (!metadataCache?.getFileCache || !vault?.getMarkdownFiles) return [];

  const getFileCache = metadataCache.getFileCache.bind(metadataCache);
  const files: TFile[] = vault.getMarkdownFiles();

  // One pass: every asset's frontmatter + the class definitions it contains
  // (a file declaring `exo__Class_superClass`, or the target class file
  // itself so its label joins the match keys even without a parent).
  const assets: Array<{ file: TFile; fm: Record<string, unknown> }> = [];
  const classDefs: ClassDefinitionLike[] = [];
  const targetKey = classUid.toLowerCase();
  for (const file of files) {
    const fm = getFileCache(file)?.frontmatter;
    if (!fm) continue;
    assets.push({ file, fm });

    const uid =
      typeof fm["exo__Asset_uid"] === "string"
        ? (fm["exo__Asset_uid"] as string)
        : file.basename;
    const label =
      typeof fm["exo__Asset_label"] === "string"
        ? (fm["exo__Asset_label"] as string)
        : null;
    const supers = fm["exo__Class_superClass"];
    const superClassRefs =
      supers === undefined || supers === null
        ? []
        : Array.isArray(supers)
          ? supers
          : [supers];
    if (
      superClassRefs.length > 0 ||
      uid.toLowerCase() === targetKey ||
      file.basename.toLowerCase() === targetKey
    ) {
      classDefs.push({ uid, label, superClassRefs });
    }
  }

  // The target class and every transitive subclass, keyed by UID and label.
  const matchKeys = resolveSubsumedClassKeys(classUid, classDefs);

  const candidates: AssetRefCandidate[] = [];
  for (const { file, fm } of assets) {
    if (!instanceClassMatches(fm["exo__Instance_class"], matchKeys)) continue;

    const uid =
      typeof fm["exo__Asset_uid"] === "string"
        ? (fm["exo__Asset_uid"] as string)
        : file.basename;
    const label =
      typeof fm["exo__Asset_label"] === "string" &&
      (fm["exo__Asset_label"] as string).length > 0
        ? (fm["exo__Asset_label"] as string)
        : file.basename;
    candidates.push({ uid, label });
  }

  candidates.sort((a, b) => a.label.localeCompare(b.label));
  return candidates;
}

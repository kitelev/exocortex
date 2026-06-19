import type { App, TFile } from "obsidian";
import type { AssetRefCandidate } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

/**
 * T1 "Create Instance" homoiconic button (project bbe40f8c) — collect the
 * candidate assets for a reusable fuzzy reference-picker field, i.e. every
 * vault asset that is an instance of `classUid` (the field's `targetClassUid`).
 *
 * Matching tolerates the dual IRI scheme (UID-canon + legacy symbolic): an
 * `exo__Instance_class` entry matches when its extracted target equals the
 * class UID OR the class's `exo__Asset_label`. The class label is resolved
 * once from the class file (`<classUid>.md` basename or `exo__Asset_uid`).
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

  // Resolve the class label so symbolic-form `exo__Instance_class` values
  // (`[[exo__Ontology]]`) match as well as UID-form (`[[<uid>]]`).
  const matchTargets = new Set<string>([classUid.toLowerCase()]);
  for (const file of files) {
    if (file.basename === classUid) {
      const label = getFileCache(file)?.frontmatter?.["exo__Asset_label"];
      if (typeof label === "string" && label.length > 0) {
        matchTargets.add(label.toLowerCase());
      }
      break;
    }
  }

  const candidates: AssetRefCandidate[] = [];
  for (const file of files) {
    const fm = getFileCache(file)?.frontmatter;
    if (!fm) continue;

    const instanceClass = fm["exo__Instance_class"];
    if (!isInstanceOfClass(instanceClass, matchTargets)) continue;

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

function isInstanceOfClass(
  instanceClass: unknown,
  matchTargets: ReadonlySet<string>,
): boolean {
  if (instanceClass === undefined || instanceClass === null) return false;
  const entries = Array.isArray(instanceClass)
    ? instanceClass
    : [instanceClass];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const target = extractRefTarget(entry);
    if (target && matchTargets.has(target.toLowerCase())) return true;
  }
  return false;
}

/** Strip quotes / `[[ ]]` / `|alias` from a frontmatter ref → bare target. */
function extractRefTarget(value: string): string {
  let ref = value.trim().replace(/^["']|["']$/g, "").trim();
  ref = ref.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const pipeIdx = ref.indexOf("|");
  if (pipeIdx >= 0) ref = ref.slice(0, pipeIdx);
  return ref.trim();
}

/**
 * Integration: «Exocortex: Refresh link labels» re-resolves a bare `[[uid]]`
 * wikilink in an ALREADY-OPEN editor view after its target AssetSpace is
 * materialised — without an Obsidian restart (Веха 1 / MVP, WBS 74cac7b0).
 *
 * Faithful model (test-fixture-realism):
 *  - `metadataCache` is a production-shape fake: `getFirstLinkpathDest(uid)`
 *    returns `null` when the file is absent (exactly Obsidian's contract), a
 *    `TFile` only once it is present; `getFileCache` returns frontmatter only
 *    for present files. It is parameterised by a mutable `indexedFiles` map
 *    that models Obsidian's vault tree (what materialise + the file watcher
 *    reconcile into).
 *  - The "editor view" double drives the REAL label-resolution code path:
 *    `WikilinkLabelViewPlugin.resolveLabel(metadataCache, uid)`. It caches its
 *    rendered text exactly like `buildDecorations` does — a decoration (label)
 *    is produced only when `label && label !== uid`; otherwise the raw `uid`
 *    is shown. `reconfigure()` models `app.workspace.updateOptions()` recreating
 *    the ViewPlugin → a fresh `buildDecorations`.
 *
 * Revert-verify (integration-test-revert-verify): a service variant whose
 * `rebuildEditorViews` is a no-op leaves the open view stale → proves the
 * editor-view rebuild step is load-bearing, not vacuous.
 */

import { WikilinkLabelViewPlugin } from "@plugin/presentation/editor-extensions/WikilinkLabelViewPlugin";
import { LinkLabelRefreshService } from "@plugin/application/services/LinkLabelRefreshService";
import { TFile } from "obsidian";

const B_UID = "369c1b17-1296-4ec8-bdb9-c73fb74c0085";
const B_LABEL = "Daily";
const MISSING_UID = "ffffffff-0000-0000-0000-000000000000";

/**
 * Production-shape MetadataCache fake backed by a mutable `indexedFiles` map.
 * Mirrors Obsidian: a linkpath the vault tree does not know about resolves to
 * `null` (NOT a stub that always returns a file).
 */
function makeMetadataCache(indexedFiles: Map<string, { label?: string }>) {
  return {
    getFirstLinkpathDest: (linkpath: string): TFile | null => {
      const key = linkpath.endsWith(".md") ? linkpath.slice(0, -3) : linkpath;
      if (!indexedFiles.has(key)) return null;
      const file = new TFile();
      (file as unknown as { path: string }).path = `${key}.md`;
      return file;
    },
    getFileCache: (file: TFile) => {
      const key = file.path.replace(/\.md$/, "");
      const entry = indexedFiles.get(key);
      if (!entry) return null;
      return {
        frontmatter:
          entry.label !== undefined
            ? { exo__Asset_label: entry.label }
            : {},
      };
    },
  };
}

/**
 * Drives the REAL `WikilinkLabelViewPlugin.resolveLabel` exactly as
 * `buildDecorations` does: caches the rendered text for a single `[[uid]]`
 * wikilink. A label is shown only when it resolves to a non-uid string.
 */
class WikilinkEditorViewDouble {
  private rendered: string;

  constructor(
    private readonly uid: string,
    private readonly metadataCache: ReturnType<typeof makeMetadataCache>,
  ) {
    this.rendered = this.compute();
  }

  /** Models `app.workspace.updateOptions()` recreating the ViewPlugin. */
  reconfigure(): void {
    this.rendered = this.compute();
  }

  /** What the user sees for the `[[uid]]` link. */
  display(): string {
    return this.rendered;
  }

  private compute(): string {
    const label = WikilinkLabelViewPlugin.resolveLabel(
      this.metadataCache as never,
      this.uid,
    );
    // Mirror buildDecorations: decoration (label) only when label && != uid.
    return label && label !== this.uid ? label : this.uid;
  }
}

describe("Refresh link labels — re-resolve after materialize (integration)", () => {
  it("AS-IS bug: an open view stays `uid` after materialize until something rebuilds it", () => {
    const indexedFiles = new Map<string, { label?: string }>();
    const metadataCache = makeMetadataCache(indexedFiles);

    // Note A open BEFORE B's AssetSpace is materialised → raw uid.
    const view = new WikilinkEditorViewDouble(B_UID, metadataCache);
    expect(view.display()).toBe(B_UID);

    // User materialises B's AssetSpace (now on disk + reconciled into the
    // vault tree). The metadataCache CAN now resolve B...
    indexedFiles.set(B_UID, { label: B_LABEL });

    // ...but the already-open view holds a stale DecorationSet → still `uid`.
    // (This is the bug: nothing re-runs buildDecorations.)
    expect(view.display()).toBe(B_UID);
  });

  it("THE FIX: running the command re-resolves the open view to the label without a restart", async () => {
    const indexedFiles = new Map<string, { label?: string }>();
    const metadataCache = makeMetadataCache(indexedFiles);
    const view = new WikilinkEditorViewDouble(B_UID, metadataCache);
    indexedFiles.set(B_UID, { label: B_LABEL }); // materialise + reconcile

    // Stale before the command.
    expect(view.display()).toBe(B_UID);

    const service = new LinkLabelRefreshService({
      ensureIndexFresh: async () => undefined, // triple-store refresh (layouts)
      rebuildEditorViews: () => view.reconfigure(), // updateOptions()
      rerenderLayouts: () => undefined,
    });
    await service.refresh();

    // Resolved to the label — no Obsidian restart needed.
    expect(view.display()).toBe(B_LABEL);
  });

  it("REVERT-VERIFY: with the editor-view rebuild removed, the open view stays stale (`uid`)", async () => {
    const indexedFiles = new Map<string, { label?: string }>();
    const metadataCache = makeMetadataCache(indexedFiles);
    const view = new WikilinkEditorViewDouble(B_UID, metadataCache);
    indexedFiles.set(B_UID, { label: B_LABEL });

    // Service variant with rebuildEditorViews neutered → models reverting the
    // load-bearing re-resolve step. The view must NOT update.
    const serviceWithoutRebuild = new LinkLabelRefreshService({
      ensureIndexFresh: async () => undefined,
      rebuildEditorViews: () => undefined, // <-- reverted step
      rerenderLayouts: () => undefined,
    });
    await serviceWithoutRebuild.refresh();

    expect(view.display()).toBe(B_UID); // FAILS to resolve → proves step matters

    // Restore the step → resolves (PASS).
    const serviceWithRebuild = new LinkLabelRefreshService({
      ensureIndexFresh: async () => undefined,
      rebuildEditorViews: () => view.reconfigure(),
      rerenderLayouts: () => undefined,
    });
    await serviceWithRebuild.refresh();
    expect(view.display()).toBe(B_LABEL);
  });

  it("new tabs resolve fresh once the index sees B (no command needed for a NEW view)", () => {
    const indexedFiles = new Map<string, { label?: string }>([
      [B_UID, { label: B_LABEL }],
    ]);
    const metadataCache = makeMetadataCache(indexedFiles);

    // A view opened AFTER materialise builds fresh decorations immediately.
    const freshView = new WikilinkEditorViewDouble(B_UID, metadataCache);
    expect(freshView.display()).toBe(B_LABEL);
  });

  it("graceful: an unresolvable target stays `uid` after refresh (no throw, no label)", async () => {
    const indexedFiles = new Map<string, { label?: string }>([
      [B_UID, { label: B_LABEL }],
    ]);
    const metadataCache = makeMetadataCache(indexedFiles);
    // Note links to a target whose AssetSpace is STILL not materialised.
    const view = new WikilinkEditorViewDouble(MISSING_UID, metadataCache);

    const service = new LinkLabelRefreshService({
      ensureIndexFresh: async () => undefined,
      rebuildEditorViews: () => view.reconfigure(),
      rerenderLayouts: () => undefined,
    });
    await expect(service.refresh()).resolves.toBeUndefined();

    expect(view.display()).toBe(MISSING_UID); // stays uid, gracefully
  });
});

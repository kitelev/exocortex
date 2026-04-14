import { Plugin, TFile } from "obsidian";

/**
 * PropertiesLabelPatch - Patches Obsidian's Properties block to show human-readable
 * predicate labels (e.g. "Effort Area" instead of `ems__Effort_area`) and makes
 * them clickable to open the predicate definition asset.
 *
 * Resolution strategy (resolvePredicate):
 *  1. Filename match — a file whose basename equals the raw predicate name
 *  2. Aliases match — a file whose frontmatter `aliases` contains the raw predicate
 *
 * Both paths require the matched file to have a non-empty `exo__Asset_label` that
 * differs from the raw predicate; that label is what replaces the key text. If no
 * definition asset is found, the predicate row is left untouched (Scenario C fallback).
 *
 * Reading Mode only. Live Preview is explicitly out of scope for first iteration.
 * Follows the MutationObserver + layout-change re-patch pattern established by
 * PropertiesLinkPatch / PropertiesUidCopyPatch.
 */

const PATCHED_ATTR = "data-exo-label-patched";
const ORIGINAL_KEY_ATTR = "data-exo-original-key";
const CLICKABLE_CLASS = "exo-label-clickable";

interface ResolvedPredicate {
  label: string;
  file: TFile;
}

interface PatchRecord {
  propertyEl: HTMLElement;
  keyEl: HTMLElement;
  input: HTMLInputElement | null;
  originalKey: string;
  originalText: string | null;
  textNode: Text | null;
  clickHandler: (e: MouseEvent) => void;
}

export class PropertiesLabelPatch {
  private app: Plugin["app"];
  private plugin: Plugin;
  private observer: MutationObserver | null = null;
  private enabled = false;
  private resolveCache: Map<string, ResolvedPredicate | null> = new Map();
  private indexBuilt = false;
  private patched: PatchRecord[] = [];

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.buildIndex();
    this.patchAllPropertiesBlocks();
    this.setupObserver();

    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.invalidateIndex();
        this.patchAllPropertiesBlocks();
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        setTimeout(() => this.patchAllPropertiesBlocks(), 100);
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        setTimeout(() => this.patchAllPropertiesBlocks(), 100);
      })
    );
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.restoreAll();
  }

  cleanup(): void {
    this.disable();
  }

  private invalidateIndex(): void {
    this.indexBuilt = false;
    this.resolveCache.clear();
  }

  private buildIndex(): void {
    if (this.indexBuilt) return;
    this.resolveCache.clear();

    let files: TFile[] = [];
    if (typeof this.app.vault.getMarkdownFiles === "function") {
      const result = this.app.vault.getMarkdownFiles();
      if (Array.isArray(result)) {
        files = result;
      }
    }

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const rawLabel = fm["exo__Asset_label"];
      if (typeof rawLabel !== "string") continue;
      const label = rawLabel.trim();
      if (!label) continue;

      const keys = new Set<string>();
      keys.add(file.basename);
      const aliases = fm["aliases"];
      if (Array.isArray(aliases)) {
        for (const a of aliases) {
          if (typeof a === "string" && a.trim().length > 0) {
            keys.add(a.trim());
          }
        }
      }

      for (const key of keys) {
        if (key === label) continue;
        if (!this.resolveCache.has(key)) {
          this.resolveCache.set(key, { label, file });
        }
      }
    }

    this.indexBuilt = true;
  }

  private resolvePredicate(predicate: string): ResolvedPredicate | null {
    if (!this.indexBuilt) this.buildIndex();
    const cached = this.resolveCache.get(predicate);
    return cached ?? null;
  }

  private patchAllPropertiesBlocks(): void {
    if (!this.enabled) return;

    if (typeof this.app.workspace.getLeavesOfType === "function") {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      if (Array.isArray(leaves)) {
        for (const leaf of leaves) {
          const container = leaf.view.containerEl;
          this.patchPropertiesBlock(container);
        }
      }
    }
  }

  private patchPropertiesBlock(container: HTMLElement): void {
    const metadataContainer = container.querySelector<HTMLElement>(".metadata-container");
    if (!metadataContainer) return;

    const properties = metadataContainer.querySelectorAll<HTMLElement>(".metadata-property");
    for (const prop of Array.from(properties)) {
      this.patchProperty(prop);
    }
  }

  private patchProperty(propertyEl: HTMLElement): void {
    if (propertyEl.getAttribute(PATCHED_ATTR) === "true") return;

    const predicate = this.extractPredicate(propertyEl);
    if (!predicate) return;

    const resolved = this.resolvePredicate(predicate);
    if (!resolved) return;

    const keyEl = propertyEl.querySelector<HTMLElement>(".metadata-property-key");
    if (!keyEl) return;

    const input = keyEl.querySelector<HTMLInputElement>("input");
    let originalText: string | null = null;
    let textNode: Text | null = null;

    if (input) {
      input.setAttribute(ORIGINAL_KEY_ATTR, input.value);
      input.value = resolved.label;
    } else {
      textNode = this.findPredicateTextNode(keyEl, predicate);
      if (textNode) {
        originalText = textNode.textContent ?? null;
        textNode.textContent = resolved.label;
      } else {
        // Nothing to replace — skip patch to avoid corrupting DOM
        return;
      }
    }

    const clickHandler = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      this.openDefinition(resolved.file);
    };
    keyEl.addEventListener("click", clickHandler);
    keyEl.classList.add(CLICKABLE_CLASS);
    keyEl.setAttribute(
      "aria-label",
      `Open definition: ${resolved.label} (${predicate})`
    );

    propertyEl.setAttribute(PATCHED_ATTR, "true");
    this.patched.push({
      propertyEl,
      keyEl,
      input,
      originalKey: predicate,
      originalText,
      textNode,
      clickHandler,
    });
  }

  private extractPredicate(propertyEl: HTMLElement): string | null {
    const attr = propertyEl.getAttribute("data-property-key");
    if (attr && attr.trim().length > 0) return attr.trim();

    const keyEl = propertyEl.querySelector<HTMLElement>(".metadata-property-key");
    if (!keyEl) return null;

    const input = keyEl.querySelector<HTMLInputElement>("input");
    if (input?.value?.trim()) {
      const val = input.value.trim();
      return val.length > 0 ? val : null;
    }

    const text = (keyEl.textContent || "").trim().replace(/\u200B/g, "");
    return text.length > 0 ? text : null;
  }

  private findPredicateTextNode(keyEl: HTMLElement, predicate: string): Text | null {
    const walker = document.createTreeWalker(keyEl, NodeFilter.SHOW_TEXT, null);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.textContent || "").trim().replace(/\u200B/g, "");
      if (text === predicate) return node as Text;
      node = walker.nextNode();
    }
    return null;
  }

  private openDefinition(file: TFile): void {
    const leaf = this.app.workspace.getLeaf("tab");
    if (leaf && typeof (leaf as { openFile?: (f: TFile) => Promise<void> }).openFile === "function") {
      void (leaf as { openFile: (f: TFile) => Promise<void> }).openFile(file);
    }
  }

  private setupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;

          if (node.classList?.contains("metadata-container")) {
            this.patchPropertiesBlock(node.parentElement || node);
          } else if (node.querySelector?.(".metadata-container")) {
            this.patchPropertiesBlock(node);
          } else if (node.classList?.contains("metadata-property")) {
            this.patchProperty(node);
          } else {
            const mc = node.querySelector?.(".metadata-container") as HTMLElement | null;
            if (mc) {
              const props = mc.querySelectorAll<HTMLElement>(".metadata-property");
              for (const prop of Array.from(props)) {
                this.patchProperty(prop);
              }
            }
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private restoreAll(): void {
    for (const record of this.patched) {
      try {
        if (record.input) {
          const original = record.input.getAttribute(ORIGINAL_KEY_ATTR) ?? record.originalKey;
          record.input.value = original;
          record.input.removeAttribute(ORIGINAL_KEY_ATTR);
        } else if (record.textNode && record.originalText !== null) {
          record.textNode.textContent = record.originalText;
        }
        record.keyEl.removeEventListener("click", record.clickHandler);
        record.keyEl.classList.remove(CLICKABLE_CLASS);
        record.keyEl.removeAttribute("aria-label");
        record.propertyEl.removeAttribute(PATCHED_ATTR);
      } catch {
        // Best-effort restore; ignore individual failures
      }
    }
    this.patched = [];
  }
}

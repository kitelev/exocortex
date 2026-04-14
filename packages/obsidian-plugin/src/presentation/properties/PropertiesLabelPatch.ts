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
const DISPLAY_SPAN_CLASS = "exo-label-display";
const HIDDEN_INPUT_CLASS = "exo-label-hidden-input";
const CLICKABLE_CLASS = "exo-label-clickable";

interface ResolvedPredicate {
  label: string;
  file: TFile;
}

interface PatchRecord {
  propertyEl: HTMLElement;
  keyEl: HTMLElement;
  input: HTMLInputElement | null;
  displaySpan: HTMLSpanElement;
  textNode: Text | null;
  originalTextContent: string | null;
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

    // CRITICAL: we MUST NOT mutate `input.value`. Obsidian's native Properties
    // block treats the input as the canonical frontmatter-key editor — writing
    // to `input.value` and then clicking on the field persists the new value as
    // a rename of the frontmatter key, which corrupts the asset. Instead we
    // keep the original input intact, hide it, and insert a sibling span that
    // displays the readable label and owns the click handler.
    const input = keyEl.querySelector<HTMLInputElement>("input");
    const displaySpan = document.createElement("span");
    displaySpan.className = `${DISPLAY_SPAN_CLASS} ${CLICKABLE_CLASS}`;
    displaySpan.textContent = resolved.label;
    displaySpan.setAttribute("role", "link");
    displaySpan.setAttribute("tabindex", "0");
    displaySpan.setAttribute(
      "aria-label",
      `Open definition: ${resolved.label} (${predicate})`
    );
    displaySpan.setAttribute("data-exo-predicate", predicate);

    let textNode: Text | null = null;
    let originalTextContent: string | null = null;

    if (input) {
      input.classList.add(HIDDEN_INPUT_CLASS);
      input.parentNode?.insertBefore(displaySpan, input);
    } else {
      textNode = this.findPredicateTextNode(keyEl, predicate);
      if (textNode) {
        originalTextContent = textNode.textContent ?? null;
        textNode.textContent = "";
        textNode.parentNode?.insertBefore(displaySpan, textNode.nextSibling);
      } else {
        // Nothing recognizable to replace — append the display span as a
        // best-effort fallback (the key DOM is non-standard), so the user
        // still sees the readable label and click target.
        keyEl.appendChild(displaySpan);
      }
    }

    const clickHandler = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      this.openDefinition(resolved.file);
    };
    displaySpan.addEventListener("click", clickHandler);

    keyEl.classList.add(CLICKABLE_CLASS);
    propertyEl.setAttribute(PATCHED_ATTR, "true");
    this.patched.push({
      propertyEl,
      keyEl,
      input,
      displaySpan,
      textNode,
      originalTextContent,
      clickHandler,
    });
  }

  private extractPredicate(propertyEl: HTMLElement): string | null {
    // Obsidian's `data-property-key` attribute is lowercased (e.g. `exo__asset_uid`),
    // but the index is keyed on the original-case predicate from frontmatter
    // (e.g. `exo__Asset_uid`). The `<input>` inside `.metadata-property-key` holds
    // the original-case value, so always prefer it when present.
    const keyEl = propertyEl.querySelector<HTMLElement>(".metadata-property-key");
    if (keyEl) {
      const input = keyEl.querySelector<HTMLInputElement>("input");
      if (input?.value?.trim()) {
        return input.value.trim();
      }
      const text = (keyEl.textContent || "").trim().replace(/\u200B/g, "");
      if (text.length > 0) return text;
    }

    const attr = propertyEl.getAttribute("data-property-key");
    if (attr && attr.trim().length > 0) return attr.trim();

    return null;
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
        record.displaySpan.removeEventListener("click", record.clickHandler);
        record.displaySpan.remove();

        if (record.input) {
          record.input.classList.remove(HIDDEN_INPUT_CLASS);
        } else if (record.textNode && record.originalTextContent !== null) {
          record.textNode.textContent = record.originalTextContent;
        }

        record.keyEl.classList.remove(CLICKABLE_CLASS);
        record.propertyEl.removeAttribute(PATCHED_ATTR);
      } catch {
        // Best-effort restore; ignore individual failures
      }
    }
    this.patched = [];
  }
}

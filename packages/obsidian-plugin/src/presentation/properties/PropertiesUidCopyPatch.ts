import { Plugin, Notice } from "obsidian";
import { setIcon } from "obsidian";

/**
 * PropertiesUidCopyPatch - Adds a copy button next to exo__Asset_uid in Obsidian's native Properties block
 *
 * Implementation approach (Option C from Issue #2320):
 * - Uses MutationObserver to detect Properties block DOM changes
 * - Finds metadata-property elements with data-property-key="exo__Asset_uid"
 * - Injects a copy button into the property value container
 * - Provides optimistic UI feedback (icon swap to checkmark for 1.5s)
 * - Works in both Reading view and Editing view (Live Preview)
 *
 * Follows the same pattern as PropertiesLinkPatch for consistency.
 */

const PROPERTY_KEY = "exo__Asset_uid";
const COPY_BUTTON_CLASS = "exo-uid-copy-btn";
const ICON_RESTORE_DELAY = 1500;

export class PropertiesUidCopyPatch {
  private app: Plugin["app"];
  private plugin: Plugin;
  private observer: MutationObserver | null = null;
  private enabled = false;
  private restoreTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.patchAllPropertiesBlocks();
    this.setupObserver();

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

    this.removeAllCopyButtons();
    this.clearTimers();
  }

  cleanup(): void {
    this.disable();
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

    const uidProperties = this.findUidProperties(metadataContainer);
    for (const propertyEl of uidProperties) {
      this.addCopyButton(propertyEl);
    }
  }

  private findUidProperties(metadataContainer: HTMLElement): HTMLElement[] {
    const results: HTMLElement[] = [];

    const byDataAttr = metadataContainer.querySelectorAll<HTMLElement>(
      `.metadata-property[data-property-key="${PROPERTY_KEY}"]`
    );
    if (byDataAttr.length > 0) {
      return Array.from(byDataAttr);
    }

    const allProperties = metadataContainer.querySelectorAll<HTMLElement>(".metadata-property");
    for (const prop of Array.from(allProperties)) {
      const keyEl = prop.querySelector<HTMLElement>(".metadata-property-key");
      if (!keyEl) continue;
      const keyText = this.extractKeyText(keyEl);
      if (keyText === PROPERTY_KEY) {
        results.push(prop);
      }
    }

    return results;
  }

  private isUidProperty(el: HTMLElement): boolean {
    if (el.getAttribute("data-property-key") === PROPERTY_KEY) return true;
    const keyEl = el.querySelector<HTMLElement>(".metadata-property-key");
    if (!keyEl) return false;
    return this.extractKeyText(keyEl) === PROPERTY_KEY;
  }

  private extractKeyText(keyEl: HTMLElement): string {
    const input = keyEl.querySelector<HTMLInputElement>("input");
    if (input?.value?.trim()) {
      return input.value.trim();
    }
    return (keyEl.textContent || "").trim().replace(/\u200B/g, "");
  }

  private addCopyButton(propertyEl: HTMLElement): void {
    if (propertyEl.querySelector(`.${COPY_BUTTON_CLASS}`)) return;

    const valueContainer = propertyEl.querySelector<HTMLElement>(".metadata-property-value");
    if (!valueContainer) return;

    const uid = this.extractUidValue(valueContainer);
    if (!uid) return;

    const btn = document.createElement("button");
    btn.className = `clickable-icon ${COPY_BUTTON_CLASS}`;
    btn.setAttribute("aria-label", "Copy uid");
    setIcon(btn, "copy");

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleCopy(btn, uid);
    });

    valueContainer.appendChild(btn);
  }

  private extractUidValue(valueContainer: HTMLElement): string | null {
    const input = valueContainer.querySelector<HTMLInputElement>("input");
    if (input?.value?.trim()) {
      return input.value.trim();
    }

    const contentEditable = valueContainer.querySelector<HTMLElement>("[contenteditable]");
    if (contentEditable?.textContent?.trim()) {
      return contentEditable.textContent.trim();
    }

    const textContent = valueContainer.textContent?.trim();
    if (textContent) {
      return textContent;
    }

    return null;
  }

  private async handleCopy(btn: HTMLElement, uid: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(uid);
      setIcon(btn, "check");
      new Notice("Uid copied");
      const timer = setTimeout(() => {
        setIcon(btn, "copy");
        this.restoreTimers.delete(timer);
      }, ICON_RESTORE_DELAY);
      this.restoreTimers.add(timer);
    } catch {
      new Notice("Failed to copy uid");
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
            if (this.isUidProperty(node)) {
              this.addCopyButton(node);
            }
          } else {
            const mc = node.querySelector?.(".metadata-container") as HTMLElement | null;
            if (mc) {
              const uidProps = this.findUidProperties(mc);
              for (const prop of uidProps) {
                this.addCopyButton(prop);
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

  private removeAllCopyButtons(): void {
    const buttons = document.querySelectorAll(`.${COPY_BUTTON_CLASS}`);
    for (const btn of Array.from(buttons)) {
      btn.remove();
    }
  }

  private clearTimers(): void {
    for (const timer of this.restoreTimers) {
      clearTimeout(timer);
    }
    this.restoreTimers.clear();
  }
}

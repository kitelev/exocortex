import { Plugin, TFile } from "obsidian";
import {
  ConceptDefinitionResolver,
  type MetadataResolver,
} from "@plugin/domain/concept-definition/ConceptDefinitionResolver";
import { unwrapLinkTarget } from "@kitelev/exocortex-core";
import { ConceptDefinitionSpecService } from "@plugin/domain/concept-definition/ConceptDefinitionSpecService";

/**
 * PropertiesDefinitionValuePatch — renders a concept's `concept__Concept_definition` as a
 * homoiconic COMPUTED VIEW in Obsidian's native Properties block (Reading Mode).
 *
 * Delta-2 of concept-typization (req eb18a3a4). The definition of a concept is redundant
 * with its genus + differentia ("quarterly OKR" = genus(OKR) + differentia(quarterly)) —
 * so where a concept declares `concept__Concept_genus` (+ optional
 * `concept__Concept_differentia`), this patch OVERRIDES the definition property row's
 * displayed VALUE with the computed "<differentia> <genus>" phrase (resolved 1-hop to each
 * target's exo__Asset_label). Where genus is absent the native stored free-text value is
 * left untouched (materialized-OR-computed, RFC b860de33). The computation is delegated to
 * ConceptDefinitionResolver — this patch is a thin surface adapter.
 *
 * Surface-parity note (verify-before-assert, 2026-07-26): `concept__Concept_definition` has
 * NO custom render site in the plugin — it is displayed only by the native Properties panel,
 * so THAT is the surface this patches.
 *
 * READING MODE only, display-side ONLY (like the sibling PropertiesLabelPatch): the patch runs
 * only when the markdown view is in preview (reading) mode AND the definition value is displayed
 * as read-only text — it NEVER hides or replaces an editable value control (input / textarea /
 * contenteditable), so the stored `concept__Concept_definition` stays editable and is never
 * mutated (no edit-override → no corruption risk). Follows the MutationObserver + layout-change
 * re-patch pattern established by PropertiesLabelPatch / PropertiesLinkPatch / PropertiesUidCopyPatch.
 *
 * Dormant until Delta-3 by design: with 0 typed concept instances the patch is a no-op
 * (resolveComputed returns null for a concept with no genus, so nothing is overridden).
 *
 * OUT OF SCOPE (follow-up): a concept with genus but NO stored `concept__Concept_definition`
 * frontmatter key shows no native Properties row → there is nothing to override. Rendering
 * the computed definition where the property is absent is a NEW surface (row insertion /
 * dedicated block), tracked separately — not surface-parity.
 */

const DEFINITION_KEY = "concept__Concept_definition";
const PATCHED_ATTR = "data-exo-definition-patched";
const DISPLAY_SPAN_CLASS = "exo-definition-display";
// Obsidian inserts zero-width spaces (U+200B) in property-key text; built at runtime to
// avoid a literal invisible char in source.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

interface PatchRecord {
  propertyEl: HTMLElement;
  valueEl: HTMLElement;
  displaySpan: HTMLSpanElement;
  /** Original child nodes detached before the display span was shown, for restore. */
  originalNodes: Node[];
}

export class PropertiesDefinitionValuePatch {
  private app: Plugin["app"];
  private plugin: Plugin;
  private observer: MutationObserver | null = null;
  private enabled = false;
  private patched: PatchRecord[] = [];
  private resolver: ConceptDefinitionResolver;
  private specService: ConceptDefinitionSpecService;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.resolver = new ConceptDefinitionResolver(this.buildMetadataResolver());
    this.specService = new ConceptDefinitionSpecService(this.app);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.specService.initialize(); // load the vault-declared composition template(s)
    this.patchAllPropertiesBlocks();
    this.setupObserver();

    // The definition's genus/differentia can change → recompute. Obsidian re-renders the
    // Properties DOM on a frontmatter change (dropping our span → the observer re-patches),
    // but a persisted DOM node with a stale value would be skipped by PATCHED_ATTR, so we
    // restore + re-patch to guarantee a fresh value.
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", () => {
        // DEBOUNCED scan (the spec ~4 assets rarely change) — an un-debounced full-vault scan on
        // EVERY change is the iPhone-Jetsam crash-loop root cause under a sync burst. The DOM
        // re-patch below is O(open leaves), not O(vault), so it stays immediate.
        this.specService.scheduleRefresh();
        this.restoreAll();
        this.patchAllPropertiesBlocks();
      }),
    );

    // "resolved" fires once the initial vault parse finishes; on a fresh/tarball install it
    // arrives AFTER enable() (mirrors PropertiesLabelPatch Finding 4) — without it the
    // genus/differentia targets resolve to null labels on first render.
    this.plugin.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.specService.refresh();
        this.restoreAll();
        this.patchAllPropertiesBlocks();
      }),
    );

    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        setTimeout(() => this.patchAllPropertiesBlocks(), 100);
      }),
    );

    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        setTimeout(() => this.patchAllPropertiesBlocks(), 100);
      }),
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

  /**
   * A 1-hop wikilink → frontmatter resolver over the vault metadataCache, kept inline so the
   * patch stays self-contained (it deliberately does not depend on PrintNameRuleService).
   *
   * ⚠ It is NO LONGER a mirror of `PrintNameRuleService.createMetadataResolver`, and the
   * divergence is deliberate rather than an oversight: that one strips a display alias
   * (`[[uid|label]]` → `uid`, req fedeaa6e), this copy does not. Consequence — a
   * concept-definition dot-path over an ALIASED intermediate reference keeps the older
   * silent non-match, while the same authoring form resolves on the matcher and
   * display-name template surfaces. The shared `resolveKeyPath` (and therefore the
   * first-element list hop) IS reached from here, so the two changes land on a different
   * number of surfaces — three vs two.
   *
   * Unifying the two would change concept-definition RENDERING, a consumer req fedeaa6e
   * does not cover, so it needs its own requirement + revert-verify rather than a drive-by
   * edit: tracked in https://github.com/kitelev/exocortex/issues/4041.
   */
  private buildMetadataResolver(): MetadataResolver {
    return (wikilinkTarget: string): Record<string, unknown> | null => {
      // ⛤ The unwrap is now the SHARED one (#4041) — the copy here had stopped
      // stripping the display alias after req fedeaa6e changed the canonical
      // resolver, so a dot-path over an ALIASED intermediate reference kept a
      // silent non-match on this surface while resolving on the other three.
      // The HOP stays inline: the patch deliberately does not depend on
      // PrintNameRuleService, and going through metadataCache rather than a
      // VaultMetadataPort is not what diverged.
      const cleaned = unwrapLinkTarget(wikilinkTarget);
      if (!cleaned) return null;
  
      let file = this.app.metadataCache.getFirstLinkpathDest(cleaned, "");
      if (!file && !cleaned.endsWith(".md")) {
        file = this.app.metadataCache.getFirstLinkpathDest(cleaned + ".md", "");
      }
      if (!(file instanceof TFile)) return null;
  
      const cache = this.app.metadataCache.getFileCache(file);
      return cache?.frontmatter ? { ...cache.frontmatter } : null;
    };
  }

  private patchAllPropertiesBlocks(): void {
    if (!this.enabled) return;
    if (typeof this.app.workspace.getLeavesOfType !== "function") return;

    const leaves = this.app.workspace.getLeavesOfType("markdown");
    if (!Array.isArray(leaves)) return;

    for (const leaf of leaves) {
      const view = leaf.view as {
        containerEl?: HTMLElement;
        file?: TFile | null;
        getMode?: () => string;
      };
      // Reading-mode only (matches sibling PropertiesLabelPatch's scope): if the view exposes a
      // mode and it is NOT preview (reading), skip — the editable value stays untouched.
      const mode = typeof view?.getMode === "function" ? view.getMode() : undefined;
      if (mode !== undefined && mode !== "preview") continue;

      const container = view?.containerEl;
      const file = view?.file ?? null;
      if (container && file instanceof TFile) {
        this.patchPropertiesBlock(container, file);
      }
    }
  }

  private patchPropertiesBlock(container: HTMLElement, file: TFile): void {
    const metadataContainer = container.querySelector<HTMLElement>(".metadata-container");
    if (!metadataContainer) return;

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) return;

    // Only override when a COMPUTED value exists: a vault-declared composition template applies to
    // the concept's class AND genus is present. Otherwise the native stored value shows (no patch).
    const template = this.templateForConcept(frontmatter);
    const computed = this.resolver.resolveComputed(frontmatter, template);
    if (!computed) return;

    const properties = metadataContainer.querySelectorAll<HTMLElement>(".metadata-property");
    for (const prop of Array.from(properties)) {
      if (this.extractPredicate(prop) === DEFINITION_KEY) {
        this.patchDefinitionRow(prop, computed);
      }
    }
  }

  /** Override the definition row's displayed value with the computed phrase (Reading-Mode display). */
  private patchDefinitionRow(propertyEl: HTMLElement, computed: string): void {
    if (propertyEl.getAttribute(PATCHED_ATTR) === "true") return;

    const valueEl = propertyEl.querySelector<HTMLElement>(".metadata-property-value");
    if (!valueEl) return;

    // Reading-mode display ONLY — never override an EDITABLE value control (that would be an
    // edit-override, hiding the user's editable definition). If the value carries an
    // input/textarea/contenteditable (edit mode), leave it untouched.
    if (valueEl.querySelector("input, textarea, [contenteditable]")) return;

    const displaySpan = document.createElement("span");
    displaySpan.className = DISPLAY_SPAN_CLASS;
    displaySpan.textContent = computed;
    displaySpan.setAttribute("data-exo-computed-definition", "true");

    // Read-only text value — detach the native content (kept for restore) and show the computed
    // phrase. Node detach (not innerHTML) keeps this security-lint-clean.
    const originalNodes = Array.from(valueEl.childNodes);
    for (const node of originalNodes) valueEl.removeChild(node);
    valueEl.appendChild(displaySpan);

    propertyEl.setAttribute(PATCHED_ATTR, "true");
    this.patched.push({ propertyEl, valueEl, displaySpan, originalNodes });
  }

  /** The vault-declared definition template applying to any of the concept's instance_class keys, or null. */
  private templateForConcept(frontmatter: Record<string, unknown>): string | null {
    const instanceClass = frontmatter.exo__Instance_class;
    const raw = Array.isArray(instanceClass)
      ? instanceClass
      : instanceClass === undefined || instanceClass === null
        ? []
        : [instanceClass];
    for (const value of raw) {
      for (const key of this.classKeys(value)) {
        const template = this.specService.getTemplate(key);
        if (template) return template;
      }
    }
    return null;
  }

  /** Both the link-target (UID) and the alias/label of a class wikilink. */
  private classKeys(value: unknown): string[] {
    if (typeof value !== "string") return [];
    const cleaned = value.replace(/^\[\[|\]\]$/g, "").replace(/^"|"$/g, "").trim();
    if (!cleaned) return [];
    if (cleaned.includes("|")) {
      const [target, label] = cleaned.split("|");
      return [target.trim().replace(/\.md$/, ""), label.trim()].filter(
        (k): k is string => Boolean(k),
      );
    }
    return [cleaned.replace(/\.md$/, "")];
  }

  private extractPredicate(propertyEl: HTMLElement): string | null {
    const keyEl = propertyEl.querySelector<HTMLElement>(".metadata-property-key");
    if (keyEl) {
      const input = keyEl.querySelector<HTMLInputElement>("input");
      if (input?.value?.trim()) return input.value.trim();
      const text = (keyEl.textContent || "").trim().split(ZERO_WIDTH_SPACE).join("");
      if (text.length > 0) return text;
    }
    const attr = propertyEl.getAttribute("data-property-key");
    if (attr && attr.trim().length > 0) return attr.trim();
    return null;
  }

  private setupObserver(): void {
    if (this.observer) this.observer.disconnect();

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          // A metadata-container (or an ancestor/descendant of one) was (re)inserted →
          // re-patch the blocks (each leaf's active file), if any.
          if (
            node.classList?.contains("metadata-container") ||
            node.querySelector?.(".metadata-container") ||
            node.classList?.contains("metadata-property")
          ) {
            this.patchAllPropertiesBlocks();
            return;
          }
        }
      }
    });

    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private restoreAll(): void {
    for (const record of this.patched) {
      try {
        record.displaySpan.remove();
        for (const node of record.originalNodes) record.valueEl.appendChild(node);
        record.propertyEl.removeAttribute(PATCHED_ATTR);
      } catch {
        // best-effort restore
      }
    }
    this.patched = [];
  }
}

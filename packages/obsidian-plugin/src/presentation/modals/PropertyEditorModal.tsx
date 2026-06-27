import { Modal, App, TFile } from "obsidian";
import React from "react";
import {
  FrontmatterService,
  INotificationService,
  ITripleStore,
  IRI,
  Literal,
  Namespace,
} from "@kitelev/exocortex-core";
import { ExocortexPluginInterface } from '@plugin/types';
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import {
  PropertyEditorForm,
  type RelationsFormDeps,
} from '@plugin/presentation/components/property-editor/PropertyEditorForm';
import { ErrorBoundary } from '@plugin/presentation/components/ErrorBoundary';
import { formatPropertyValue } from '@plugin/domain/property-editor/formatPropertyValue';
import { extractInstanceClass } from '@plugin/domain/property-editor/extractInstanceClass';
import { getPropertySchemaForClass } from '@plugin/domain/property-editor/PropertySchemas';
import { findAssetRefCandidates } from '@plugin/presentation/utils/assetRefCandidates';
import type { AssetRefCandidate } from '@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder';
import {
  getReifiedRelations,
  type ReifiedRelation,
} from '@plugin/presentation/renderers/layout/getReifiedRelations';
import {
  buildRelationRows,
  reifiedToRows,
  dedupeRelations,
  extractInlineRelations,
  appendInlineRelationValue,
  removeInlineRelationValue,
  quoteRelationValueForYaml,
  type RelationRow,
} from '@plugin/presentation/components/property-editor/relationsEditorModel';
import type { PredicateOption } from '@plugin/presentation/components/property-editor/RelationsSection';

/**
 * The triple-store capabilities the Relations section needs. Read structurally
 * off the concrete plugin (which exposes `getSPARQLApi()` / `sparql` +
 * `lazyAssetGraphLoader`) WITHOUT extending `ExocortexPluginInterface` — so
 * `ExocortexPlugin.ts` (the god-file, held by a parallel session) is never
 * edited and the DI mirrors the RFC §C1 ctor-DI-not-interface decision.
 */
interface RelationsStoreCapablePlugin {
  getSPARQLApi?: () => {
    getTripleStore(): ITripleStore;
    isReady(): boolean;
  } | null;
  sparql?: { getTripleStore(): ITripleStore; isReady(): boolean };
  lazyAssetGraphLoader?: { notePathToIRI(path: string): IRI };
}

export class PropertyEditorModal extends Modal {
  private plugin: ExocortexPluginInterface;
  private reactRenderer: ReactRenderer;
  private file: TFile;
  private frontmatter: Record<string, unknown>;
  private instanceClass: string;
  private notificationService: INotificationService;

  /** Live working copy of A's frontmatter (relation writes mutate it immediately). */
  private currentFrontmatter: Record<string, unknown>;
  /** Reified rows cached at open (store lags a vault.delete — we drop locally). */
  private reifiedRows: RelationRow[] = [];

  constructor(
    app: App,
    plugin: ExocortexPluginInterface,
    file: TFile,
    frontmatter: Record<string, unknown>,
    notificationService: INotificationService,
  ) {
    super(app);
    this.plugin = plugin;
    this.reactRenderer = new ReactRenderer();
    this.file = file;
    this.frontmatter = frontmatter;
    this.currentFrontmatter = { ...frontmatter };
    this.instanceClass = extractInstanceClass(frontmatter);
    this.notificationService = notificationService;
  }

  private container: HTMLElement | null = null;

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("property-editor-modal");

    const titleEl = contentEl.createEl("div", { cls: "modal-title" });
    titleEl.textContent = "Edit properties";

    const subtitleEl = contentEl.createEl("div", { cls: "property-editor-subtitle" });
    subtitleEl.textContent = `${this.file.basename} (${this.instanceClass})`;

    this.container = contentEl.createEl("div", { cls: "property-editor-container" });

    // Render the form immediately (relations undefined → opens instantly), then
    // build the Relations-section deps async (triple-store query + schema) and
    // re-render with them when ready (RFC 93a0b2ee Task 3.1). Best-effort —
    // undefined when no triple store is reachable → form stays back-compat.
    this.renderForm(undefined);
    void this.buildRelationsDeps()
      .then((relations) => {
        if (relations) this.renderForm(relations);
      })
      .catch((error) => {
        console.error("[Exocortex Property Editor] Relations init error:", error);
      });
  }

  private renderForm(relations: RelationsFormDeps | undefined): void {
    if (!this.container) return;
    this.reactRenderer.render(
      this.container,
      React.createElement(
        ErrorBoundary,
        {
          children: React.createElement(PropertyEditorForm, {
            instanceClass: this.instanceClass,
            frontmatter: this.frontmatter,
            onSave: this.handleSave.bind(this),
            onCancel: this.handleCancel.bind(this),
            relations,
          }),
          onError: (error: Error) => {
            console.error("[Exocortex Property Editor] Error:", error);
            this.notificationService.error(`Error in property editor: ${error.message}`);
          },
        },
      ),
    );
  }

  /** Resolve the live triple store from the concrete plugin (no interface change). */
  private getStore(): {
    store: ITripleStore;
    isReady: boolean;
    notePathToIRI?: (path: string) => IRI;
  } | null {
    const p = this.plugin as unknown as RelationsStoreCapablePlugin;
    const api = p.getSPARQLApi?.() ?? p.sparql ?? null;
    if (!api) return null;
    const loader = p.lazyAssetGraphLoader;
    return {
      store: api.getTripleStore(),
      isReady: api.isReady(),
      notePathToIRI: loader ? (path: string) => loader.notePathToIRI(path) : undefined,
    };
  }

  /** Build the Relations-section dependency bundle, or `undefined` if no store. */
  private async buildRelationsDeps(): Promise<RelationsFormDeps | undefined> {
    const ctx = this.getStore();
    if (!ctx) return undefined;
    const { store, isReady, notePathToIRI } = ctx;

    // Reified relations — gated on store readiness + the indexer's notePathToIRI
    // (cold-start undercount guard, RFC §C1). Cached so a vault.delete (which the
    // store lags) is reflected by dropping the row locally, not re-querying.
    let reified: ReifiedRelation[] = [];
    if (isReady && notePathToIRI) {
      reified = await getReifiedRelations({
        file: {
          path: this.file.path,
          label:
            typeof this.frontmatter["exo__Asset_label"] === "string"
              ? (this.frontmatter["exo__Asset_label"] as string)
              : null,
        },
        store,
        notePathToIRI,
      });
    }
    this.reifiedRows = reifiedToRows(reified);

    const initialRows = buildRelationRows({
      frontmatter: this.currentFrontmatter,
      reified,
    });

    const rangeMap = await this.buildPredicateRangeMap(store);
    const predicateOptions = await this.buildPredicateOptions(rangeMap);

    const resolveCandidates = (
      rangeClassUid: string | undefined,
    ): AssetRefCandidate[] =>
      rangeClassUid ? findAssetRefCandidates(this.app, rangeClassUid) : [];

    return {
      initialRows,
      predicateOptions,
      resolveCandidates,
      createInline: this.createInlineRelation.bind(this),
      deleteRelation: this.deleteRelation.bind(this),
    };
  }

  /** Map each object-property's frontmatter key → its `exo:Property_range` class UID. */
  private async buildPredicateRangeMap(
    store: ITripleStore,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const rangeTriples = await store.match(
      undefined,
      Namespace.EXO.term("Property_range"),
      undefined,
    );
    for (const t of rangeTriples) {
      if (!(t.subject instanceof IRI)) continue;
      if (!(t.object instanceof IRI)) continue;
      const rangeUid = uidFromIri(t.object.value);
      if (!rangeUid) continue;
      const labels = await store.match(
        t.subject,
        Namespace.EXO.term("Asset_label"),
        undefined,
      );
      let key: string | null = null;
      for (const lt of labels) {
        if (lt.object instanceof Literal && lt.object.value.trim().length > 0) {
          key = lt.object.value.trim();
          break;
        }
      }
      if (key) map.set(key, rangeUid);
    }
    return map;
  }

  /** The class's wikilink (object) properties as create-predicate options. */
  private async buildPredicateOptions(
    rangeMap: Map<string, string>,
  ): Promise<PredicateOption[]> {
    const schema = await getPropertySchemaForClass(this.instanceClass);
    return schema
      .filter((p) => p.type === "wikilink" && !p.readOnly)
      .map((p) => ({
        key: p.name,
        label: p.label || p.name,
        rangeClassUid: rangeMap.get(p.name),
      }));
  }

  /** Recompute the unified rows from the live frontmatter + cached reified rows. */
  private rebuildRows(): RelationRow[] {
    const inline = extractInlineRelations(this.currentFrontmatter);
    return dedupeRelations(inline, this.reifiedRows);
  }

  /** Append a new INLINE relation to A's frontmatter; return refreshed rows. */
  private async createInlineRelation(
    predicateKey: string,
    targetUid: string,
  ): Promise<RelationRow[]> {
    try {
      const newValue = appendInlineRelationValue(
        this.currentFrontmatter[predicateKey],
        targetUid,
      );
      let content = await this.app.vault.read(this.file);
      const fm = new FrontmatterService();
      content = fm.updateProperty(
        content,
        predicateKey,
        formatPropertyValue(quoteRelationValueForYaml(newValue)),
      );
      await this.app.vault.modify(this.file, content);
      this.currentFrontmatter[predicateKey] = newValue;
      this.notificationService.success("Relation added");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notificationService.error(`Failed to add relation: ${message}`);
    }
    return this.rebuildRows();
  }

  /** Delete a relation: inline → frontmatter; reified → statement asset. */
  private async deleteRelation(row: RelationRow): Promise<RelationRow[]> {
    try {
      if (row.kind === "inline") {
        await this.deleteInline(row);
      } else {
        await this.deleteReified(row);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notificationService.error(`Failed to delete relation: ${message}`);
    }
    return this.rebuildRows();
  }

  private async deleteInline(row: RelationRow): Promise<void> {
    if (!row.inlineRawValue) return;
    const nextValue = removeInlineRelationValue(
      this.currentFrontmatter[row.predicateKey],
      row.inlineRawValue,
    );
    let content = await this.app.vault.read(this.file);
    const fm = new FrontmatterService();
    if (nextValue === undefined) {
      content = fm.removeProperty(content, row.predicateKey);
      delete this.currentFrontmatter[row.predicateKey];
    } else {
      content = fm.updateProperty(
        content,
        row.predicateKey,
        formatPropertyValue(quoteRelationValueForYaml(nextValue)),
      );
      this.currentFrontmatter[row.predicateKey] = nextValue;
    }
    await this.app.vault.modify(this.file, content);
    this.notificationService.success("Relation removed");
  }

  private async deleteReified(row: RelationRow): Promise<void> {
    const path = row.statementPath;
    if (!path) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      // trashFile (not vault.delete) respects the user's deletion preference and
      // is Desktop↔Mobile safe; the statement is recoverable from trash.
      await this.app.fileManager.trashFile(file);
      // verify-after-write — the statement file must be gone (mutation of disk).
      if (this.app.vault.getAbstractFileByPath(path)) {
        throw new Error(`statement still present after delete: ${path}`);
      }
    }
    // Drop the reified row locally (the triple store lags the delete until reindex).
    this.reifiedRows = this.reifiedRows.filter((r) => r.statementPath !== path);
    this.notificationService.success("Reified relation removed");
  }

  private async handleSave(updatedFrontmatter: Record<string, unknown>): Promise<void> {
    try {
      let fileContent = await this.app.vault.read(this.file);
      const frontmatterService = new FrontmatterService();

      for (const [key, value] of Object.entries(updatedFrontmatter)) {
        const formattedValue = formatPropertyValue(value);
        fileContent = frontmatterService.updateProperty(
          fileContent,
          key,
          formattedValue,
        );
      }

      await this.app.vault.modify(this.file, fileContent);
      this.notificationService.success("Properties saved successfully");
      this.close();
      this.plugin.refreshLayout?.();
    } catch (error) {
      console.error("[Exocortex Property Editor] Save error:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.notificationService.error(`Failed to save properties: ${message}`);
    }
  }

  private handleCancel(): void {
    this.close();
  }

  override onClose(): void {
    const { contentEl } = this;
    this.reactRenderer.unmount(contentEl);
    contentEl.empty();
    this.plugin.refreshLayout?.();
  }
}

/** Extract a UID-ish token from a range class IRI (`obsidian://…/<uid>.md` → uid). */
function uidFromIri(iri: string): string | null {
  const trimmed = iri.trim();
  const hash = trimmed.lastIndexOf("#");
  if (hash >= 0 && hash < trimmed.length - 1) return trimmed.slice(hash + 1);
  if (trimmed.includes("/")) {
    const last = trimmed.split("/").pop();
    if (!last) return null;
    return decodeURIComponent(last.replace(/\.md$/i, ""));
  }
  return trimmed.length > 0 ? trimmed : null;
}

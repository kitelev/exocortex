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
  reifiedToRows,
  dedupeRelations,
  extractInlineRelations,
  appendInlineRelationValue,
  removeInlineRelationValue,
  quoteRelationValueForYaml,
  type RelationRow,
} from '@plugin/presentation/components/property-editor/relationsEditorModel';
import {
  reifyRelation,
  deReifyRelation,
  parseInlineTargetsFromContent,
  DEFAULT_REIFY_ANCHOR_UID,
  type ReifyPorts,
} from '@plugin/presentation/components/property-editor/reifyModel';

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
  /** Schema keys that are NON-object properties (enums/scalars) — never relations. */
  private nonRelationKeys: ReadonlySet<string> = new Set();
  /** Predicate-mapping (RFC §C3 Task 3.2): frontmatter key → predicate-DEFINITION asset UID (reify). */
  private predicateDefUidByKey: Map<string, string> = new Map();
  /** Predicate-mapping (reverse): predicate-definition asset UID → frontmatter key (de-reify). */
  private keyByPredicateDefUid: Map<string, string> = new Map();
  /** Guards a late async re-render after the modal has been closed. */
  private closed = false;

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
    this.closed = false;
    this.renderForm(undefined);
    void this.buildRelationsDeps()
      .then((relations) => {
        // Skip the re-render if the user already closed the modal (avoids
        // mounting a React root into the emptied contentEl → leak).
        if (relations && !this.closed) this.renderForm(relations);
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
    // Schema drives which keys are object-relations vs enum/scalar properties.
    // Resolved once: enum (status/size) + scalar keys are excluded from relations
    // (they would otherwise mis-list + double-render), and the wikilink keys
    // become the create-predicate options.
    const schema = await getPropertySchemaForClass(this.instanceClass);
    this.nonRelationKeys = new Set(
      schema.filter((p) => p.type !== "wikilink").map((p) => p.name),
    );

    // Predicate range + the predicate-mapping maps (key ↔ predicate-def UID) are
    // built from the same `exo:Property_range` pass: a range triple's subject IS
    // the predicate-definition asset, and its `exo:Asset_label` IS the frontmatter
    // key (RFC §C3 Task 3.2 predicate-mapping).
    const rangeMap = await this.buildPredicateRangeMap(store);

    // Enrich the reified rows with the frontmatter key they map back to (so
    // de-reify writes the restored relation under the right key without guessing).
    this.reifiedRows = reifiedToRows(reified).map((r) => {
      const defUid = uidFromIri(r.predicateKey);
      const key = defUid ? this.keyByPredicateDefUid.get(defUid) : undefined;
      return key ? { ...r, predicateFrontmatterKey: key } : r;
    });

    // The unified, deduplicated rows from the live frontmatter + enriched reified rows.
    const initialRows = this.rebuildRows();

    const predicateOptions = schema
      .filter((p) => p.type === "wikilink" && !p.readOnly)
      .map((p) => ({
        key: p.name,
        label: p.label || p.name,
        rangeClassUid: rangeMap.get(p.name),
      }));

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
      reifyRelation: this.reify.bind(this),
      deReifyRelation: this.deReify.bind(this),
    };
  }

  /**
   * Map each object-property's frontmatter key → its `exo:Property_range` class
   * UID. As a side effect, also fills the predicate-mapping maps (key ↔ the
   * predicate-DEFINITION asset's UID) used by reify/de-reify (RFC §C3 Task 3.2) —
   * the range triple's subject IS that definition asset, and its label IS the key.
   */
  private async buildPredicateRangeMap(
    store: ITripleStore,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    this.predicateDefUidByKey = new Map();
    this.keyByPredicateDefUid = new Map();
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
      const defUid = uidFromIri(t.subject.value);
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
      if (key) {
        map.set(key, rangeUid);
        if (defUid) {
          this.predicateDefUidByKey.set(key, defUid);
          this.keyByPredicateDefUid.set(defUid, key);
        }
      }
    }
    return map;
  }

  /** Recompute the unified rows from the live frontmatter + cached reified rows. */
  private rebuildRows(): RelationRow[] {
    const inline = extractInlineRelations(
      this.currentFrontmatter,
      this.nonRelationKeys,
    );
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
      this.notificationService.success("Reified relation removed");
    }
    // Drop the reified row locally (the triple store lags the delete until reindex).
    this.reifiedRows = this.reifiedRows.filter((r) => r.statementPath !== path);
  }

  // ---- RFC §C3 Task 3.2 — reify/de-reify toggle (privacy-critical atomicity) ----

  /**
   * The vault-backed {@link ReifyPorts} the reify/de-reify orchestration drives.
   * Each is a single observable disk mutation; the verify reads come fresh from
   * disk so a duplicate/loss is detected against the real file, not a cache.
   * All writes go through `app.vault.*` / `app.fileManager.*` (Desktop↔Mobile
   * parity — no Node fs).
   */
  private reifyPorts(): ReifyPorts {
    return {
      createStatement: async (content: string, uid: string): Promise<string> => {
        const folder = this.resolveReifyFolder(DEFAULT_REIFY_ANCHOR_UID);
        if (folder === null) {
          throw new Error(
            "the reify destination AssetSpace ($kitelev-class-relations) is not mounted — mount it to reify this relation.",
          );
        }
        const path = folder ? `${folder}/${uid}.md` : `${uid}.md`;
        await this.app.vault.create(path, content);
        return path;
      },
      statementExists: async (path: string): Promise<boolean> =>
        this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      deleteStatement: async (path: string): Promise<void> => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.app.fileManager.trashFile(file);
      },
      removeInline: (predicateKey: string, rawValue: string): Promise<void> =>
        this.portRemoveInline(predicateKey, rawValue),
      appendInline: (predicateKey: string, targetUid: string): Promise<void> =>
        this.portAppendInline(predicateKey, targetUid),
      readInlineTargets: (predicateKey: string): Promise<string[]> =>
        this.portReadInlineTargets(predicateKey),
    };
  }

  /** Resolve the folder of a UID-named anchor asset (`<uid>.md`), or `null` if not mounted. */
  private resolveReifyFolder(anchorUid: string): string | null {
    const anchor = this.app.vault
      .getMarkdownFiles()
      .find((f) => f.basename === anchorUid);
    if (!anchor) return null;
    const parent = anchor.parent?.path;
    return parent && parent !== "/" ? parent : "";
  }

  /** Write-only: append `[[targetUid]]` to A's frontmatter under `key` (multi-value safe). */
  private async portAppendInline(key: string, targetUid: string): Promise<void> {
    const newValue = appendInlineRelationValue(
      this.currentFrontmatter[key],
      targetUid,
    );
    let content = await this.app.vault.read(this.file);
    const fm = new FrontmatterService();
    content = fm.updateProperty(
      content,
      key,
      formatPropertyValue(quoteRelationValueForYaml(newValue)),
    );
    await this.app.vault.modify(this.file, content);
    this.currentFrontmatter[key] = newValue;
  }

  /** Write-only: remove the single `rawValue` from A's frontmatter under `key` (siblings kept). */
  private async portRemoveInline(key: string, rawValue: string): Promise<void> {
    const nextValue = removeInlineRelationValue(
      this.currentFrontmatter[key],
      rawValue,
    );
    let content = await this.app.vault.read(this.file);
    const fm = new FrontmatterService();
    if (nextValue === undefined) {
      content = fm.removeProperty(content, key);
      delete this.currentFrontmatter[key];
    } else {
      content = fm.updateProperty(
        content,
        key,
        formatPropertyValue(quoteRelationValueForYaml(nextValue)),
      );
      this.currentFrontmatter[key] = nextValue;
    }
    await this.app.vault.modify(this.file, content);
  }

  /** Verify read: A's inline relation targets under `key`, resolved FRESH FROM DISK. */
  private async portReadInlineTargets(key: string): Promise<string[]> {
    // Read the bytes from disk (NOT currentFrontmatter) so the verify-after-write
    // reflects the real file — the parse is delegated to a pure, tested helper.
    const content = await this.app.vault.read(this.file);
    return parseInlineTargetsFromContent(content, key);
  }

  /** Parse the `exoas-<name>` AssetSpace segment from a vault path, or `null`. */
  private assetSpaceOf(path: string): string | null {
    const m = path.match(/(?:^|\/)(exoas-[a-z0-9-]+)(?:\/|$)/i);
    return m ? m[1] : null;
  }

  /** Reify an inline relation into an `exo__Statement` asset (atomic; rebuilds rows). */
  private async reify(row: RelationRow): Promise<RelationRow[]> {
    try {
      const subjectUid =
        typeof this.currentFrontmatter["exo__Asset_uid"] === "string"
          ? (this.currentFrontmatter["exo__Asset_uid"] as string)
          : "";
      if (!subjectUid) {
        throw new Error("the open asset has no exo__Asset_uid.");
      }
      const predicateDefUid =
        this.predicateDefUidByKey.get(row.predicateKey) ?? "";
      const newStatementUid = generateStatementUid();
      // The authoritative statement path is returned by the orchestration (no
      // TOCTOU recompute of the destination folder after the write).
      const statementPath = await reifyRelation(this.reifyPorts(), {
        subjectUid,
        predicateKey: row.predicateKey,
        predicateDefUid,
        objectUid: row.objectUid,
        inlineRawValue: row.inlineRawValue ?? "",
        isDefinedByAnchorUid: DEFAULT_REIFY_ANCHOR_UID,
        newStatementUid,
      });
      // Atomic success — the inline copy is gone + the statement is verified.
      // Reflect the new reified row locally (the store lags the create).
      this.reifiedRows.push({
        predicateKey: row.predicateKey,
        predicateLabel: row.predicateLabel,
        objectUid: row.objectUid,
        objectDisplay: row.objectDisplay,
        kind: "reified",
        statementPath,
        assetSpace: this.assetSpaceOf(statementPath),
        predicateFrontmatterKey: row.predicateKey,
      });
      this.notificationService.success("Relation reified");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notificationService.error(`Failed to reify relation: ${message}`);
    }
    return this.rebuildRows();
  }

  /** De-reify a reified relation back to inline (atomic; rebuilds rows). */
  private async deReify(row: RelationRow): Promise<RelationRow[]> {
    try {
      if (!row.statementPath) {
        throw new Error("the reified relation has no backing statement path.");
      }
      const predicateKey = row.predicateFrontmatterKey ?? "";
      await deReifyRelation(this.reifyPorts(), {
        predicateKey,
        targetUid: row.objectUid,
        statementPath: row.statementPath,
      });
      // Atomic success — inline restored + statement deleted. Drop the reified row.
      this.reifiedRows = this.reifiedRows.filter(
        (r) => r.statementPath !== row.statementPath,
      );
      this.notificationService.success("Relation returned to inline");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notificationService.error(`Failed to de-reify relation: ${message}`);
    }
    return this.rebuildRows();
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
    this.closed = true;
    const { contentEl } = this;
    if (this.container) this.reactRenderer.unmount(this.container);
    this.reactRenderer.unmount(contentEl);
    this.container = null;
    contentEl.empty();
    this.plugin.refreshLayout?.();
  }
}

/** A fresh lowercase UUID for a new statement asset (no `Date`/random in the pure model). */
function generateStatementUid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID().toLowerCase();
  // Fallback (non-secure) — only when crypto.randomUUID is unavailable.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

import type { App } from "obsidian";
import {
  ServiceRegistry,
  FrontmatterService,
  TaskStatusService,
  EffortStatusWorkflow,
  StatusTimestampService,
  GenericAssetCreationService,
  ArchiveAssetService,
  FixMissingLabelService,
  FolderRepairService,
  PropertyCleanupService,
  RenameToUidService,
  ConceptCreationService,
  ClassCreationService,
  type ClassRefResolver,
  type IGroundingService,
  type UserInput,
  type IFile,
  WorkflowResolver,
} from "@kitelev/exocortex-core";

/**
 * Build a `ClassRefResolver` (UUID → symbolic class label) backed by
 * Obsidian's `metadataCache`. After RFC-004 UID-canon, parent class
 * refs in frontmatter are stored as `[[<uuid>]]`; resolving the UUID
 * to the target file's `exo__Asset_label` recovers the symbolic name
 * (`ems__Area`, `ems__Project`, ...) needed for parent-property
 * branching. Returns `null` when the linkpath does not resolve or the
 * target has no label.
 */
function createMetadataClassResolver(app: App): ClassRefResolver {
  return (uuid: string): string | null => {
    const target = app.metadataCache.getFirstLinkpathDest(uuid, "");
    if (!target) return null;
    const cache = app.metadataCache.getFileCache(target);
    const label = cache?.frontmatter?.exo__Asset_label;
    return typeof label === "string" && label.length > 0 ? label : null;
  };
}
import {
  createArchiveAssetService,
  createCleanPropertiesService,
  createCreateAssetService,
  createCreateRelatedProjectService,
  createCreateRelatedTaskService,
  createFixMissingLabelService,
  createPlanForEveningService,
  createRenameToUidService,
  createRepairFolderService,
  createUpdatePropertyService,
  createRemovePropertyService,
  createSetStatusService,
  createDuplicateAssetService,
  createInstantiatePrototypeSubtreeService,
  type IPathResolver,
} from "@kitelev/exocortex-services";
import type { SPARQLApi } from "../../application/api/SPARQLApi";
import type { ObsidianFileSystemAdapter } from "../../adapters/ObsidianFileSystemAdapter";
import type { ObsidianVaultAdapter } from "../../adapters/ObsidianVaultAdapter";
import { createObsidianTargetResolver } from "./ObsidianTargetResolver";

export interface ServiceRegistryDeps {
  app: App;
  fileSystemAdapter: ObsidianFileSystemAdapter;
  sparqlApi: SPARQLApi;
  vaultAdapter?: ObsidianVaultAdapter;
  /**
   * RFC 36347daf Phase 2 — production triple-store-backed WorkflowResolver
   * passed through to EffortStatusWorkflow. Optional; when absent the
   * facade falls back to its legacy empty-store constructor (sync
   * hardcoded-fallback path; current behavior preserved).
   */
  workflowResolver?: WorkflowResolver;
}

function wrapService(
  fn: (targetIRI: string, userInput?: UserInput) => Promise<void>,
): IGroundingService {
  return { execute: fn };
}

export function populateServiceRegistry(
  registry: ServiceRegistry,
  deps: ServiceRegistryDeps,
): void {
  const { app, fileSystemAdapter, sparqlApi, vaultAdapter, workflowResolver } =
    deps;
  const frontmatterService = new FrontmatterService();
  // Shared metadataCache-backed resolver for UID-canon class refs.
  // Used wherever parent-class branching reads `exo__Instance_class`
  // from frontmatter (post RFC-004 the value is `[[<uuid>]]`).
  const classResolver = createMetadataClassResolver(app);

  // Plugin-side `IPathResolver` adapting the existing `resolveFilePath`
  // (UID lookup via `app.metadataCache` + `obsidian://vault/` URI decode) to
  // the storage-agnostic shared factories ported in T1.4.
  const pluginPathResolver: IPathResolver = {
    async resolveTargetPath(targetIRI: string): Promise<string> {
      return resolveFilePath(app, targetIRI);
    },
  };

  registry.register(
    "updateProperty",
    createUpdatePropertyService(
      fileSystemAdapter,
      frontmatterService,
      pluginPathResolver,
    ),
  );

  registry.register(
    "removeProperty",
    createRemovePropertyService(
      fileSystemAdapter,
      frontmatterService,
      pluginPathResolver,
    ),
  );

  registry.register(
    "setStatus",
    createSetStatusService(
      fileSystemAdapter,
      frontmatterService,
      pluginPathResolver,
    ),
  );

  registry.register(
    "openFile",
    wrapService(async (_targetIRI: string, userInput?: UserInput) => {
      const path = userInput?.path as string | undefined;
      if (!path) throw new Error("openFile requires userInput.path");
      await app.workspace.openLinkText(path, "");
    }),
  );

  registry.register(
    "sparqlSelect",
    wrapService(async (_targetIRI: string, userInput?: UserInput) => {
      const query = userInput?.query as string | undefined;
      if (!query) throw new Error("sparqlSelect requires userInput.query");
      await sparqlApi.query(query);
    }),
  );

  registry.register(
    "getActiveFileIRI",
    wrapService(async () => {
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) return;
      const cache = app.metadataCache.getFileCache(activeFile);
      const uid = cache?.frontmatter?.exo__Asset_uid as string | undefined;
      if (!uid) return;
    }),
  );

  registry.register(
    "getActiveFilePath",
    wrapService(async () => {
      app.workspace.getActiveFile();
    }),
  );

  registry.register(
    "trashFile",
    wrapService(async (targetIRI: string) => {
      const filePath = resolveFilePath(app, targetIRI);
      await app.vault.adapter.trashLocal(filePath);
    }),
  );

  registry.register(
    "duplicateFile",
    wrapService(async (targetIRI: string, userInput?: UserInput) => {
      const newLabel = userInput?.label as string | undefined;
      if (!newLabel) throw new Error("duplicateFile requires userInput.label");

      const filePath = resolveFilePath(app, targetIRI);
      const content = await fileSystemAdapter.readFile(filePath);
      const uid = crypto.randomUUID();
      const updated = frontmatterService.updateProperty(
        frontmatterService.updateProperty(content, "exo__Asset_uid", uid),
        "exo__Asset_label",
        newLabel,
      );
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      const newPath = `${dir}/${uid}.md`;
      await fileSystemAdapter.createFile(newPath, updated);
    }),
  );

  if (vaultAdapter) {
    const effortStatusWorkflow = new EffortStatusWorkflow();
    // RFC 36347daf Phase 2 — wire production WorkflowResolver when caller
    // (ExocortexPlugin) provided one. Legacy callers (CLI without store
    // hydration) keep the empty-store fallback by not passing a resolver.
    if (workflowResolver) {
      effortStatusWorkflow.setResolver(workflowResolver);
    }
    const statusTimestampService = new StatusTimestampService(vaultAdapter);
    const taskStatusService = new TaskStatusService(
      vaultAdapter,
      effortStatusWorkflow,
      statusTimestampService,
    );
    // Effort voting is no longer served here — Issue #3134 migrated the only
    // `service_call` consumer (grounding 506f031e-…) to the declarative
    // `property_increment` grounding type; the `EffortVotingService` class and
    // its `VoteOnEffortCommand` were subsequently removed entirely (#3961).
    //
    // LabelToAliasService was removed entirely — Issue #3132 migrated the only
    // `service_call` consumer (grounding a85668fa-…) to the declarative
    // `property_append` grounding type, and the legacy palette command
    // `CopyLabelToAliasesCommand` was subsequently deleted. No service or
    // command path remains.
    const genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    const archiveAssetService = new ArchiveAssetService(vaultAdapter);
    const propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    const fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    const renameToUidService = new RenameToUidService(vaultAdapter);
    const folderRepairService = new FolderRepairService(vaultAdapter);
    const conceptCreationService = new ConceptCreationService(vaultAdapter);
    const classCreationService = new ClassCreationService(
      vaultAdapter,
      folderRepairService,
    );
    // Obsidian-aware resolver for shared @kitelev/exocortex-services factories
    // (RFC 94e520da Phase 1, T1.3). Produces byte-identical IFile resolution
    // to the legacy `resolveIFile` helper below — see ObsidianTargetResolver.
    const targetResolver = createObsidianTargetResolver(app, vaultAdapter);

    // `rollbackStatus` service registration removed — universal rollback
    // button replaced by per-status backward Commands (Re-open, Rollback to
    // Backlog, etc.) using composite groundings (no WorkflowEngine string
    // matching). Fix for UUID-canon TBox 2026-05-16 regression where
    // WorkflowEngine.getPreviousStatus could not match UUID-form status.

    // `planOnToday` service registration removed in Issue #3136 — the sole
    // grounding consumer (`22a6ba6b-…`) was migrated to declarative
    // `property_set` with the new `$todayStart` substitution token
    // (Homoiconicity Invariant Q1 remediation, RFC
    // `18407cb2-9554-4897-9213-17321f9dd434` Path B). The legacy palette
    // command `PlanOnTodayCommand` and its `TaskStatusService.planOnToday`
    // method were subsequently deleted in Phase 4 PR-A (RFC 31c1a0be).

    registry.register(
      "planForEvening",
      createPlanForEveningService(vaultAdapter, taskStatusService, targetResolver),
    );

    // `shiftDay` + `incrementVotes` service registrations removed in
    // Issue #3134 — the three grounding consumers (`0b104d75-…`, `6ee56341-…`,
    // `506f031e-…`) were migrated to declarative `property_shift` /
    // `property_increment` (Homoiconicity Invariant Q1 remediation, RFC
    // `18407cb2-9554-4897-9213-17321f9dd434` Path B). The legacy palette
    // commands (`ShiftDayForwardCommand`, `ShiftDayBackwardCommand`) and
    // their `TaskStatusService.shiftDay{Forward,Backward}` methods were
    // subsequently deleted in Phase 4 PR-A (RFC 31c1a0be). The
    // `EffortVotingService` class + `VoteOnEffortCommand` were then removed
    // entirely in #3961 — no remaining service or command path.

    // `copyLabelToAliases` service registration removed in Issue #3132 —
    // the sole grounding consumer (a85668fa-17b7-45d0-aa7f-935e2502dff0) was
    // migrated to declarative `property_append` + `$target.exo__Asset_label`
    // (Homoiconicity Invariant Q1 remediation). The legacy LabelToAliasService
    // + CopyLabelToAliasesCommand were subsequently deleted (dead code).

    // Phase 4b (#3166) — thin wrappers delegate the createAsset family to the
    // storage-agnostic shared factories from `@kitelev/exocortex-services`
    // (Phase 3.5 ship). Removes ~250 LOC of inlined logic previously duplicated
    // between plugin and CLI. The `openCreatedFileInTab` callback wires the
    // Obsidian-specific post-create UX (focus the new asset in a new workspace
    // tab) without leaking Obsidian dependencies into the shared package.
    const openCreatedFileInTab = async (createdFile: IFile): Promise<void> => {
      const tfile = vaultAdapter.toTFile(createdFile);
      const leaf = app.workspace.getLeaf("tab");
      await leaf.openFile(tfile);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    };

    registry.register(
      "createAsset",
      createCreateAssetService(
        vaultAdapter,
        fileSystemAdapter,
        classResolver,
        targetResolver,
      ),
    );

    registry.register(
      "createRelatedTask",
      createCreateRelatedTaskService(
        vaultAdapter,
        genericAssetCreationService,
        targetResolver,
        openCreatedFileInTab,
        classResolver,
      ),
    );

    registry.register(
      "createRelatedProject",
      createCreateRelatedProjectService(
        vaultAdapter,
        genericAssetCreationService,
        targetResolver,
        openCreatedFileInTab,
        classResolver,
      ),
    );

    registry.register(
      "archiveAsset",
      createArchiveAssetService(vaultAdapter, archiveAssetService, targetResolver),
    );

    registry.register(
      "instantiatePrototypeSubtree",
      createInstantiatePrototypeSubtreeService(vaultAdapter, fileSystemAdapter),
    );

    registry.register(
      "cleanProperties",
      createCleanPropertiesService(
        vaultAdapter,
        propertyCleanupService,
        targetResolver,
      ),
    );

    registry.register(
      "fixMissingLabel",
      createFixMissingLabelService(
        vaultAdapter,
        fixMissingLabelService,
        targetResolver,
      ),
    );

    registry.register(
      "renameToUid",
      createRenameToUidService(vaultAdapter, renameToUidService, targetResolver),
    );

    // Issue #3292 — homoiconic palette command "Duplicate current asset"
    // (vault asset describes id/icon/label/precondition; this TS hook owns
    // the per-platform file-ops integration). Reuses `openCreatedFileInTab`
    // to focus the new asset in a workspace tab, mirroring createRelatedTask.
    registry.register(
      "duplicateAsset",
      createDuplicateAssetService(
        vaultAdapter,
        targetResolver,
        openCreatedFileInTab,
      ),
    );

    registry.register(
      "repairFolder",
      createRepairFolderService(
        vaultAdapter,
        folderRepairService,
        targetResolver,
      ),
    );

    registry.register(
      "createNarrowerConcept",
      wrapService(async (targetIRI: string, userInput?: UserInput) => {
        // Create a child ims__Concept whose ims__Concept_broader points to the
        // current target concept. Wraps existing ConceptCreationService (which
        // was previously orphaned: no service_call wiring → no UI button could
        // invoke it). Mirrors createRelatedTask pattern: resolve target file,
        // call domain service, open created file. See RFC 5a61a359 Phase C.2.
        const label = userInput?.label as string | undefined;
        if (!label) throw new Error("createNarrowerConcept requires userInput.label");
        const definition = (userInput?.definition as string | undefined) ?? "";
        const aliasesInput = userInput?.aliases;
        const aliases = Array.isArray(aliasesInput)
          ? aliasesInput.map(String)
          : typeof aliasesInput === "string" && aliasesInput.length > 0
            ? [aliasesInput]
            : [];
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        const createdFile = await conceptCreationService.createNarrowerConcept(
          iFile,
          label,
          definition,
          aliases,
        );
        const tfile = vaultAdapter.toTFile(createdFile);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(tfile);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      }),
    );

    registry.register(
      "createSubclass",
      wrapService(async (targetIRI: string, userInput?: UserInput) => {
        // Create a child exo__Class whose exo__Class_superClass points to the
        // current target class. Wraps existing ClassCreationService (previously
        // orphaned). See RFC 5a61a359 Phase C.3.
        const label = userInput?.label as string | undefined;
        if (!label) throw new Error("createSubclass requires userInput.label");
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        const parentMetadata =
          (vaultAdapter.getFrontmatter(iFile) as Record<string, unknown>) ?? {};
        const createdFile = await classCreationService.createSubclass(
          iFile,
          label,
          parentMetadata,
        );
        const tfile = vaultAdapter.toTFile(createdFile);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(tfile);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      }),
    );

    // `createTaskForDailyNote` service registration removed in Issue #3136 —
    // the sole grounding consumer (`4d8d5055-…`) was migrated to declarative
    // `create_instance` grounding with the new `$targetFolder` substitution
    // token + `exocmd__Grounding_propertyDefaults` JSON literal
    // (Homoiconicity Invariant Q1 remediation, RFC
    // `18407cb2-9554-4897-9213-17321f9dd434` Path B). No palette-command
    // path used this service id, so nothing else needs migration.
  }
}

function resolveFilePath(app: App, targetIRI: string): string {
  // Handle obsidian://vault/ IRIs by decoding to vault-relative path
  if (targetIRI.startsWith("obsidian://vault/")) {
    const decoded = decodeURIComponent(targetIRI.replace("obsidian://vault/", ""));
    const file = app.vault.getAbstractFileByPath(decoded);
    if (file) return decoded;
  }

  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.exo__Asset_uid === targetIRI) {
      return file.path;
    }
    const iri = cache?.frontmatter?.["@id"];
    if (iri === targetIRI) {
      return file.path;
    }
  }
  throw new Error(`No file found for IRI: ${targetIRI}`);
}

function resolveIFile(app: App, targetIRI: string, vaultAdapter: { getAbstractFileByPath(path: string): IFile | { path: string; name: string } | null }): IFile {
  const filePath = resolveFilePath(app, targetIRI);
  const iFileOrFolder = vaultAdapter.getAbstractFileByPath(filePath);
  if (!iFileOrFolder || !("basename" in iFileOrFolder)) {
    throw new Error(`Cannot resolve IFile for path: ${filePath}`);
  }
  return iFileOrFolder as IFile;
}

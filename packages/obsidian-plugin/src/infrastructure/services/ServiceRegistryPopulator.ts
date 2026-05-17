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
  DateFormatter,
  type IGroundingService,
  type UserInput,
  type IFile,
} from "exocortex";
import {
  createArchiveAssetService,
  createCleanPropertiesService,
  createFixMissingLabelService,
  createPlanForEveningService,
  createRenameToUidService,
  createRepairFolderService,
  createUpdatePropertyService,
  createRemovePropertyService,
  createSetStatusService,
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
}

function wrapService(
  fn: (targetIRI: string, userInput?: UserInput) => Promise<void>,
): IGroundingService {
  return { execute: fn };
}

function toQuotedWikilink(value: string): string {
  if (value.startsWith('"[[') && value.endsWith(']]"')) return value;
  if (value.startsWith("[[") && value.endsWith("]]")) return `"${value}"`;
  return `"[[${value}]]"`;
}

export function populateServiceRegistry(
  registry: ServiceRegistry,
  deps: ServiceRegistryDeps,
): void {
  const { app, fileSystemAdapter, sparqlApi, vaultAdapter } = deps;
  const frontmatterService = new FrontmatterService();

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
    "createAsset",
    wrapService(async (targetIRI: string, userInput?: UserInput) => {
      // Accept both `prototypeUID` and `prototype` — starter-kit groundings
      // prior to 2026-04-13 wired "Create Project" with `{"prototype":"..."}`
      // (natural JSON key), which diverged from the service contract. The UI
      // click-through silently failed because the 4 s red Notice fades fast
      // while the direct console call suggested the plugin was correct. See
      // #2850 Bug 3.
      const prototypeUID =
        (userInput?.prototypeUID as string | undefined) ??
        (userInput?.prototype as string | undefined);
      const label = userInput?.label as string | undefined;
      // `userInput.folder` literal wins over the targetIRI-based inference.
      // Global surfaces (Obsidian Command Palette, RFC `1429fcd0`) call this
      // service without an active file, so they pass `folder` explicitly via
      // the exocmd grounding `targetValue`. Layout buttons keep working
      // unchanged: they don't pass `folder` and the inference below fills it
      // in from the active asset.
      let folder = userInput?.folder as string | undefined;
      const ownerIdentity = userInput?.ownerIdentity as string | undefined;
      if (!prototypeUID) throw new Error("createAsset requires userInput.prototypeUID");
      if (!label) throw new Error("createAsset requires userInput.label");
      // Default to current file's folder when not specified
      if (!folder && targetIRI) {
        try {
          const currentPath = resolveFilePath(app, targetIRI);
          const lastSlash = currentPath.lastIndexOf("/");
          folder = lastSlash >= 0 ? currentPath.substring(0, lastSlash) : "";
        } catch {
          // IRI resolution failed — folder stays undefined
        }
      }
      if (!folder && folder !== "") throw new Error("createAsset requires userInput.folder");

      // Resolve parent file and metadata from targetIRI so prototype-based
      // creation inherits context (Instance_class, Effort_parent/area, status,
      // isDefinedBy) — mirrors createRelatedTask's inheritParentContext but
      // operates through fileSystemAdapter.createFile because this handler is
      // used from bindings that only have app+fileSystemAdapter wired.
      // RFC-028 Finding 2: without this inheritance, prototype-button created
      // Tasks render as orphans in Project layouts.
      let parentPath: string | undefined;
      let parentMetadata: Record<string, unknown> | undefined;
      if (targetIRI) {
        try {
          parentPath = resolveFilePath(app, targetIRI);
          const parentFile = app.vault.getAbstractFileByPath(parentPath);
          if (parentFile) {
            const cache = app.metadataCache.getFileCache(parentFile as never);
            parentMetadata = cache?.frontmatter as
              | Record<string, unknown>
              | undefined;
          }
        } catch {
          // IRI resolution failed — no parent inheritance
        }
      }
      // Default folder from current file's parent folder (re-use parentPath)
      if (!folder && parentPath) {
        const lastSlash = parentPath.lastIndexOf("/");
        folder = lastSlash >= 0 ? parentPath.substring(0, lastSlash) : "";
      }
      if (!folder && folder !== "") throw new Error("createAsset requires userInput.folder");

      const expectedClass = prototypeUID.endsWith("Prototype")
        ? prototypeUID.slice(0, -"Prototype".length)
        : prototypeUID;

      const uid = crypto.randomUUID();
      const createdAt = DateFormatter.toISOTimestamp(new Date());
      const fileName = `${uid}.md`;
      const filePath = `${folder}/${fileName}`;
      const lines: string[] = [
        "---",
        `exo__Asset_uid: ${uid}`,
        `exo__Asset_createdAt: ${createdAt}`,
        `exo__Asset_label: ${label}`,
        `exo__Asset_prototype: "[[${prototypeUID}]]"`,
        "exo__Instance_class:",
        `  - "[[${expectedClass}]]"`,
      ];
      let isDefinedByWritten = false;
      if (parentMetadata) {
        const parentClass = parentMetadata.exo__Instance_class;
        const parentClasses = Array.isArray(parentClass)
          ? parentClass
          : parentClass != null
            ? [parentClass]
            : [];
        const isAreaParent = parentClasses.some((cls) =>
          String(cls).includes("Area"),
        );
        const parentBasename = parentPath
          ? parentPath
              .substring(parentPath.lastIndexOf("/") + 1)
              .replace(/\.md$/, "")
          : undefined;
        if (parentBasename) {
          const parentProperty = isAreaParent
            ? "ems__Effort_area"
            : "ems__Effort_parent";
          lines.push(`${parentProperty}: "[[${parentBasename}]]"`);
        }
        if (!isAreaParent && parentMetadata.ems__Effort_area) {
          lines.push(
            `ems__Effort_area: ${toQuotedWikilink(
              String(parentMetadata.ems__Effort_area),
            )}`,
          );
        }
        lines.push('ems__Effort_status: "[[ems__EffortStatusBacklog]]"');
        if (parentMetadata.exo__Asset_isDefinedBy) {
          lines.push(
            `exo__Asset_isDefinedBy: ${toQuotedWikilink(
              String(parentMetadata.exo__Asset_isDefinedBy),
            )}`,
          );
          isDefinedByWritten = true;
        }
      }
      // Fallback for global surfaces without an active file (RFC `1429fcd0`):
      // the caller (e.g. ExocmdCommandPaletteRegistrar) injects the user's
      // owner-identity wikilink via `userInput.ownerIdentity`. Parent
      // inheritance takes precedence above — a button click on an
      // ontology-specific asset still inherits that asset's `isDefinedBy`,
      // so this branch only fires when there is no parent at all.
      if (!isDefinedByWritten && ownerIdentity) {
        lines.push(
          `exo__Asset_isDefinedBy: ${toQuotedWikilink(ownerIdentity)}`,
        );
      }
      lines.push("---", "");
      const frontmatter = lines.join("\n");
      await fileSystemAdapter.createFile(filePath, frontmatter);
    }),
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
    const statusTimestampService = new StatusTimestampService(vaultAdapter);
    const taskStatusService = new TaskStatusService(
      vaultAdapter,
      effortStatusWorkflow,
      statusTimestampService,
    );
    // EffortVotingService is no longer constructed here — Issue #3134 migrated
    // the only `service_call` consumer (grounding 506f031e-…) to the
    // declarative `property_increment` grounding type. The palette command
    // `VoteOnEffortCommand` instantiates EffortVotingService directly via DI,
    // not through this registry.
    //
    // LabelToAliasService is no longer constructed here — Issue #3132 migrated
    // the only `service_call` consumer (grounding a85668fa-…) to the
    // declarative `property_append` grounding type. The palette command
    // `CopyLabelToAliasesCommand` instantiates LabelToAliasService directly
    // via DI, not through this registry.
    const genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    const archiveAssetService = new ArchiveAssetService(vaultAdapter);
    const propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    const fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    const renameToUidService = new RenameToUidService(vaultAdapter);
    const folderRepairService = new FolderRepairService(vaultAdapter);
    const conceptCreationService = new ConceptCreationService(vaultAdapter);
    const classCreationService = new ClassCreationService(vaultAdapter);
    // Obsidian-aware resolver for shared @kitelev/exocortex-services factories
    // (RFC 94e520da Phase 1, T1.3). Produces byte-identical IFile resolution
    // to the legacy `resolveIFile` helper below — see ObsidianTargetResolver.
    const targetResolver = createObsidianTargetResolver(app, vaultAdapter);

    registry.register(
      "rollbackStatus",
      wrapService(async (targetIRI: string) => {
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        await taskStatusService.rollbackStatus(iFile);
      }),
    );

    // `planOnToday` service registration removed in Issue #3136 — the sole
    // grounding consumer (`22a6ba6b-…`) was migrated to declarative
    // `property_set` with the new `$todayStart` substitution token
    // (Homoiconicity Invariant Q1 remediation, RFC
    // `18407cb2-9554-4897-9213-17321f9dd434` Path B). The palette command
    // path `PlanOnTodayCommand → TaskStatusService.planOnToday` still wires
    // through direct DI (not the grounding service registry), so the
    // `taskStatusService.planOnToday` method itself is retained.

    registry.register(
      "planForEvening",
      createPlanForEveningService(vaultAdapter, taskStatusService, targetResolver),
    );

    // `shiftDay` + `incrementVotes` service registrations removed in
    // Issue #3134 — the three grounding consumers (`0b104d75-…`, `6ee56341-…`,
    // `506f031e-…`) were migrated to declarative `property_shift` /
    // `property_increment` (Homoiconicity Invariant Q1 remediation, RFC
    // `18407cb2-9554-4897-9213-17321f9dd434` Path B). Palette command paths
    // remain via direct DI:
    //   - `ShiftDayForwardCommand` / `ShiftDayBackwardCommand` →
    //     `taskStatusService.shiftDay{Forward,Backward}(file)`
    //   - `VoteOnEffortCommand` → `effortVotingService.incrementEffortVotes(file)`
    // The TS service classes are intentionally preserved (palette + hotkey
    // surfaces); only the registry registrations are deleted to avoid
    // duplicate dispatch paths for the now-declarative groundings.

    // `copyLabelToAliases` service registration removed in Issue #3132 —
    // the sole grounding consumer (a85668fa-17b7-45d0-aa7f-935e2502dff0) was
    // migrated to declarative `property_append` + `$target.exo__Asset_label`
    // (Homoiconicity Invariant Q1 remediation). Palette command path remains
    // via direct LabelToAliasService usage in CopyLabelToAliasesCommand.

    registry.register(
      "createRelatedTask",
      wrapService(async (targetIRI: string, userInput?: UserInput) => {
        const label = userInput?.label as string | undefined;
        if (!label) throw new Error("createRelatedTask requires userInput.label");
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        const parentMetadata = (vaultAdapter.getFrontmatter(iFile) as Record<string, unknown>) ?? {};
        const folderPath = iFile.parent?.path || "";

        const propertyValues: Record<string, unknown> = {
          "ems__Effort_status": '"[[ems__EffortStatusDraft]]"',
        };

        // Optional declarative override: starter-kit bindings may pass
        // `parentProperty` via Grounding_targetValue to force a specific parent
        // link. When absent, GenericAssetCreationService auto-detects
        // ems__Effort_area vs ems__Effort_parent from the parent's Instance_class.
        const explicitParentProperty = userInput?.parentProperty as string | undefined;
        if (explicitParentProperty && iFile.basename) {
          propertyValues[explicitParentProperty] = `"[[${iFile.basename}]]"`;
        }

        const createdFile = await genericAssetCreationService.createAsset({
          className: "ems__Task",
          label,
          folderPath,
          propertyValues,
          parentFile: iFile,
          parentMetadata,
        });

        const tfile = vaultAdapter.toTFile(createdFile);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(tfile);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      }),
    );

    registry.register(
      "createRelatedProject",
      wrapService(async (targetIRI: string, userInput?: UserInput) => {
        const label = userInput?.label as string | undefined;
        if (!label) throw new Error("createRelatedProject requires userInput.label");
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        const parentMetadata = (vaultAdapter.getFrontmatter(iFile) as Record<string, unknown>) ?? {};
        const folderPath = iFile.parent?.path || "";

        // Mirror createRelatedTask but scoped to ems__Project. Uses the same
        // ems__Effort_* parent-property convention so AssetRelations rendering
        // works uniformly with sibling Task/Meeting efforts. When the parent
        // is an ems__Area, write ems__Effort_area; when the parent is another
        // Project or Task, write ems__Effort_parent. The core
        // GenericAssetCreationService.inheritParentContext currently only
        // auto-inherits for ems__Task, so this handler does the area vs parent
        // detection explicitly via userInput.parentProperty and falls back to
        // the auto-detected form.
        const propertyValues: Record<string, unknown> = {
          "ems__Effort_status": '"[[ems__EffortStatusDraft]]"',
        };

        if (iFile.basename) {
          const explicitParentProperty = userInput?.parentProperty as string | undefined;
          if (explicitParentProperty) {
            propertyValues[explicitParentProperty] = `"[[${iFile.basename}]]"`;
          } else {
            const parentClass = parentMetadata["exo__Instance_class"];
            const parentClasses = Array.isArray(parentClass)
              ? parentClass
              : parentClass != null
                ? [parentClass]
                : [];
            const isAreaParent = parentClasses.some((cls) =>
              String(cls).includes("Area"),
            );
            const parentPropertyName = isAreaParent
              ? "ems__Effort_area"
              : "ems__Effort_parent";
            propertyValues[parentPropertyName] = `"[[${iFile.basename}]]"`;
          }
        }

        const createdFile = await genericAssetCreationService.createAsset({
          className: "ems__Project",
          label,
          folderPath,
          propertyValues,
          parentFile: iFile,
          parentMetadata,
        });

        const tfile = vaultAdapter.toTFile(createdFile);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(tfile);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      }),
    );

    registry.register(
      "archiveAsset",
      createArchiveAssetService(vaultAdapter, archiveAssetService, targetResolver),
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

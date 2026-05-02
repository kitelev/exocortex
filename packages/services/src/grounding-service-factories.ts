import type {
  IGroundingService,
  IVaultAdapter,
  IFile,
  UserInput,
  GenericAssetCreationService,
  ArchiveAssetService,
  TaskStatusService,
  PropertyCleanupService,
  FixMissingLabelService,
  RenameToUidService,
  FolderRepairService,
} from "exocortex";

/**
 * Shared, storage-agnostic grounding-service factories used by both the CLI
 * (`packages/cli/src/services/CliServiceRegistryPopulator.ts`) and — once T1.3
 * lands — the plugin (`packages/obsidian-plugin/src/infrastructure/services/`).
 *
 * Each factory returns an `IGroundingService` that adapts a domain service
 * (already lives in the shared `exocortex` package) to the runtime-agnostic
 * `service_call` contract dispatched by `GroundingExecutor`. All filesystem
 * access goes through `IVaultAdapter`, so plugin (Obsidian) and CLI (Node fs)
 * runtimes produce byte-identical state changes for the same input.
 *
 * Target-IRI → IFile resolution is delegated to the optional
 * `ITargetResolver` parameter. CLI runtime keeps the historical
 * path-based default (`getAbstractFileByPath(`${IRI}.md`)`); the Obsidian
 * plugin (T1.3) injects an Obsidian-aware resolver that scans
 * `metadataCache` for `exo__Asset_uid` / `@id` matches and decodes
 * `obsidian://vault/...` URIs.
 *
 * RFC 94e520da Phase 1, T1.2 (factories) + T1.3 (plugin migration).
 */

export interface ITargetResolver {
  resolveFile(targetIRI: string): IFile;
}

export function createPathBasedTargetResolver(
  vaultAdapter: IVaultAdapter,
): ITargetResolver {
  return {
    resolveFile(targetIRI: string): IFile {
      const candidate = vaultAdapter.getAbstractFileByPath(`${targetIRI}.md`);
      if (!candidate || !("basename" in candidate)) {
        throw new Error(`Cannot resolve target file for IRI: ${targetIRI}`);
      }
      return candidate as IFile;
    },
  };
}

export function createCreateRelatedTaskService(
  vaultAdapter: IVaultAdapter,
  genericAssetCreationService: GenericAssetCreationService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const label = userInput?.label as string | undefined;
      if (!label) {
        throw new Error("createRelatedTask requires userInput.label");
      }

      const parentFile = resolver.resolveFile(targetIRI);
      const parentMetadata =
        (vaultAdapter.getFrontmatter(parentFile) as Record<string, unknown>) ??
        {};
      const folderPath = parentFile.parent?.path || "";

      const propertyValues: Record<string, unknown> = {
        ems__Effort_status: '"[[ems__EffortStatusDraft]]"',
      };

      const explicitParentProperty = userInput?.parentProperty as
        | string
        | undefined;
      if (explicitParentProperty && parentFile.basename) {
        propertyValues[explicitParentProperty] = `"[[${parentFile.basename}]]"`;
      }

      await genericAssetCreationService.createAsset({
        className: "ems__Task",
        label,
        folderPath,
        propertyValues,
        parentFile,
        parentMetadata,
      });
    },
  };
}

export function createCreateRelatedProjectService(
  vaultAdapter: IVaultAdapter,
  genericAssetCreationService: GenericAssetCreationService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const label = userInput?.label as string | undefined;
      if (!label) {
        throw new Error("createRelatedProject requires userInput.label");
      }

      const parentFile = resolver.resolveFile(targetIRI);
      const parentMetadata =
        (vaultAdapter.getFrontmatter(parentFile) as Record<string, unknown>) ??
        {};
      const folderPath = parentFile.parent?.path || "";

      const propertyValues: Record<string, unknown> = {
        ems__Effort_status: '"[[ems__EffortStatusDraft]]"',
      };

      const explicitParentProperty = userInput?.parentProperty as
        | string
        | undefined;
      if (explicitParentProperty && parentFile.basename) {
        propertyValues[explicitParentProperty] = `"[[${parentFile.basename}]]"`;
      }

      await genericAssetCreationService.createAsset({
        className: "ems__Project",
        label,
        folderPath,
        propertyValues,
        parentFile,
        parentMetadata,
      });
    },
  };
}

export function createArchiveAssetService(
  vaultAdapter: IVaultAdapter,
  archiveAssetService: ArchiveAssetService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      await archiveAssetService.archiveAsset(targetFile);
    },
  };
}

export function createCleanPropertiesService(
  vaultAdapter: IVaultAdapter,
  propertyCleanupService: PropertyCleanupService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      await propertyCleanupService.cleanEmptyProperties(targetFile);
    },
  };
}

export function createFixMissingLabelService(
  vaultAdapter: IVaultAdapter,
  fixMissingLabelService: FixMissingLabelService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      await fixMissingLabelService.fixMissingLabel(targetFile);
    },
  };
}

export function createRenameToUidService(
  vaultAdapter: IVaultAdapter,
  renameToUidService: RenameToUidService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      const metadata =
        (vaultAdapter.getFrontmatter(targetFile) as Record<string, unknown>) ??
        {};
      await renameToUidService.renameToUid(targetFile, metadata);
    },
  };
}

export function createRepairFolderService(
  vaultAdapter: IVaultAdapter,
  folderRepairService: FolderRepairService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      const metadata =
        (vaultAdapter.getFrontmatter(targetFile) as Record<string, unknown>) ??
        {};
      const expectedFolder = await folderRepairService.getExpectedFolder(
        targetFile,
        metadata,
      );
      if (expectedFolder === null) {
        throw new Error(
          "repairFolder: cannot determine expected folder (missing exo__Asset_isDefinedBy or referenced asset not found)",
        );
      }
      const currentFolder = targetFile.parent?.path ?? "";
      if (currentFolder === expectedFolder) {
        return;
      }
      await folderRepairService.repairFolder(targetFile, expectedFolder);
    },
  };
}

export function createPlanForEveningService(
  vaultAdapter: IVaultAdapter,
  taskStatusService: TaskStatusService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      await taskStatusService.planForEvening(targetFile);
    },
  };
}

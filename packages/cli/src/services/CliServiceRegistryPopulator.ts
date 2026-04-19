import {
  ServiceRegistry,
  type IGroundingService,
  type IVaultAdapter,
  type IFile,
  type UserInput,
  GenericAssetCreationService,
  ArchiveAssetService,
  FixMissingLabelService,
  PropertyCleanupService,
  RenameToUidService,
  TaskStatusService,
} from "exocortex";

/**
 * The 10 well-known service IDs the plugin registers via
 * ServiceRegistryPopulator. CLI stubs exist so that `dyncommand validate` can
 * verify grounding service references point to a known service, and so that
 * `dyncommand exec` fails loudly instead of silently fake-succeeding.
 *
 * Issue #2518, #2864
 */
export const CLI_STUB_SERVICE_IDS = [
  "updateProperty",
  "removeProperty",
  "setStatus",
  "createAsset",
  "openFile",
  "sparqlSelect",
  "getActiveFileIRI",
  "getActiveFilePath",
  "trashFile",
  "duplicateFile",
] as const;

export type CliStubServiceId = (typeof CLI_STUB_SERVICE_IDS)[number];

/**
 * Thrown when a stub `IGroundingService` is invoked. Callers that want to
 * branch on CLI-parity gaps can narrow on this class; string matchers
 * should look for the `serviceId` substring in the message.
 */
export class CliServiceNotImplementedError extends Error {
  constructor(public readonly serviceId: string) {
    super(
      `Service "${serviceId}" is not implemented in the CLI (no-op stub). ` +
        `dyncommand exec on this service_call grounding cannot change vault state. ` +
        `See CLI parity issues #2865-#2868 for port status.`,
    );
    this.name = "CliServiceNotImplementedError";
  }
}

function notImplementedService(serviceId: string): IGroundingService {
  return {
    async execute(): Promise<void> {
      throw new CliServiceNotImplementedError(serviceId);
    },
  };
}

/**
 * Optional dependencies that unlock real CLI-side service implementations.
 *
 * `dyncommand validate` and unit tests call `populateCliServiceRegistry`
 * without deps and receive only fail-loud stubs. `dyncommand exec` supplies
 * the adapters + shared services so ported handlers (e.g. createRelatedTask,
 * #2865) can run against a real vault on disk.
 */
export interface CliServiceRegistryDeps {
  vaultAdapter: IVaultAdapter;
  genericAssetCreationService: GenericAssetCreationService;
  archiveAssetService: ArchiveAssetService;
  taskStatusService: TaskStatusService;
  propertyCleanupService: PropertyCleanupService;
  fixMissingLabelService: FixMissingLabelService;
  renameToUidService: RenameToUidService;
}

function resolveTargetFile(vaultAdapter: IVaultAdapter, targetIRI: string): IFile {
  const candidate = vaultAdapter.getAbstractFileByPath(`${targetIRI}.md`);
  if (!candidate || !("basename" in candidate)) {
    throw new Error(`Cannot resolve target file for IRI: ${targetIRI}`);
  }
  return candidate as IFile;
}

/**
 * CLI-side implementation of the `createRelatedTask` service (#2865).
 *
 * Mirrors the plugin handler in
 * `packages/obsidian-plugin/src/infrastructure/services/ServiceRegistryPopulator.ts`
 * minus workspace/leaf side-effects — the CLI just writes the new `.md` file
 * and returns. Parent-context inheritance (ems__Effort_area vs ems__Effort_parent)
 * is delegated to `GenericAssetCreationService.inheritParentContext`.
 */
export function createCreateRelatedTaskService(
  vaultAdapter: IVaultAdapter,
  genericAssetCreationService: GenericAssetCreationService,
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const label = userInput?.label as string | undefined;
      if (!label) {
        throw new Error("createRelatedTask requires userInput.label");
      }

      const parentFile = resolveTargetFile(vaultAdapter, targetIRI);
      const parentMetadata =
        (vaultAdapter.getFrontmatter(parentFile) as Record<string, unknown>) ?? {};
      const folderPath = parentFile.parent?.path || "";

      const propertyValues: Record<string, unknown> = {
        ems__Effort_status: '"[[ems__EffortStatusDraft]]"',
      };

      const explicitParentProperty = userInput?.parentProperty as string | undefined;
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

/**
 * CLI-side implementation of the `createRelatedProject` service (#2866).
 *
 * Mirrors the plugin handler in
 * `packages/obsidian-plugin/src/infrastructure/services/ServiceRegistryPopulator.ts`
 * minus workspace/leaf side-effects. Parent-context inheritance
 * (ems__Effort_area vs ems__Effort_parent) is delegated to
 * `GenericAssetCreationService.inheritParentContext`, which covers the
 * `ems__Project` branch symmetrically with `ems__Task`.
 */
export function createCreateRelatedProjectService(
  vaultAdapter: IVaultAdapter,
  genericAssetCreationService: GenericAssetCreationService,
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const label = userInput?.label as string | undefined;
      if (!label) {
        throw new Error("createRelatedProject requires userInput.label");
      }

      const parentFile = resolveTargetFile(vaultAdapter, targetIRI);
      const parentMetadata =
        (vaultAdapter.getFrontmatter(parentFile) as Record<string, unknown>) ?? {};
      const folderPath = parentFile.parent?.path || "";

      const propertyValues: Record<string, unknown> = {
        ems__Effort_status: '"[[ems__EffortStatusDraft]]"',
      };

      const explicitParentProperty = userInput?.parentProperty as string | undefined;
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

/**
 * CLI-side implementation of the `archiveAsset` service (#2867).
 *
 * Mirrors the plugin handler in
 * `packages/obsidian-plugin/src/infrastructure/services/ServiceRegistryPopulator.ts`.
 * Archive semantic is in-place frontmatter mutation (`archived: true` +
 * remove `aliases`) delegated to the shared `ArchiveAssetService`. No
 * file move; batch cross-vault archival remains the domain of the
 * separate `cli archive` command (`ArchiveService`).
 */
export function createArchiveAssetService(
  vaultAdapter: IVaultAdapter,
  archiveAssetService: ArchiveAssetService,
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolveTargetFile(vaultAdapter, targetIRI);
      await archiveAssetService.archiveAsset(targetFile);
    },
  };
}

/**
 * CLI-side implementation of the `cleanProperties` service (#2869).
 *
 * Mirrors the plugin handler in
 * `packages/obsidian-plugin/src/infrastructure/services/ServiceRegistryPopulator.ts`.
 * Delegates to the shared `PropertyCleanupService` which strips frontmatter
 * entries whose values are empty (`""`, `null`, `undefined`, `[]`, `{}`).
 * Storage-agnostic via `IVaultAdapter`, so the plugin and CLI paths stay
 * byte-identical for the same input.
 */
export function createCleanPropertiesService(
  vaultAdapter: IVaultAdapter,
  propertyCleanupService: PropertyCleanupService,
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolveTargetFile(vaultAdapter, targetIRI);
      await propertyCleanupService.cleanEmptyProperties(targetFile);
    },
  };
}

/**
 * CLI-side implementation of the `fixMissingLabel` service (#2870).
 *
 * Mirrors the plugin handler in
 * `packages/obsidian-plugin/src/infrastructure/services/ServiceRegistryPopulator.ts`.
 * Delegates to the shared `FixMissingLabelService` which sets
 * `exo__Asset_label` to `file.basename` when the property is missing or
 * empty. Idempotent: a no-op when the label is already set. Storage-agnostic
 * via `IVaultAdapter`, so plugin and CLI stay byte-identical.
 */
export function createFixMissingLabelService(
  vaultAdapter: IVaultAdapter,
  fixMissingLabelService: FixMissingLabelService,
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolveTargetFile(vaultAdapter, targetIRI);
      await fixMissingLabelService.fixMissingLabel(targetFile);
    },
  };
}

/**
 * CLI-side implementation of the `renameToUid` service (#2871).
 *
 * Mirrors the plugin handler in
 * `packages/obsidian-plugin/src/infrastructure/services/ServiceRegistryPopulator.ts`.
 * Delegates to the shared `RenameToUidService` which renames the file to
 * match its `exo__Asset_uid` property (e.g. `My Task.md` → `a1b2c3d4-….md`).
 *
 * Caveat: `FileSystemVaultAdapter.updateLinks` in the CLI is a no-op stub —
 * the file itself is renamed and a missing label is backfilled, but
 * wikilinks referencing the old basename in other vault notes are NOT
 * rewritten. Parity with the Obsidian plugin's vault-wide link update is
 * tracked separately; users relying on link rewrite should continue to use
 * Obsidian. Plugin path remains fully symmetric.
 */
export function createRenameToUidService(
  vaultAdapter: IVaultAdapter,
  renameToUidService: RenameToUidService,
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolveTargetFile(vaultAdapter, targetIRI);
      const metadata =
        (vaultAdapter.getFrontmatter(targetFile) as Record<string, unknown>) ??
        {};
      await renameToUidService.renameToUid(targetFile, metadata);
    },
  };
}

/**
 * CLI-side implementation of the `planForEvening` service (#2868).
 *
 * Mirrors the plugin handler in
 * `packages/obsidian-plugin/src/infrastructure/services/ServiceRegistryPopulator.ts`.
 * Sets `ems__Effort_plannedStartTimestamp` to today at 19:00:00 local time
 * (no ms, no tz) via the shared `TaskStatusService.planForEvening`, which
 * is already storage-agnostic via `IVaultAdapter`.
 */
export function createPlanForEveningService(
  vaultAdapter: IVaultAdapter,
  taskStatusService: TaskStatusService,
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolveTargetFile(vaultAdapter, targetIRI);
      await taskStatusService.planForEvening(targetFile);
    },
  };
}

/**
 * Populate a ServiceRegistry with fail-loud stubs for all well-known services.
 *
 * Pre-#2864 the stubs resolved silently, so `dyncommand exec` on service_call
 * groundings reported success without touching the vault — tests relying on
 * that path would pass while production behavior diverged. Post-fix each stub
 * throws `CliServiceNotImplementedError`, surfaced by `GroundingExecutor` as
 * `{success:false, error}`, which the CLI prints and returns non-zero exit.
 *
 * When `deps` is provided, real service implementations (starting with
 * `createRelatedTask`, #2865) are registered on top of the stubs. This keeps
 * `dyncommand validate` behavior stable (no deps required) while letting
 * `dyncommand exec` run real handlers against a vault on disk.
 */
export function populateCliServiceRegistry(
  registry: ServiceRegistry,
  deps?: CliServiceRegistryDeps,
): void {
  for (const id of CLI_STUB_SERVICE_IDS) {
    registry.register(id, notImplementedService(id));
  }

  if (deps) {
    registry.register(
      "createRelatedTask",
      createCreateRelatedTaskService(
        deps.vaultAdapter,
        deps.genericAssetCreationService,
      ),
    );
    registry.register(
      "createRelatedProject",
      createCreateRelatedProjectService(
        deps.vaultAdapter,
        deps.genericAssetCreationService,
      ),
    );
    registry.register(
      "archiveAsset",
      createArchiveAssetService(
        deps.vaultAdapter,
        deps.archiveAssetService,
      ),
    );
    registry.register(
      "planForEvening",
      createPlanForEveningService(
        deps.vaultAdapter,
        deps.taskStatusService,
      ),
    );
    registry.register(
      "cleanProperties",
      createCleanPropertiesService(
        deps.vaultAdapter,
        deps.propertyCleanupService,
      ),
    );
    registry.register(
      "renameToUid",
      createRenameToUidService(
        deps.vaultAdapter,
        deps.renameToUidService,
      ),
    );
    registry.register(
      "fixMissingLabel",
      createFixMissingLabelService(
        deps.vaultAdapter,
        deps.fixMissingLabelService,
      ),
    );
  }
}

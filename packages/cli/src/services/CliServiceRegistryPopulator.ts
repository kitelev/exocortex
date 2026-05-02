import {
  ServiceRegistry,
  type IGroundingService,
  type IVaultAdapter,
  GenericAssetCreationService,
  ArchiveAssetService,
  FixMissingLabelService,
  FolderRepairService,
  PropertyCleanupService,
  RenameToUidService,
  TaskStatusService,
} from "exocortex";
import {
  createCreateRelatedTaskService,
  createCreateRelatedProjectService,
  createArchiveAssetService,
  createCleanPropertiesService,
  createFixMissingLabelService,
  createRenameToUidService,
  createRepairFolderService,
  createPlanForEveningService,
} from "@kitelev/exocortex-services";

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
  folderRepairService: FolderRepairService;
}

/**
 * Re-export the storage-agnostic grounding-service factories from the shared
 * `@kitelev/exocortex-services` package (RFC 94e520da Phase 1, T1.2).
 *
 * Existing call sites — both internal (`populateCliServiceRegistry` below)
 * and external test imports — continue to work via this re-export. The
 * factory definitions themselves moved to `packages/services/src/` so the
 * plugin can adopt the same handlers in T1.3 without code duplication.
 */
export {
  createCreateRelatedTaskService,
  createCreateRelatedProjectService,
  createArchiveAssetService,
  createCleanPropertiesService,
  createFixMissingLabelService,
  createRenameToUidService,
  createRepairFolderService,
  createPlanForEveningService,
};

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
      createArchiveAssetService(deps.vaultAdapter, deps.archiveAssetService),
    );
    registry.register(
      "planForEvening",
      createPlanForEveningService(deps.vaultAdapter, deps.taskStatusService),
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
      createRenameToUidService(deps.vaultAdapter, deps.renameToUidService),
    );
    registry.register(
      "repairFolder",
      createRepairFolderService(deps.vaultAdapter, deps.folderRepairService),
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

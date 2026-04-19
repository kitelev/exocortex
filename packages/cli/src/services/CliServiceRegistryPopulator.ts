import {
  ServiceRegistry,
  type IGroundingService,
  type IVaultAdapter,
  type IFile,
  type UserInput,
  GenericAssetCreationService,
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
  }
}

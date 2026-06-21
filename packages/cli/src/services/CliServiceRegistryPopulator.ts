import {
  ServiceRegistry,
  FrontmatterService,
  type ClassRefResolver,
  type IFile,
  type IGroundingService,
  type IVaultAdapter,
  type IFileSystemAdapter,
  GenericAssetCreationService,
  ArchiveAssetService,
  FixMissingLabelService,
  FolderRepairService,
  PropertyCleanupService,
  RenameToUidService,
  TaskStatusService,
} from "@kitelev/exocortex-core";
import {
  createCreateAssetService,
  createCreateRelatedTaskService,
  createCreateRelatedProjectService,
  createArchiveAssetService,
  createCleanPropertiesService,
  createFixMissingLabelService,
  createRenameToUidService,
  createRepairFolderService,
  createPlanForEveningService,
  createUpdatePropertyService,
  createRemovePropertyService,
  createSetStatusService,
  type IPathResolver,
} from "@kitelev/exocortex-services";

const OBSIDIAN_VAULT_SCHEME = "obsidian://vault/";

/**
 * CLI implementation of `IPathResolver` used by the
 * `updateProperty`/`removeProperty`/`setStatus` factories (RFC 94e520da
 * Phase 1, T1.4).
 *
 * Resolution rules — in order:
 * 1. `obsidian://vault/<encoded>` URIs decode to a vault-relative path,
 *    matching the canonical `$target` IRI form built by `vaultPathToIRI`
 *    after the #2996 fix. The decoded path is returned verbatim — typically
 *    already includes `.md` because `dyncommand exec --target <path>` keeps
 *    the extension.
 * 2. UUID-shaped IRIs are resolved through
 *    `IFileSystemMetadataProvider.findFileByUID`, supporting tests and
 *    callers that pass a bare UUID.
 * 3. Anything else is treated as a vault-relative path; if it lacks a `.md`
 *    extension, it is appended (mirrors the legacy CLI behaviour for the
 *    historical path-based factories that did `${IRI}.md`).
 *
 * If the resolved candidate does not exist on disk we fall through to a
 * loud `Error` so callers see a named failure instead of a stale path.
 */
export function createCliPathResolver(
  fsAdapter: IFileSystemAdapter,
): IPathResolver {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return {
    async resolveTargetPath(targetIRI: string): Promise<string> {
      if (!targetIRI) {
        throw new Error("Cannot resolve empty targetIRI to a vault path");
      }
      let candidate = targetIRI;
      if (candidate.startsWith(OBSIDIAN_VAULT_SCHEME)) {
        candidate = decodeURI(candidate.slice(OBSIDIAN_VAULT_SCHEME.length));
      } else if (UUID_RE.test(candidate)) {
        const found = await fsAdapter.findFileByUID(candidate);
        if (!found) {
          throw new Error(`No vault file found for UID: ${candidate}`);
        }
        candidate = found;
      }
      if (!candidate.endsWith(".md")) {
        candidate = `${candidate}.md`;
      }
      if (!(await fsAdapter.fileExists(candidate))) {
        throw new Error(
          `Cannot resolve target file for IRI "${targetIRI}" (tried "${candidate}")`,
        );
      }
      return candidate;
    },
  };
}

/**
 * Well-known service IDs the plugin registers via ServiceRegistryPopulator.
 * CLI stubs exist so that `dyncommand validate` can verify grounding service
 * references point to a known service, and so that `dyncommand exec` fails
 * loudly instead of silently fake-succeeding.
 *
 * RFC 94e520da Phase 1, T1.4: `updateProperty`, `removeProperty`, `setStatus`
 * dropped from this list — they now have real CLI implementations through
 * the shared `@kitelev/exocortex-services` package and run end-to-end against
 * a vault on disk via {@link CliServiceRegistryDeps.fsAdapter}.
 *
 * The remaining 6 services are genuinely unsupported in CLI runtime:
 * - `openFile`, `getActiveFileIRI`, `getActiveFilePath` rely on Obsidian's
 *   workspace/active-file concept that has no CLI analogue.
 * - `sparqlSelect` would require porting plugin's SPARQLApi — separate issue.
 * - `trashFile` semantics (Obsidian trash) differ from `fs.unlink`; needs an
 *   adapter design before it can be safely shared.
 * - `duplicateFile` carries parent-context inheritance that currently reads
 *   `app.metadataCache`; porting awaits an Obsidian-free metadata abstraction.
 *
 * RFC v2 Phase 3.5 (Issue #3164, 2026-05-23): `createAsset` dropped from this
 * list — now has a real CLI implementation through the shared
 * `createCreateAssetService` factory (`@kitelev/exocortex-services`) that
 * mirrors the plugin's `ServiceRegistryPopulator.createAsset` handler
 * one-for-one (parent inheritance, area/parent detection, isDefinedBy
 * precedence). Phase 4b will remove both this CLI registration and the
 * plugin's parallel inlined handler once vault Groundings migrate from
 * `service_call createAsset` to declarative `create_instance` type.
 *
 * Issue #2518, #2864, #3164
 */
export const CLI_STUB_SERVICE_IDS = [
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
  /**
   * Path-based filesystem adapter (NodeFsAdapter in production) used by the
   * frontmatter-only handlers ported in T1.4: `updateProperty`,
   * `removeProperty`, `setStatus`. Optional so existing callers without
   * adapter wiring degrade to the fail-loud stubs only for those three
   * services.
   */
  fsAdapter?: IFileSystemAdapter;
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
  createCreateAssetService,
  createCreateRelatedTaskService,
  createCreateRelatedProjectService,
  createArchiveAssetService,
  createCleanPropertiesService,
  createFixMissingLabelService,
  createRenameToUidService,
  createRepairFolderService,
  createPlanForEveningService,
  createUpdatePropertyService,
  createRemovePropertyService,
  createSetStatusService,
};

/**
 * Build a `ClassRefResolver` (UUID → symbolic class label) backed by
 * `IVaultAdapter.getFirstLinkpathDest` + `getFrontmatter` (both sync, so the
 * resolver matches `WikiLinkHelpers.resolveSymbolic`'s sync contract).
 *
 * Mirrors the plugin's `createMetadataClassResolver`
 * (`ServiceRegistryPopulator.ts`) which reads Obsidian's `metadataCache`.
 * `FileSystemVaultAdapter` builds a UUID index lazily on first lookup, so
 * subsequent calls within one CLI session are O(1).
 *
 * Used by `createAsset` (Phase 3.5) to detect Area parents when
 * `exo__Instance_class` stores UID-canon refs (`[[<uuid>]]`). Symbolic refs
 * (`[[ems__Area]]`) bypass the resolver via `WikiLinkHelpers.resolveSymbolic`.
 */
export function createCliClassResolver(
  vaultAdapter: IVaultAdapter,
): ClassRefResolver {
  return (uuid: string): string | null => {
    const target = vaultAdapter.getFirstLinkpathDest(uuid, "");
    if (!target || !("basename" in target)) return null;
    const meta = vaultAdapter.getFrontmatter(target as IFile);
    const label = meta?.exo__Asset_label;
    return typeof label === "string" && label.length > 0 ? label : null;
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

  // T1.4 + Phase 3.5: handlers requiring fsAdapter registered as fail-loud
  // stubs when no fsAdapter is wired (e.g. `dyncommand validate`). With
  // fsAdapter the real shared-package factories below replace these stubs.
  for (const id of [
    "updateProperty",
    "removeProperty",
    "setStatus",
    "createAsset",
  ] as const) {
    registry.register(id, notImplementedService(id));
  }

  if (deps) {
    if (deps.fsAdapter) {
      const frontmatterService = new FrontmatterService();
      const pathResolver = createCliPathResolver(deps.fsAdapter);
      registry.register(
        "updateProperty",
        createUpdatePropertyService(
          deps.fsAdapter,
          frontmatterService,
          pathResolver,
        ),
      );
      registry.register(
        "removeProperty",
        createRemovePropertyService(
          deps.fsAdapter,
          frontmatterService,
          pathResolver,
        ),
      );
      registry.register(
        "setStatus",
        createSetStatusService(
          deps.fsAdapter,
          frontmatterService,
          pathResolver,
        ),
      );

      // RFC v2 Phase 3.5 (Issue #3164): real `createAsset` handler replaces
      // the legacy CliServiceNotImplementedError stub. Mirrors the plugin's
      // inlined handler in `ServiceRegistryPopulator.createAsset`
      // (parent-context inheritance, area-vs-parent detection via class
      // resolver, isDefinedBy precedence chain). Requires both fsAdapter
      // (for `createFile`) and vaultAdapter (for parent metadata + UID-canon
      // class resolution); when fsAdapter is absent the stub remains.
      registry.register(
        "createAsset",
        createCreateAssetService(
          deps.vaultAdapter,
          deps.fsAdapter,
          createCliClassResolver(deps.vaultAdapter),
        ),
      );
    }

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

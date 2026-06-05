/**
 * @kitelev/exocortex-services — shared grounding-service factories.
 *
 * This package hosts the runtime-agnostic factory functions that build
 * `IGroundingService` instances dispatched by `GroundingExecutor` for
 * `service_call` groundings (RFC 94e520da Phase 1).
 *
 * Both runtimes consume the same factories:
 * - CLI (`@kitelev/exocortex-cli`) — wired via `CliServiceRegistryPopulator`,
 *   adapter is `NodeVaultAdapter` over fs/promises.
 * - Plugin (`@exocortex/obsidian-plugin`) — wired via `ServiceRegistryPopulator`,
 *   adapter is `ObsidianVaultAdapter` over Obsidian's `app.vault` API.
 *
 * Domain services themselves continue to live in the shared `exocortex`
 * package; this package only provides the thin `IVaultAdapter`-aware
 * grounding-handler shells that bridge them to the registry contract.
 *
 * Both the CLI- and plugin-side migrations are complete: the storage-agnostic
 * factories live here and are consumed by both runtimes (RFC 94e520da Phase 1
 * T1.2 + T1.3; legacy plugin TS handlers removed in Phase 4b, issue #3166).
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
  createDuplicateAssetService,
  rewriteFrontmatterScalars,
  createPathBasedTargetResolver,
  type ITargetResolver,
  type IPathResolver,
} from "./grounding-service-factories";

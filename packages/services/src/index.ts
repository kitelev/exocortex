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
 * - Plugin (`@exocortex/obsidian-plugin`) — to be migrated in T1.3, adapter
 *   will be `ObsidianVaultAdapter` over Obsidian's `app.vault` API.
 *
 * Domain services themselves continue to live in the shared `exocortex`
 * package; this package only provides the thin `IVaultAdapter`-aware
 * grounding-handler shells that bridge them to the registry contract.
 *
 * Scope of T1.2 (this PR): the 8 storage-agnostic CLI-side factories are
 * moved here. Plugin-side migration of the remaining handlers (UI tab open,
 * SPARQL invocation, status workflow, voting, etc.) is tracked under T1.3 +
 * follow-up tickets per RFC § Phase 1 plan.
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

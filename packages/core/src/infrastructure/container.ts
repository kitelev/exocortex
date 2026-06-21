import "reflect-metadata";
import { container, DependencyContainer } from "tsyringe";
import { DI_TOKENS } from "../interfaces/tokens";

// Import all services
import { DynamicFrontmatterGenerator } from "../services/DynamicFrontmatterGenerator";
import { AlgorithmExtractor } from "../services/AlgorithmExtractor";
import { PropertyCleanupService } from "../services/PropertyCleanupService";
import { AreaCreationService } from "../services/AreaCreationService";
import { TaskStatusService } from "../services/TaskStatusService";
import { EffortStatusWorkflow } from "../services/EffortStatusWorkflow";
import { StatusTimestampService } from "../services/StatusTimestampService";
import { FolderRepairService } from "../services/FolderRepairService";
import { RenameToUidService } from "../services/RenameToUidService";
import { EffortVotingService } from "../services/EffortVotingService";
import { PlanningService } from "../services/PlanningService";
import { SessionEventService } from "../services/SessionEventService";
import { AssetConversionService } from "../services/AssetConversionService";
import { ClassCreationService } from "../services/ClassCreationService";
import { ConceptCreationService } from "../services/ConceptCreationService";
import { SupervisionCreationService } from "../services/SupervisionCreationService";
import { NoteToRDFConverter } from "../services/NoteToRDFConverter";
import { AreaHierarchyBuilder } from "../services/AreaHierarchyBuilder";
import { URIConstructionService } from "../services/URIConstructionService";
import { GenericAssetCreationService } from "../services/GenericAssetCreationService";
import { CriticalityZoneService } from "../services/CriticalityZoneService";
import { VaultSettings } from "../services/VaultSettings";

/**
 * Register all core services with the DI container.
 * Services are registered with their corresponding tokens for interface-based injection.
 *
 * @param childContainer - Optional child container. If not provided, uses global container.
 */
export function registerCoreServices(
  childContainer?: DependencyContainer,
): void {
  const targetContainer = childContainer || container;

  // Frontmatter services (no dependencies)
  targetContainer.registerSingleton(
    DI_TOKENS.DynamicFrontmatterGenerator,
    DynamicFrontmatterGenerator,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.AlgorithmExtractor,
    AlgorithmExtractor,
  );

  // Vault settings — register a default instance only if the plugin layer
  // hasn't already provided a configured one.
  if (!targetContainer.isRegistered(DI_TOKENS.IVaultSettings)) {
    targetContainer.register(DI_TOKENS.IVaultSettings, {
      useValue: new VaultSettings(),
    });
  }

  // Status workflow (no dependencies)
  targetContainer.registerSingleton(
    DI_TOKENS.EffortStatusWorkflow,
    EffortStatusWorkflow,
  );

  // Status services (depend on IVaultAdapter)
  targetContainer.registerSingleton(
    DI_TOKENS.StatusTimestampService,
    StatusTimestampService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.TaskStatusService,
    TaskStatusService,
  );

  // Creation services (depend on IVaultAdapter)
  targetContainer.registerSingleton(
    DI_TOKENS.AreaCreationService,
    AreaCreationService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.ClassCreationService,
    ClassCreationService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.ConceptCreationService,
    ConceptCreationService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.SupervisionCreationService,
    SupervisionCreationService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.GenericAssetCreationService,
    GenericAssetCreationService,
  );

  // Utility services (depend on IVaultAdapter)
  targetContainer.registerSingleton(
    DI_TOKENS.PropertyCleanupService,
    PropertyCleanupService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.FolderRepairService,
    FolderRepairService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.RenameToUidService,
    RenameToUidService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.PlanningService,
    PlanningService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.EffortVotingService,
    EffortVotingService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.SessionEventService,
    SessionEventService,
  );

  // Conversion services (depend on IVaultAdapter)
  targetContainer.registerSingleton(
    DI_TOKENS.AssetConversionService,
    AssetConversionService,
  );
  targetContainer.registerSingleton(
    DI_TOKENS.NoteToRDFConverter,
    NoteToRDFConverter,
  );

  // Query services (depend on IVaultAdapter)
  targetContainer.registerSingleton(
    DI_TOKENS.AreaHierarchyBuilder,
    AreaHierarchyBuilder,
  );

  // URI Construction (depends on IFileSystemAdapter)
  targetContainer.registerSingleton(
    DI_TOKENS.URIConstructionService,
    URIConstructionService,
  );

  // Task planning services (depend on IVaultAdapter)
  targetContainer.registerSingleton(
    DI_TOKENS.CriticalityZoneService,
    CriticalityZoneService,
  );
}

/**
 * Create a child container for isolated testing or scoped instances.
 * Child containers inherit registrations from parent but can override them.
 *
 * @returns A new child container
 */
export function createChildContainer(): DependencyContainer {
  return container.createChildContainer();
}

/**
 * Get the global container instance.
 * Use this for application-level service resolution.
 *
 * @returns The global DI container
 */
export function getContainer(): DependencyContainer {
  return container;
}

/**
 * Reset the container by clearing all registrations.
 * Useful for testing to ensure clean state between tests.
 */
export function resetContainer(): void {
  container.reset();
}

export { container };
export type { DependencyContainer };

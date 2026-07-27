/**
 * Dependency Injection Tokens
 * Symbol-based tokens for TSyringe container registration
 *
 * Categories:
 * - Infrastructure adapters: Storage and vault access
 * - Cross-cutting concerns: Logging, events, configuration
 * - Creation services: Asset/entity creation
 * - Status services: Workflow and status management
 * - Utility services: Property cleanup, folder repair, etc.
 * - Query services: Hierarchy builders, URI construction
 */

export const DI_TOKENS = {
  // Infrastructure adapters
  IFileSystemAdapter: Symbol.for("IFileSystemAdapter"),
  IVaultAdapter: Symbol.for("IVaultAdapter"),

  // Multi-vault support
  IVaultContext: Symbol.for("IVaultContext"),
  IMultiVaultManager: Symbol.for("IMultiVaultManager"),

  // Cross-cutting concerns
  ILogger: Symbol.for("ILogger"),
  IEventBus: Symbol.for("IEventBus"),
  IConfiguration: Symbol.for("IConfiguration"),
  INotificationService: Symbol.for("INotificationService"),

  // Creation services
  ClassCreationService: Symbol.for("ClassCreationService"),
  ConceptCreationService: Symbol.for("ConceptCreationService"),
  GenericAssetCreationService: Symbol.for("GenericAssetCreationService"),

  // Status services
  TaskStatusService: Symbol.for("TaskStatusService"),
  EffortStatusWorkflow: Symbol.for("EffortStatusWorkflow"),
  StatusTimestampService: Symbol.for("StatusTimestampService"),

  // Utility services
  PropertyCleanupService: Symbol.for("PropertyCleanupService"),
  FolderRepairService: Symbol.for("FolderRepairService"),
  RenameToUidService: Symbol.for("RenameToUidService"),

  // Conversion services
  NoteToRDFConverter: Symbol.for("NoteToRDFConverter"),

  // Vault settings
  IVaultSettings: Symbol.for("IVaultSettings"),

  // Query services
  AreaHierarchyBuilder: Symbol.for("AreaHierarchyBuilder"),
  ClassHierarchyResolver: Symbol.for("ClassHierarchyResolver"),

} as const;

export type DIToken = (typeof DI_TOKENS)[keyof typeof DI_TOKENS];

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
  TaskCreationService: Symbol.for("TaskCreationService"),
  ProjectCreationService: Symbol.for("ProjectCreationService"),
  AreaCreationService: Symbol.for("AreaCreationService"),
  ClassCreationService: Symbol.for("ClassCreationService"),
  ConceptCreationService: Symbol.for("ConceptCreationService"),
  FleetingNoteCreationService: Symbol.for("FleetingNoteCreationService"),
  SupervisionCreationService: Symbol.for("SupervisionCreationService"),

  // Frontmatter services
  TaskFrontmatterGenerator: Symbol.for("TaskFrontmatterGenerator"),
  DynamicFrontmatterGenerator: Symbol.for("DynamicFrontmatterGenerator"),
  AlgorithmExtractor: Symbol.for("AlgorithmExtractor"),

  // Status services
  TaskStatusService: Symbol.for("TaskStatusService"),
  EffortStatusWorkflow: Symbol.for("EffortStatusWorkflow"),
  StatusTimestampService: Symbol.for("StatusTimestampService"),

  // Utility services
  PropertyCleanupService: Symbol.for("PropertyCleanupService"),
  FolderRepairService: Symbol.for("FolderRepairService"),
  LabelToAliasService: Symbol.for("LabelToAliasService"),
  RenameToUidService: Symbol.for("RenameToUidService"),
  PlanningService: Symbol.for("PlanningService"),
  EffortVotingService: Symbol.for("EffortVotingService"),
  SessionEventService: Symbol.for("SessionEventService"),

  // Conversion services
  AssetConversionService: Symbol.for("AssetConversionService"),
  NoteToRDFConverter: Symbol.for("NoteToRDFConverter"),

  // Query services
  AreaHierarchyBuilder: Symbol.for("AreaHierarchyBuilder"),
  URIConstructionService: Symbol.for("URIConstructionService"),
} as const;

export type DIToken = (typeof DI_TOKENS)[keyof typeof DI_TOKENS];

// Domain exports
export * from "./domain/constants/AssetClass";
export * from "./domain/constants/EffortStatus";
export * from "./domain/models/GraphNode";
export * from "./domain/models/GraphData";
export * from "./domain/models/GraphEdge";
export * from "./domain/models/AreaNode";
export * from "./domain/models/rdf";
export * from "./domain/commands/CommandVisibility";
export type { IPropertyValidationService, ValidationResult } from "./domain/services/IPropertyValidationService";

// Property definition types
export {
  PropertyFieldType,
  rangeToFieldType,
} from "./domain/types/PropertyFieldType";
export {
  type PropertyDefinition,
  type PropertyOption,
  propertyNameToUri,
  uriToPropertyName,
  extractPropertyLabel,
} from "./domain/types/PropertyDefinition";

// Services exports
export { TaskCreationService } from "./services/TaskCreationService";
export { ProjectCreationService } from "./services/ProjectCreationService";
export { TaskStatusService } from "./services/TaskStatusService";
export { AreaCreationService } from "./services/AreaCreationService";
export {
  AreaHierarchyBuilder,
  type AssetRelation,
} from "./services/AreaHierarchyBuilder";
export { ClassCreationService } from "./services/ClassCreationService";
export { ConceptCreationService } from "./services/ConceptCreationService";
export { EffortStatusWorkflow } from "./services/EffortStatusWorkflow";
export { EffortVotingService } from "./services/EffortVotingService";
export { FolderRepairService } from "./services/FolderRepairService";
export { LabelToAliasService } from "./services/LabelToAliasService";
export { LoggingService } from "./services/LoggingService";
export { PropertyCleanupService } from "./services/PropertyCleanupService";
export { RenameToUidService } from "./services/RenameToUidService";
export { StatusTimestampService } from "./services/StatusTimestampService";
export { SupervisionCreationService } from "./services/SupervisionCreationService";
export { FleetingNoteCreationService } from "./services/FleetingNoteCreationService";
export { TaskFrontmatterGenerator } from "./services/TaskFrontmatterGenerator";
export {
  DynamicFrontmatterGenerator,
  type LegacyPropertyFieldType,
  type FrontmatterPropertyDefinition,
} from "./services/DynamicFrontmatterGenerator";
export { AlgorithmExtractor } from "./services/AlgorithmExtractor";
export { PlanningService } from "./services/PlanningService";
export { AssetConversionService } from "./services/AssetConversionService";
export { SessionEventService } from "./services/SessionEventService";
export { URIConstructionService } from "./services/URIConstructionService";
export type {
  URIConstructionOptions,
  AssetMetadata,
} from "./services/URIConstructionService";

// Utilities exports
export { FrontmatterService } from "./utilities/FrontmatterService";
export { DateFormatter } from "./utilities/DateFormatter";
export { WikiLinkHelpers } from "./utilities/WikiLinkHelpers";
export { MetadataHelpers } from "./utilities/MetadataHelpers";
export { MetadataExtractor } from "./utilities/MetadataExtractor";
export { EffortSortingHelpers } from "./utilities/EffortSortingHelpers";
export {
  FilenameValidator,
  type FilenameValidationResult,
  type FilenameValidationOptions,
} from "./utilities/FilenameValidator";

// Infrastructure exports
export {
  RDFSerializer,
  type RDFSerializationFormat,
  type RDFSerializeOptions,
  type RDFStreamOptions,
  type RDFDeserializeOptions,
} from "./infrastructure/rdf/RDFSerializer";
export { InMemoryTripleStore } from "./infrastructure/rdf/InMemoryTripleStore";
export { RDFVocabularyMapper } from "./infrastructure/rdf/RDFVocabularyMapper";
export { NoteToRDFConverter } from "./services/NoteToRDFConverter";

// SPARQL Engine exports
export { SPARQLParser, SPARQLParseError, type SPARQLQuery, type SelectQuery, type ConstructQuery } from "./infrastructure/sparql/SPARQLParser";
export { AlgebraTranslator } from "./infrastructure/sparql/algebra/AlgebraTranslator";
export { AlgebraOptimizer } from "./infrastructure/sparql/algebra/AlgebraOptimizer";
export { AlgebraSerializer } from "./infrastructure/sparql/algebra/AlgebraSerializer";
export type {
  AlgebraOperation,
  BGPOperation,
  ConstructOperation,
  Triple as AlgebraTriple,
} from "./infrastructure/sparql/algebra/AlgebraOperation";
export { BGPExecutor } from "./infrastructure/sparql/executors/BGPExecutor";
export { FilterExecutor } from "./infrastructure/sparql/executors/FilterExecutor";
export { OptionalExecutor } from "./infrastructure/sparql/executors/OptionalExecutor";
export { UnionExecutor } from "./infrastructure/sparql/executors/UnionExecutor";
export { ConstructExecutor } from "./infrastructure/sparql/executors/ConstructExecutor";
export { DescribeExecutor } from "./infrastructure/sparql/executors/DescribeExecutor";
export { QueryExecutor } from "./infrastructure/sparql/executors/QueryExecutor";
export { SolutionMapping } from "./infrastructure/sparql/SolutionMapping";
export { BuiltInFunctions } from "./infrastructure/sparql/filters/BuiltInFunctions";
export { AggregateFunctions } from "./infrastructure/sparql/aggregates/AggregateFunctions";
export { QueryPlanCache } from "./infrastructure/sparql/cache/QueryPlanCache";
export { CaseWhenTransformer, CaseWhenTransformerError } from "./infrastructure/sparql/CaseWhenTransformer";
export {
  FilterContainsOptimizer,
  type ContainsUUIDPattern,
  type OptimizationHint,
} from "./infrastructure/sparql/optimization/FilterContainsOptimizer";

// Interfaces exports
export type {
  IFileSystemAdapter,
  IFileSystemReader,
  IFileSystemWriter,
  IFileSystemMetadataProvider,
  IFileSystemDirectoryManager,
} from "./interfaces/IFileSystemAdapter";
export {
  FileNotFoundError,
  FileAlreadyExistsError,
} from "./interfaces/IFileSystemAdapter";
export type {
  IVaultAdapter,
  IVaultFileReader,
  IVaultFileWriter,
  IVaultFileRenamer,
  IVaultFolderManager,
  IVaultFrontmatterManager,
  IVaultLinkResolver,
  IFile,
  IFileStat,
  IFolder,
  IFrontmatter,
} from "./interfaces/IVaultAdapter";
export type { IVaultContext } from "./interfaces/IVaultContext";
export type {
  IMultiVaultManager,
  VaultChangeCallback,
} from "./interfaces/IMultiVaultManager";

// DI Interfaces exports
export type { ILogger } from "./interfaces/ILogger";
export type { IEventBus } from "./interfaces/IEventBus";
export type { IConfiguration } from "./interfaces/IConfiguration";
export type { INotificationService } from "./interfaces/INotificationService";
export { DI_TOKENS, type DIToken } from "./interfaces/tokens";

// DI Container exports
export {
  registerCoreServices,
  createChildContainer,
  getContainer,
  resetContainer,
  container,
  type DependencyContainer,
} from "./infrastructure/container";

// Types exports
export type { SupervisionFormData } from "./types/SupervisionFormData";

// Error exports
export * from "./domain/errors";
export * from "./application/errors";

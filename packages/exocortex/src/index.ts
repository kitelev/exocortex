// Domain exports
export * from "./domain/constants/AssetClass";
export * from "./domain/constants/EffortStatus";
export {
  type EffortStatusName,
  EFFORT_STATUS_CONFIG,
  STATUS_NAME_TO_ENUM,
  STATUS_NAME_TO_WIKILINK,
  EFFORT_STATUS_OPTIONS,
  normalizeEffortStatus,
  isDoneStatus,
  isTrashedStatus,
  getEffortStatusLabel,
} from "./domain/constants/EffortStatusConfig";
export { GroundingType } from "./domain/constants/GroundingType";
export {
  CommandProperty,
  PreconditionProperty,
  GroundingProperty,
  CommandBindingProperty,
  CommandBindingStyleProperty,
} from "./domain/constants/CommandProperty";
export {
  type CommandVariant,
  type LabelClass,
  type StyleSource,
  COMMAND_VARIANT_VALUES,
  LABEL_CLASS_VALUES,
  STYLE_SOURCE_VALUES,
  isCommandVariant,
  isLabelClass,
  isStyleSource,
} from "./domain/constants/CommandBindingStyleEnums";
export type {
  CommandDefinition,
  PreconditionDefinition,
  GroundingDefinition,
  CommandBindingDefinition,
} from "./domain/models/CommandDefinition";
export {
  isCommandFrontmatter,
  isPreconditionFrontmatter,
  isGroundingFrontmatter,
  isCommandBindingFrontmatter,
} from "./domain/models/CommandDefinition";
export * from "./domain/models/GraphNode";
export * from "./domain/models/GraphData";
export * from "./domain/models/GraphEdge";
export * from "./domain/models/GraphTypes";
export * from "./domain/models/AreaNode";
export * from "./domain/models/rdf";
export * from "./domain/models/exo003";
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
export { CommandResolver, type ResolvedCommand } from "./services/CommandResolver";
export {
  PreconditionEvaluator,
  type EvalContext,
  type HostFunction,
} from "./services/PreconditionEvaluator";
export {
  GroundingExecutor,
  ServiceRegistry,
  type ExecutionResult,
  type UserInput,
  type IGroundingService,
} from "./services/GroundingExecutor";
export { TaskStatusService } from "./services/TaskStatusService";
export { AreaCreationService } from "./services/AreaCreationService";
export {
  AreaHierarchyBuilder,
  type AssetRelation,
} from "./services/AreaHierarchyBuilder";
export { ClassCreationService } from "./services/ClassCreationService";
export { ConceptCreationService } from "./services/ConceptCreationService";
export { EffortStatusWorkflow } from "./services/EffortStatusWorkflow";
export { WorkflowEngine } from "./services/WorkflowEngine";
export type { WorkflowValidationResult } from "./services/WorkflowEngine";
export { WorkflowResolver } from "./services/WorkflowResolver";
export { InstantiationRuleResolver } from "./services/InstantiationRuleResolver";
export type { InstantiationRule, PropertySetRule } from "./services/InstantiationRuleResolver";
export { VisibilityGenerator } from "./services/VisibilityGenerator";
export type { VisibleCommand } from "./services/VisibilityGenerator";
export { WorkflowCommandAdapter } from "./services/WorkflowCommandAdapter";
export type {
  WorkflowDefinition,
  WorkflowStateDefinition,
  WorkflowTransitionDefinition,
} from "./domain/models/WorkflowDefinition";
export { EffortVotingService } from "./services/EffortVotingService";
export { FolderRepairService } from "./services/FolderRepairService";
export { LabelToAliasService } from "./services/LabelToAliasService";
export { LoggingService } from "./services/LoggingService";
export { PropertyCleanupService } from "./services/PropertyCleanupService";
export { RenameToUidService } from "./services/RenameToUidService";
export { StatusTimestampService } from "./services/StatusTimestampService";
export { SupervisionCreationService } from "./services/SupervisionCreationService";
export { FleetingNoteCreationService } from "./services/FleetingNoteCreationService";
export {
  DynamicFrontmatterGenerator,
  type FrontmatterPropertyDefinition,
} from "./services/DynamicFrontmatterGenerator";
export { AlgorithmExtractor } from "./services/AlgorithmExtractor";
export { PlanningService } from "./services/PlanningService";
export {
  PropertySchemaResolver,
  type PropertySchema,
  type PropertySchemaOption,
  type PropertySchemaValidation,
  type ISPARQLQueryable,
} from "./services/PropertySchemaResolver";
export { ClassHierarchyResolver } from "./services/ClassHierarchyResolver";
export {
  EnumValueResolver,
  type EnumValue,
} from "./services/EnumValueResolver";
export { AssetConversionService } from "./services/AssetConversionService";
export { SessionEventService } from "./services/SessionEventService";
export { URIConstructionService } from "./services/URIConstructionService";
export {
  GenericAssetCreationService,
  type GenericAssetCreationConfig,
  type AssetPropertyDefinition,
} from "./services/GenericAssetCreationService";
export { ArchiveAssetService } from "./services/ArchiveAssetService";
export type {
  URIConstructionOptions,
  AssetMetadata,
} from "./services/URIConstructionService";
export {
  GraphQueryService,
  type GraphQueryServiceConfig,
} from "./services/GraphQueryService";
export {
  TypeRegistry,
  type TypeRegistryConfig,
} from "./services/TypeRegistry";
export {
  NLToSPARQLService,
  type NLToSPARQLConfig,
  type NLToSPARQLResult,
  DEFAULT_NL_TO_SPARQL_CONFIG,
} from "./services/NLToSPARQLService";
export {
  SPARQL_TEMPLATES,
  SPARQL_PREFIXES,
  PREDICATES,
  ASSET_CLASSES,
  EFFORT_STATUSES,
  KNOWN_PROTOTYPES,
  KNOWN_CLASSES,
  findClassByTerm,
  type KnownClass,
  findMatchingTemplates,
  fillTemplate,
  validateParameters,
  getTemplateByName,
  type SPARQLTemplate,
} from "./services/SPARQLTemplateLibrary";
export {
  AnalyticsService,
  type AnalyticsPeriod,
  type DurationStats,
  type DailyAggregate,
  type HourlyDistribution,
  type SleepAnalysis,
  type TaskCompletionAnalysis,
  type ActivityFrequencyAnalysis,
  type EffortData,
} from "./services/AnalyticsService";
export {
  TrendDetectionService,
  type TrendDirection,
  type TrendStrength,
  type TrendAnalysis,
  type Anomaly,
  type CorrelationResult,
  type WeeklyPattern,
  type BehavioralInsight,
} from "./services/TrendDetectionService";
export {
  AutocompleteService,
  type AutocompleteSuggestion,
  type AutocompleteConfig,
  DEFAULT_AUTOCOMPLETE_CONFIG,
} from "./services/AutocompleteService";
export {
  DailyReviewService,
  type Practice,
  type DailyReviewSummary,
  type QuickCaptureResult,
  type CreateFromPracticeOptions,
} from "./services/DailyReviewService";
export {
  CriticalityZoneService,
  CriticalityZoneUUIDs,
  type CriticalityZone,
} from "./services/CriticalityZoneService";

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
export { NullLogger } from "./infrastructure/NullLogger";
export { InMemoryTripleStore } from "./infrastructure/rdf/InMemoryTripleStore";
export { RDFVocabularyMapper } from "./infrastructure/rdf/RDFVocabularyMapper";
export { RDFSInferenceEngine } from "./infrastructure/rdf/RDFSInferenceEngine";
export { NonInheritablePropertyRegistry } from "./services/NonInheritablePropertyRegistry";
export { PropertyCardinalityRegistry } from "./services/PropertyCardinalityRegistry";
export { PrototypeChainMaterializer, INFERRED_GRAPH } from "./services/PrototypeChainMaterializer";
export { SourceAnnotator, SOURCE_VARIABLE, type TripleSource } from "./services/SourceAnnotator";
export { NoteToRDFConverter } from "./services/NoteToRDFConverter";

// SPARQL Engine exports
export { ExoQLParser, SPARQLParser, SPARQLParseError, type SPARQLQuery, type SelectQuery, type ConstructQuery, type Update, type UpdateOperation, type ExtendedDescribeQuery, type ParseResult } from "./infrastructure/sparql/SPARQLParser";
export { DescribeOptionsTransformer, DescribeOptionsTransformerError, type DescribeOptions, type DescribeTransformResult } from "./infrastructure/sparql/DescribeOptionsTransformer";
export { ExoQLAlgebraTranslator, AlgebraTranslator } from "./infrastructure/sparql/algebra/AlgebraTranslator";
export { AlgebraOptimizer } from "./infrastructure/sparql/algebra/AlgebraOptimizer";
export { AlgebraSerializer } from "./infrastructure/sparql/algebra/AlgebraSerializer";
export type {
  AlgebraOperation,
  BGPOperation,
  ConstructOperation,
  DescribeOperation,
  Triple as AlgebraTriple,
} from "./infrastructure/sparql/algebra/AlgebraOperation";
export { BGPExecutor } from "./infrastructure/sparql/executors/BGPExecutor";
export { FilterExecutor } from "./infrastructure/sparql/executors/FilterExecutor";
export { OptionalExecutor } from "./infrastructure/sparql/executors/OptionalExecutor";
export { UnionExecutor } from "./infrastructure/sparql/executors/UnionExecutor";
export { ConstructExecutor } from "./infrastructure/sparql/executors/ConstructExecutor";
export { DescribeExecutor, type DescribeExecutorOptions } from "./infrastructure/sparql/executors/DescribeExecutor";
export { ExoQLQueryExecutor, QueryExecutor } from "./infrastructure/sparql/executors/QueryExecutor";
export { UpdateExecutor, UpdateExecutorError, type UpdateResult } from "./infrastructure/sparql/executors/UpdateExecutor";
export { SolutionMapping } from "./infrastructure/sparql/SolutionMapping";
export { BuiltInFunctions } from "./infrastructure/sparql/filters/BuiltInFunctions";
export { AggregateFunctions } from "./infrastructure/sparql/aggregates/AggregateFunctions";
export {
  CustomAggregateRegistry,
  CustomAggregateError,
  type CustomAggregate,
  type AggregateState,
  type Term as AggregateTerm,
} from "./infrastructure/sparql/aggregates/CustomAggregateRegistry";
export {
  BUILT_IN_AGGREGATES,
  EXO_AGGREGATE_NS,
  medianAggregate,
  varianceAggregate,
  stddevAggregate,
  modeAggregate,
  createPercentileAggregate,
  getNumericValue,
  createDecimalLiteral,
  createDoubleLiteral,
} from "./infrastructure/sparql/aggregates/BuiltInAggregates";
export { QueryPlanCache } from "./infrastructure/sparql/cache/QueryPlanCache";
export {
  SPARQLResultCache,
  createSPARQLResultCache,
  type SPARQLResultCacheOptions,
  type SPARQLResultCacheStats,
  type CacheableResult,
} from "./infrastructure/sparql/cache/SPARQLResultCache";
export {
  IncrementalIndexer,
  createIncrementalIndexer,
  type IncrementalIndexerOptions,
  type IncrementalIndexerStats,
  type FileChange,
  type ChangeType,
} from "./infrastructure/sparql/cache/IncrementalIndexer";
export {
  ResultSerializer,
  type ResultOutputFormat,
  type ResultSerializeOptions,
  type JSONResultBinding,
  type JSONResultSet,
} from "./infrastructure/sparql/serializers/ResultSerializer";
export { CaseWhenTransformer, CaseWhenTransformerError } from "./infrastructure/sparql/CaseWhenTransformer";
export { VaultPrefixTransformer } from "./infrastructure/sparql/VaultPrefixTransformer";
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
export type {
  ITripleStore,
  ITransaction,
  GraphName,
} from "./interfaces/ITripleStore";
export {
  TripleAlreadyExistsError,
  TripleNotFoundError,
  TransactionError,
} from "./interfaces/ITripleStore";

// DI Interfaces exports
export type { ILogger } from "./interfaces/ILogger";
export type { IEventBus } from "./interfaces/IEventBus";
export type { IConfiguration } from "./interfaces/IConfiguration";
export type { IVaultSettings } from "./interfaces/IVaultSettings";
export {
  VaultSettings,
  DEFAULT_OWNER_IDENTITY,
  DEFAULT_INBOX_FOLDER,
  DEFAULT_FLEETING_NOTE_CLASS_UID,
  type VaultSettingsConfig,
} from "./services/VaultSettings";
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

// Memory management exports
export {
  // Types
  NODE_FLAGS,
  DEFAULT_COLORS,
  // StringTable
  StringTable,
  // CompactGraphStore
  CompactGraphStore,
  // MemoryPool
  MemoryPool,
  getGlobalPool,
  resetGlobalPool,
  // StreamingLoader
  StreamingLoader,
  createStreamingSource,
} from "./infrastructure/memory";

export type {
  CompactNodeData,
  CompactEdgeData,
  CompactGraphStoreConfig,
  MemoryStats,
  NodeUpdate,
  BatchUpdateResult,
  ChunkNode,
  ChunkEdge,
  GraphChunk,
  StreamingProgressEvent,
  StreamingProgressCallback,
  MemoryPoolConfig,
  PoolStats,
  StreamingLoaderConfig,
  LoaderState,
} from "./infrastructure/memory";

// ExoQL public API
export { ExoQL, ExoQLError, type OwnFilterConfig } from "./exoql";

// Error exports
export * from "./domain/errors";
export * from "./application/errors";

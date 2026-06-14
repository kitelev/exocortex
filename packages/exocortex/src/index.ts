// Domain exports
export * from "./domain/constants/AssetClass";
export * from "./domain/constants/EffortStatus";
export { EFFORT_STATUS_OPTIONS } from "./domain/constants/EffortStatusOptions";
export { GroundingType } from "./domain/constants/GroundingType";
export {
  GROUNDING_TYPE_UIDS,
  GROUNDING_TYPE_UID_TO_ENUM,
  GROUNDING_TYPE_IRI_TO_ENUM,
  resolveGroundingTypeFromIRI,
  resolveGroundingTypeFromWikilinkLiteral,
} from "./domain/constants/GroundingTypeUIDs";
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
  PropertyDefaultResolved,
  InheritanceRuleResolved,
} from "./domain/models/CommandDefinition";
export {
  isCommandFrontmatter,
  isPreconditionFrontmatter,
  isGroundingFrontmatter,
  isCommandBindingFrontmatter,
} from "./domain/models/CommandDefinition";
export { parseGroundingDefinitionFromFrontmatter } from "./domain/models/GroundingFrontmatterParser";
export * from "./domain/models/GraphNode";
export * from "./domain/models/GraphData";
export * from "./domain/models/GraphEdge";
export * from "./domain/models/GraphTypes";
export * from "./domain/models/AreaNode";
export * from "./domain/models/rdf";
export * from "./domain/models/exo003";
export * from "./domain/commands/visibility";
export {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  SDK_FLOOR_ASSETSPACE_UIDS,
  PLUGIN_UI_FLOOR_ASSETSPACE_UIDS,
  SDK_FLOOR,
  PLUGIN_UI_FLOOR,
  CATALOG_KEEP_NAMESPACES,
  TsFloorViolationError,
  assertTsFloor,
  assertTsFloorReconciled,
} from "./domain/profile/TsFloorGuard";
export type { FloorIdentity } from "./domain/profile/TsFloorGuard";
export { transitiveDependsOnClosure } from "./domain/profile/AssetSpaceDependsOn";
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
  hasNonUidFilename,
  hasUidFilename,
  registerDefaultHostFunctions,
} from "./services/preconditionHostFunctions";
export {
  GroundingExecutor,
  ServiceRegistry,
  type ExecutionResult,
  type UserInput,
  type IGroundingService,
  type ClassLabelToUidResolver,
} from "./services/GroundingExecutor";
export { createVaultFrontmatterClassLabelResolver } from "./services/VaultFrontmatterClassLabelResolver";
export {
  NamedQueryRunner,
  type NamedQueryRunnerPort,
  type NamedQueryContext,
  type NamedQueryParam,
  type NamedQueryScalar,
} from "./services/NamedQueryRunner";
export { iriToObsidianName } from "./utilities/iriToObsidianName";
export { extractSparqlBlock, stripFrontmatter } from "./utilities/sparqlBlock";
export {
  CommandExecutionFlow,
  type CommandExecutionContext,
  type CommandPromptAdapter,
  type IFileOpener,
} from "./services/CommandExecutionFlow";
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
export { extractAssetReference } from "./utilities/extractAssetReference";
export { LoggingService } from "./services/LoggingService";
export { PropertyCleanupService } from "./services/PropertyCleanupService";
export { RenameToUidService } from "./services/RenameToUidService";
export { StatusTimestampService } from "./services/StatusTimestampService";
export { SupervisionCreationService } from "./services/SupervisionCreationService";
export {
  DynamicFrontmatterGenerator,
  type FrontmatterPropertyDefinition,
} from "./services/DynamicFrontmatterGenerator";
export {
  type FrontmatterOrderSpec,
  type OrderSpecLoader,
  registerOrderSpecLoader,
  clearOrderSpecLoader,
  loadDefaultSpec,
  orderProperties,
} from "./services/OrderSpecResolver";
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
  type AssetBuildResult,
  type ClassRefResolver,
} from "./services/GenericAssetCreationService";
export { ArchiveAssetService } from "./services/ArchiveAssetService";
export { FixMissingLabelService } from "./services/FixMissingLabelService";
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
export { vaultPathToIRI, iriToVaultPath, OBSIDIAN_VAULT_SCHEME } from "./infrastructure/vault/iri";
export { InMemoryTripleStore } from "./infrastructure/rdf/InMemoryTripleStore";

// Domain RDF model exports (for CLI/external consumers)
export { IRI as DomainIRI } from "./domain/models/rdf/IRI";
export { Literal as DomainLiteral } from "./domain/models/rdf/Literal";
export { BlankNode as DomainBlankNode } from "./domain/models/rdf/BlankNode";
export { Triple as DomainTriple } from "./domain/models/rdf/Triple";
export { RDFVocabularyMapper } from "./infrastructure/rdf/RDFVocabularyMapper";
export { RDFSInferenceEngine } from "./infrastructure/rdf/RDFSInferenceEngine";
export { NonInheritablePropertyRegistry } from "./services/NonInheritablePropertyRegistry";
export { PropertyCardinalityRegistry } from "./services/PropertyCardinalityRegistry";
export { PrototypeChainMaterializer, INFERRED_GRAPH } from "./services/PrototypeChainMaterializer";
export {
  IRICanonicalizer,
  type CanonicalizationResult,
} from "./services/IRICanonicalizer";
export { derivePath, deriveLegacyFlatPath } from "./services/AssetSpacePathDeriver";
export {
  discoverFileSpaceExclusions,
  frontmatterDeclaresFileSpace,
  FILE_SPACE_CLASS_UID,
  type FileSpaceDiscoveryResult,
  type FileSpaceDiscoveryVault,
} from "./services/FileSpaceDiscovery";
export {
  LazyAssetGraphLoader,
  MAX_LAZY_DEPTH,
  type INoteConverter,
} from "./services/LazyAssetGraphLoader";
export type { IFileResolver } from "./interfaces/IFileResolver";
export { SourceAnnotator, SOURCE_VARIABLE, type TripleSource } from "./services/SourceAnnotator";
export {
  NoteToRDFConverter,
  normaliseExcludedFolders,
  isPathExcluded,
  type ExocortexInvariantCode,
  type ExocortexInvariantViolation,
} from "./services/NoteToRDFConverter";

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
export {
  liveClock,
  frozenClock,
  type IClock,
} from "./services/IClock";
export {
  liveUidGenerator,
  seededUidGenerator,
  type IUidGenerator,
} from "./services/IUidGenerator";
export type { ILogger } from "./interfaces/ILogger";
export type { IQueryBodyResolver } from "./interfaces/IQueryBodyResolver";
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

// Layout / LayoutBlock (RFC exo__Layout Phase 1 — 6628d78a-78a9-473c-ace3-e9b6d28750d1)
export {
  LAYOUT_CLASS_IRI,
  LAYOUT_CLASS_UID,
  createLayoutFromFrontmatter,
  isLayout,
  isLayoutFrontmatter,
  type CreateLayoutOptions,
  type Layout,
} from "./domain/layout";

export {
  BACKLINKS_TABLE_BLOCK_CLASS_IRI,
  BACKLINKS_TABLE_BLOCK_CLASS_UID,
  PROPERTIES_BLOCK_CLASS_IRI,
  PROPERTIES_BLOCK_CLASS_UID,
  createLayoutBlockFromFrontmatter,
  isBacklinksTableBlock,
  isLayoutBlockFrontmatter,
  isPropertiesBlock,
  type BacklinksTableBlock,
  type CreateLayoutBlockOptions,
  type LayoutBlock,
  type LayoutBlockBase,
  type PropertiesBlock,
} from "./domain/layout";

export {
  LayoutSelector,
  selectByPriority,
  type LayoutSelectorSource,
} from "./application/services/LayoutSelector";

// Error exports
export * from "./domain/errors";

// SHACL-lite validation engine (RFC 82a72aca)
export { ShapeLoader, type ShapeJSONCache } from "./services/ShapeLoader";
export { ShapeRegistry, type Shape } from "./services/ShapeRegistry";
export { Namespace } from "./domain/models/rdf/Namespace";
export {
  validate as shaclValidate,
  ShapeRegistry as ShaclShapeRegistry,
  type ValidationReport,
  type Violation,
  type ClassHierarchy,
  type Severity,
  type Shape as ShaclShape,
  type ValidatorOptions,
} from "./services/ShaclLiteValidator";
export * from "./application/errors";
export {
  ValidatorDaemon,
  DEFAULT_SOCKET_PATH,
  IDLE_TIMEOUT_MS,
  type DaemonRequest,
  type DaemonResponse,
} from "./services/ValidatorDaemon";

// Profile apply confirmation contract (RFC 22b50a17 Phase 1b)
export type {
  IConfirmGate,
  ApplyPlan,
} from "./services/profile";
export { ClassHierarchy as TripleClassHierarchy } from "./services/ClassHierarchy";

// USTAR-aware tarball parser (honours the ustar `prefix` field that nanotar
// 0.3.0 drops — fixes private-repo AssetSpace pulls with full-SHA wrappers).
export {
  parseTarball,
  parseTarballGzip,
  type TarballEntry,
} from "./infrastructure/tarball/parseTarball";

// Transport-agnostic GitHub "create commit" core (Git Data API, 4-call chain).
// Shared by the Obsidian plugin (requestUrl transport) and the CLI (fetch
// transport) — the single iOS-portable commit+push implementation.
export {
  restCreateCommit,
  isBinaryPayload,
  type BinaryFilePayload,
  type CommitFileContent,
  type RestCommitRequest,
  type RestCommitResponse,
  type RestCommitTransport,
  type RestCreateCommitParams,
} from "./infrastructure/github/restCommit";

// Platform-agnostic AssetSpace mount/unmount core (Issue #3423 — Option A
// hexagonal consolidation). The single mount pipeline (fetch → wrapper → SHA →
// zip-slip → materialize) + `.gitmodules` text transforms, shared by the plugin
// (RestAssetSpaceMount: DataAdapter + requestUrl) and the CLI
// (BootstrapAssetSpaceService: Node fs + fetch) via injected ports.
export {
  mountAssetSpaceFiles,
  discoverWrapperDir as discoverAssetSpaceWrapperDir,
  extractShaFromWrapper as extractAssetSpaceSha,
  appendGitmodulesEntry,
  stripGitmodulesEntry,
  escapeGitmodulesRegex,
  type FileSystemPort,
  type HttpClient as AssetSpaceHttpClient,
  type MountFile,
  type MountResult,
  type MountAssetSpaceParams,
  type GitmodulesAppendResult,
} from "./services/assetspace/AssetSpaceMount";

// ExoSync A1 — platform-free sync core (RFC 4e4dc453): ChangeDetector
// (uid-keyed diff vs per-device watermark, D8/D18/D22) + SyncEngine
// (pull→no-conflict→push orchestration over the existing restCreateCommit
// primitive, D3/D12/D16/D19). Consumed via injected ports (transport,
// local files, watermark store, materialization gate, sha1).
export {
  detectChanges,
  extractAssetUid,
  type DetectChangesParams,
} from "./services/sync/ChangeDetector";
export { gitBlobSha } from "./services/sync/gitBlobSha";
export {
  getBlobBytes,
  getBlobText,
  getCommitInfo,
  getHeadSha,
  getTree,
  type RemoteCommitInfo,
  type RemoteTreeEntry,
} from "./services/sync/githubRepoReader";
export {
  DEFAULT_MAX_PUSH_RETRIES,
  SyncEngine,
  isNonFastForwardError,
  orderChildrenFirst,
  type SyncEngineDeps,
  type SyncProgressEvent,
  type SyncProgressFn,
  type SyncProgressPhase,
} from "./services/sync/SyncEngine";
export {
  DEFAULT_MAX_FILE_BYTES,
  InMemoryQuarantineStore,
  contentEquals,
  isFileSpaceSyncablePath,
  isSyncablePath,
  type AssetChange,
  type ChangeDetectionResult,
  type LocalFilesPort,
  type MaterializationCheck,
  type MaterializationCheckPort,
  type MergeConflictInput,
  type MergeDecision,
  type MergeLayerPort,
  type QuarantineEntry,
  type QuarantinePort,
  type RepoSyncResult,
  type Sha1Fn,
  type SpaceKind,
  type SyncContent,
  type SyncDirection,
  type SyncRepoSpec,
  type WatermarkFileEntry,
  type WatermarkRecord,
  type WatermarkStorePort,
} from "./services/sync/syncTypes";
// ExoSync A2 — StructuredMerger (3-way frontmatter per-key + D20 set-union
// tombstones + D21 structured body merge) over the generic diff3 helper.
export { diff3, type Diff3Result } from "./services/sync/diff3";
export {
  StructuredMerger,
  splitSections,
  type AssetMergeInput,
  type AssetMergeOutcome,
  type YamlCodec,
} from "./services/sync/StructuredMerger";
// ExoSync A2 — open-world mounted-scope SHACL merge-gate over the existing
// ShaclLiteValidator (no new validator; refs into unmounted spaces pass).
export {
  MergeShaclGate,
  type MergeGateVerdict,
  type MergeShaclGateDeps,
  type TriplesForContentFn,
} from "./services/sync/MergeShaclGate";
// ExoSync A2 — production MergeLayerPort composition: StructuredMerger +
// optional SHACL gate; unresolvable/invalid merges quarantine (D17).
export { GatedStructuredMerger } from "./services/sync/GatedStructuredMerger";
// ExoSync A3 — durable stores + engineering baseline (RFC 4e4dc453):
// synced quarantine repo (D17), durable watermark (D8/D22), credential
// contract + auth detection (VL#10/R8), rate-limit backoff (R6),
// secret-scan (R5).
export {
  FileWatermarkStore,
  WATERMARK_STORE_FILENAME,
  type WatermarkFileIO,
} from "./services/sync/FileWatermarkStore";
export {
  isAuthError,
  type CredentialStorePort,
} from "./services/sync/CredentialStore";
export {
  isRateLimitError,
  withRateLimitBackoff,
  type BackoffOptions,
} from "./services/sync/transportBackoff";
export {
  redactSecrets,
  scanForSecrets,
  type SecretFinding,
} from "./services/sync/secretScan";
export {
  SyncedQuarantineStore,
  type OpenQuarantineEntry,
  type QuarantineEntryRecord,
  type SyncedQuarantineStoreDeps,
} from "./services/sync/SyncedQuarantineStore";
// ExoSync E1 — platform-free space-declaration classification core shared by
// the plugin's collectSyncRepoSpecs and the CLI's exosync-parity collector
// (one parser, no drift), plus the M1/M2 parity validation harness
// (RFC 4e4dc453 Phase E — parallel-run validation).
export {
  ASSET_SPACE_CLASS_UID,
  SYNC_BRANCH,
  SpaceSpecAccumulator,
  classifySpaceDeclaration,
  isAssetSpaceFrontmatter,
  isFileSpaceFrontmatter,
  parseStrictGitHubRepoURL,
  readSpaceSource,
  type SpaceClassification,
  type SpaceSpecCandidate,
} from "./services/sync/spaceSpecCore";
export {
  ParityValidator,
  summarizeParityRound,
  type ConservationSnapshot,
  type ParityDiscrepancy,
  type ParityDiscrepancyClass,
  type ParityM1Violation,
  type ParityRoundRecord,
  type ParityRunOptions,
  type ParityValidatorDeps,
  type ReadonlyWatermarkSource,
  type RepoParityReport,
  type RepoParityStatus,
} from "./services/sync/ParityValidator";
export {
  compareAssetSemantics,
  isFormatOnlyDrift,
  type SemanticComparison,
} from "./services/sync/assetSemanticCompare";

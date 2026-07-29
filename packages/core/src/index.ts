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
  isTsFloorAssetSpace,
  isTsFloorMountPath,
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
  type RefToFolderResolver,
  type RefToFrontmatterResolver,
} from "./services/GroundingExecutor";
export { createVaultFrontmatterClassLabelResolver } from "./services/VaultFrontmatterClassLabelResolver";
export { createVaultFrontmatterRefToFolderResolver } from "./services/VaultFrontmatterRefToFolderResolver";
export { createVaultFrontmatterRefToFrontmatterResolver } from "./services/VaultFrontmatterRefToFrontmatterResolver";
export {
  NamedQueryRunner,
  type NamedQueryRunnerPort,
  type NamedQueryContext,
  type NamedQueryParam,
  type NamedQueryScalar,
} from "./services/NamedQueryRunner";
export type { ExoQLEvalResult } from "./exoql/evaluateWithExoEval";
export { iriToObsidianName } from "./utilities/iriToObsidianName";
export { extractSparqlBlock, stripFrontmatter } from "./utilities/sparqlBlock";
export {
  CommandExecutionFlow,
  type CommandExecutionContext,
  type CommandPromptAdapter,
  type IFileOpener,
} from "./services/CommandExecutionFlow";
export {
  createTripleStoreRequiredPropertyResolver,
  type RequiredPropertyResolver,
  type RequiredPropertyField,
  type RequiredPropertyFieldType,
} from "./services/RequiredPropertyResolver";
export { TaskStatusService } from "./services/TaskStatusService";
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
// Homoiconic substitution-token registry (RFC 727572d2). Public so consumers
// (Obsidian plugin templating, CLI) can resolve/register token vocabulary —
// e.g. the editor "Insert template token" command reuses `getResolver`.
export {
  installDefaultResolvers,
  getResolver,
  registerResolver,
  clearResolvers,
  getRegisteredResolverIds,
} from "./services/SubstitutionResolverRegistry";
export type {
  ResolverContext,
  ResolverFn,
} from "./services/SubstitutionResolverRegistry";
// Homoiconic templating (vehy 2-4) — resolve `$token` markers inside a markdown
// body via the shared registry. Consumed by the editor "Insert template"
// command and the `body_template` grounding step.
export { resolveTemplateBody, stripTemplateFrontmatter } from "./services/TemplateBodyResolver";
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
export { FolderRepairService } from "./services/FolderRepairService";
export { extractAssetReference } from "./utilities/extractAssetReference";
export { LoggingService } from "./services/LoggingService";
export { PropertyCleanupService } from "./services/PropertyCleanupService";
export { RenameToUidService } from "./services/RenameToUidService";
export { StatusTimestampService } from "./services/StatusTimestampService";
export {
  type FrontmatterOrderSpec,
  type OrderSpecLoader,
  registerOrderSpecLoader,
  clearOrderSpecLoader,
  loadDefaultSpec,
  orderProperties,
} from "./services/OrderSpecResolver";
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
export {
  GenericAssetCreationService,
  type GenericAssetCreationConfig,
  type AssetPropertyDefinition,
  type AssetBuildResult,
  type ClassRefResolver,
} from "./services/GenericAssetCreationService";
export { ArchiveAssetService } from "./services/ArchiveAssetService";
export { FixMissingLabelService } from "./services/FixMissingLabelService";
export {
  GraphQueryService,
  type GraphQueryServiceConfig,
} from "./services/GraphQueryService";
export {
  TypeRegistry,
  type TypeRegistryConfig,
} from "./services/TypeRegistry";
export { SPARQL_PREFIXES } from "./services/SparqlPrefixes";

// Utilities exports
export { FrontmatterService } from "./utilities/FrontmatterService";
// serializeYamlScalar — quote-when-needed YAML scalar serializer (issue #3748/#3750).
// Exposed so CLI-side mutation primitives (e.g. `set-property`, issue #3795) can
// pre-format values the same way the create / property_set paths do before
// handing them to FrontmatterService.updateProperty (which writes verbatim).
export { serializeYamlScalar } from "./utilities/yamlScalar";
// Tolerant YAML frontmatter parse (#3800) — bare yaml.load throws on a
// duplicated mapping key → the whole asset collapses to {} at every read
// (invisible & unrepairable). Retries `{ json: true }` (last-wins) on throw.
export { parseYamlFrontmatterTolerant } from "./utilities/parseYamlFrontmatter";
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
export {
  derivePath,
  deriveUrl,
  deriveLegacyFlatPath,
} from "./services/AssetSpacePathDeriver";
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
  UNPREFIXED_ASSET_FIELDS,
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
  DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI,
  DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID,
  PROPERTIES_BLOCK_CLASS_IRI,
  PROPERTIES_BLOCK_CLASS_UID,
  createLayoutBlockFromFrontmatter,
  isBacklinksTableBlock,
  isDailyEffortsByClassBlock,
  isLayoutBlockFrontmatter,
  isPropertiesBlock,
  type BacklinksTableBlock,
  type CreateLayoutBlockOptions,
  type DailyEffortsByClassBlock,
  type DailyEffortsPartition,
  type LayoutBlock,
  type LayoutBlockBase,
  type PropertiesBlock,
} from "./domain/layout";

// pn__DailyNote section toggles (RFC pn__DailyNote toggles — req a38ac95b):
// per-block visibility merge + day-efforts class partition.
export {
  BUILTIN_DAILY_EFFORTS_VISIBILITY,
  DAILY_EFFORTS_OVERRIDE_KEYS,
  coerceVisibilityOverride,
  resolveBlockVisibility,
  resolveDailyEffortVisibility,
  EMS_ACTION_CLASS_UID,
  EMS_PROJECT_CLASS_UID,
  partitionDailyEffortsByClass,
  type DailyEffortsPartitioned,
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
  type MountProgressPhase,
  type MountFileProgress,
  MATERIALIZE_PROGRESS_INTERVAL,
  MATERIALIZE_PROGRESS_MIN_FILES,
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
// dedup-uids (#3477) shared platform-free core (#3676) — report + fix semantics
// composed by BOTH the CLI `runDedupUids` (Node enumeration) and the in-plugin
// «Deduplicate uids» command (vault.adapter enumeration). Desktop↔Mobile parity.
export {
  rewriteAssetUid,
  findDuplicateUidGroups,
  planDuplicateUidFix,
  type DedupUidFile,
  type DedupUidGroup,
  type DedupUidRewrite,
} from "./services/sync/dedupUids";
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
  DEFAULT_LOCAL_MANIFEST_REHASH_MS,
  SyncEngine,
  isNonFastForwardError,
  orderChildrenFirst,
  syncProgressPhaseText,
  type SyncEngineDeps,
  type SyncProgressDetail,
  type SyncProgressEvent,
  type SyncProgressFn,
  type SyncProgressPhase,
} from "./services/sync/SyncEngine";
// ExoSync Phase 0 (measure-first) — per-phase wall-clock instrumentation.
// Engine attributes every REST round-trip / SHA-1 digest / file read into a
// phase bucket; consumers aggregate + format the breakdown for the device.
export {
  SyncPhaseTimer,
  SYNC_PHASES,
  classifyRestPhase,
  emptyTimings,
  addTimings,
  aggregateTimings,
  totalMs,
  dominantPhase,
  fmtMs,
  formatTimingsLine,
  formatRepoTimings,
  type SyncPhase,
  type SyncPhaseCounts,
  type SyncPhaseTimings,
  type NowFn,
} from "./services/sync/SyncPhaseTimer";
// ExoSync quarantine resolver (finding a0a3d1d6) — the user-facing reconcile
// the engine announced but never built. Device-local-first (watermark pins +
// disk + AssetSpace head), one-action convergent resolution, zero-loss.
export {
  QuarantineResolver,
  backupPathFor,
  type ConflictDetail,
  type QuarantineResolverDeps,
  type ResolvableConflict,
  type ResolveChoice,
  type ResolveResult,
} from "./services/sync/QuarantineResolver";
export {
  DEFAULT_MAX_FILE_BYTES,
  InMemoryQuarantineStore,
  contentEquals,
  isFileSpaceSyncablePath,
  isSyncablePath,
  type AssetChange,
  type ChangeDetectionResult,
  type LocalFilesPort,
  type LocalManifestEntry,
  type LocalManifestRecord,
  type LocalManifestStorePort,
  type MaterializationCheck,
  type MaterializationCheckPort,
  type MergeConflictInput,
  type MergeDecision,
  type MergeLayerPort,
  type MountBaseStorePort,
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
// ExoSync Phase 1 (perf) — device-local mtime-manifest store: skips reading +
// re-hashing files whose (mtime,size) are unchanged since the last sync.
export {
  FileLocalManifestStore,
  LOCAL_MANIFEST_STORE_FILENAME,
} from "./services/sync/FileLocalManifestStore";
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
  FileMountBaseStore,
  MOUNT_BASE_STORE_FILENAME,
} from "./services/sync/FileMountBaseStore";
export {
  isAuthError,
  type CredentialStorePort,
} from "./services/sync/CredentialStore";
export {
  isRateLimitError,
  withRateLimitBackoff,
  createRateLimitBudget,
  MIN_RATE_LIMIT_WAIT_MS,
  DEFAULT_MAX_RETRIES,
  type BackoffOptions,
  type RateLimitBudget,
} from "./services/sync/transportBackoff";
// RFC 6a1a6518 A — GitHub rate-limit header extraction + error enrichment
// (both transports attach Retry-After / x-ratelimit-* to the thrown error,
// preserving .message; the backoff honors the exact wait).
export {
  caseInsensitiveHeaderGetter,
  parseRetryAfterMs,
  extractRateLimitFields,
  getRateLimitFields,
  attachRateLimitFields,
  enrichRateLimitError,
  type RateLimitErrorFields,
  type HeaderGetter,
} from "./infrastructure/github/rateLimitHeaders";
export {
  redactSecrets,
  scanForSecrets,
  type SecretFinding,
} from "./services/sync/secretScan";
// Device-local conflict cache (offline-resolution foundation): a QuarantinePort
// that persists the 3 versions of every conflict to a `.local.` (Sync-excluded)
// file so the resolver can work offline. It is the SOLE durable quarantine sink
// (the synced git-repo quarantine store was retired — offline-resolution program).
export {
  LocalConflictCacheStore,
  CONFLICT_CACHE_STORE_FILENAME,
  type ConflictCacheReadPort,
  type ConflictCacheRecord,
  type LocalConflictCacheStoreDeps,
} from "./services/sync/LocalConflictCacheStore";
// Deferred-push outbox (offline conflict resolution): resolutions made offline
// queue here; the engine flushes them on the next sync with a TOCTOU guard.
export {
  LocalOutboxStore,
  OUTBOX_STORE_FILENAME,
  OUTBOX_REMOTE_ABSENT,
  type OutboxEntry,
  type OutboxReadPort,
  type OutboxStorePort,
  type LocalOutboxStoreDeps,
} from "./services/sync/LocalOutboxStore";
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
  buildAssetSpaceDescriptor,
  deriveAssetSpaceNamespace,
  type AssetSpaceDescriptor,
  type AssetSpaceDescriptorInput,
} from "./services/sync/registerForSync";
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

// Homoiconic vault-validation engine (RFC f402002b, M1.4): the check-runner,
// registry, 4 checks (uid-uniqueness / co-location / SHACL / DAG), and the
// warm one-pass reader contract consumed by the `Validate vault` command (M1.5).
export * from "./services/validation";

// Generic Settings Distribution engine (RFC f402002b, M2.1): source-agnostic
// Export/Import of a domain's declared setting keys ↔ `setting__Setting` assets,
// allowlist-by-construction. Pure (I/O injected by the caller).
export * from "./services/settings";

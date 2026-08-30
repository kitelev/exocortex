import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import type { ILogger } from "../interfaces/ILogger";
import { Triple } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { BlankNode } from "../domain/models/rdf/BlankNode";
import { Namespace } from "../domain/models/rdf/Namespace";
import { DI_TOKENS } from "../interfaces/tokens";
import { RDFVocabularyMapper } from "../infrastructure/rdf/RDFVocabularyMapper";
import { NullLogger } from "../infrastructure/NullLogger";
import { vaultPathToIRI } from "../infrastructure/vault/iri";
import {
  Exo003Parser,
  Exo003MetadataType,
  type Exo003AnchorMetadata,
  type Exo003BlankNodeMetadata,
  type Exo003StatementMetadata,
  type Exo003BodyMetadata,
} from "../domain/models/exo003";
import {
  discoverFileSpaceExclusions,
  type FileSpaceDiscoveryResult,
} from "./FileSpaceDiscovery";

/**
 * File-level invariant codes detected by `validateExocortexAsset`.
 *
 * Issue #2997 Phase 2: each code maps to one of the 11 bad-file shapes
 * that previously leaked partial triples into the store.
 */
export type ExocortexInvariantCode =
  | "MISSING_PROPERTY"
  | "EMPTY_PROPERTY"
  | "EMPTY_OPTIONAL_PROPERTY"
  | "INVALID_INSTANCE_CLASS_IRI";

export interface ExocortexInvariantViolation {
  code: ExocortexInvariantCode;
  property: string;
  message: string;
}

/**
 * Issue #3043 Phase 1 (RFC 871c1e56 A-series): whitelist of unprefixed
 * frontmatter keys that index as `exo:Asset_<key>` triples. The whitelist is
 * intentionally narrow — extending it requires an explicit decision because
 * every entry trades indexer simplicity for triple-graph growth.
 *
 * Exported so consumers that WRITE these properties (e.g. CLI `set-property`,
 * issue #3944) can map the RDF property name `exo__Asset_<field>` back to its
 * canonical bare YAML key `<field>` — the same mapping this converter applies
 * when READING `<field>:` → `exo:Asset_<field>`.
 */
export const UNPREFIXED_ASSET_FIELDS: ReadonlySet<string> = new Set([
  "archived",
  "draft",
  "pinned",
  "aliases",
]);

/** `exo__Asset_<field>` shape; group 1 = the bare field name. */
const ASSET_PREFIXED_SHAPE = /^exo__Asset_(.+)$/;

/**
 * Map an RDF property name to the canonical Obsidian YAML frontmatter KEY it is
 * stored under (issue #3944). Most properties use their own name, but the
 * {@link UNPREFIXED_ASSET_FIELDS} whitelist is stored under the BARE key
 * `<field>:` — the same key this converter reads back as `exo:Asset_<field>`.
 * Without this mapping a write of `exo__Asset_aliases` lands on a literal
 * `exo__Asset_aliases:` key that Obsidian ignores (it recognises aliases only
 * via `aliases:`) and that the converter never links to `exo:Asset_aliases`.
 *
 * ⛤ Lives HERE, next to the whitelist it consults, because **every** writer of
 * frontmatter must reach it — not only the CLI verbs. It previously sat in
 * `packages/cli/src/commands/propertyMutationShared.ts`, which made it
 * unreachable from the core-side writers (`GroundingExecutor`,
 * `GenericAssetCreationService`); they consequently wrote raw keys and diverged
 * from `set-property` / `remove-property`. The divergence was not carelessness
 * but *unreachability* — hence the move rather than a patch of the call sites.
 *
 * Property NAME guards and TBox validation still run on the RDF/prefixed form;
 * only the physical YAML key is canonicalised here. A bare `aliases` (already
 * canonical) passes through unchanged.
 */
export function canonicalYamlKey(property: string): string {
  const m = ASSET_PREFIXED_SHAPE.exec(property);
  if (m && UNPREFIXED_ASSET_FIELDS.has(m[1])) return m[1];
  return property;
}

/**
 * Normalise a user-supplied list of folder-exclusion prefixes:
 *   - Treat `undefined` / non-array as empty.
 *   - Coerce each entry through `String(...)` defensively in case JSON
 *     persistence smuggled in a non-string (legacy settings files).
 *   - Replace backslashes with forward slashes so Windows-style paths from
 *     hand-edited settings still match the vault's `file.path` shape.
 *   - Trim surrounding whitespace.
 *   - Drop empty entries — an empty prefix matches every path, which would
 *     silently exclude the entire vault.
 *   - Auto-append a trailing slash when missing. A user typing `"09 Templates"`
 *     without a slash overwhelmingly means "the folder", not "any path
 *     starting with that string"; without the slash a literal prefix match
 *     would also catch sibling folders like `"09 Templates Archive/"`. We
 *     close the footgun in normalisation so neither the UI hint text nor
 *     manual JSON edits can produce silent over-matching.
 */
export function normaliseExcludedFolders(
  excludedFolders: string[] | undefined,
): string[] {
  if (!Array.isArray(excludedFolders)) {
    return [];
  }
  return excludedFolders
    .map((entry) => String(entry).replace(/\\/g, "/").trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.endsWith("/") ? entry : `${entry}/`));
}

/**
 * Path-prefix match against a normalised list of excluded folders.
 * Case-sensitive (mirrors Obsidian's case-sensitive vault paths on macOS/Linux
 * with case-sensitive filesystems; users on case-insensitive filesystems can
 * extend the list with both casings if needed).
 */
export function isPathExcluded(
  filePath: string,
  normalisedPrefixes: string[],
): boolean {
  if (normalisedPrefixes.length === 0) {
    return false;
  }
  const normalisedPath = filePath.replace(/\\/g, "/");
  for (const prefix of normalisedPrefixes) {
    if (normalisedPath.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Issue #3219 — normalise the optional `subjectIriPrefix` constructor option
 * into a vault-relative path component (no leading slash, single trailing
 * slash) so `${prefix}${file.path}` stays valid. Empty input → empty output
 * (zero-prefix path == legacy behaviour, backward compatible).
 */
function normaliseSubjectIriPrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  let p = prefix.replace(/\\/g, "/");
  while (p.startsWith("/")) p = p.slice(1);
  while (p.endsWith("/")) p = p.slice(0, -1);
  return p.length > 0 ? `${p}/` : "";
}

/**
 * Service for converting Obsidian notes (frontmatter + wikilinks) to RDF triples.
 *
 * @example
 * ```typescript
 * const converter = new NoteToRDFConverter(vault);
 * const triples = await converter.convertNote(file);
 * ```
 */
@injectable()
export class NoteToRDFConverter {
  /**
   * Default files between {@link convertVaultWithValidation} progress emissions
   * (#al-activitylog-progress). 200 keeps a 5 000-file vault to ~25 activity-log
   * lines (well under the 1 000-entry ring buffer) while still showing steady
   * movement; vaults smaller than one interval emit nothing intermediate.
   */
  static readonly INDEX_PROGRESS_INTERVAL = 200;

  private readonly vocabularyMapper: RDFVocabularyMapper;

  /**
   * Regex pattern to match wikilinks in markdown body content.
   * Matches: [[Target]] or [[Target|Alias]]
   * Does not match wikilinks with angle brackets (embedded images: ![[image.png]])
   */
  private readonly BODY_WIKILINK_PATTERN = /(?<!!)\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  // Side-channel for rdf:type triples emitted by valueToRDFObject for enum instance IRIs.
  // Reset at start of each convertLegacyNote call, flushed after the frontmatter loop.
  private pendingExtraTriples: Triple[] = [];

  /**
   * Issue #3219 — when the vault adapter is rooted at a subdirectory (e.g.
   * `<root>/assetspaces/<sub>`), file.path is relative to the adapter
   * root so subject IRIs lose the `assetspaces/<sub>/` component. The mount
   * prefix is prepended to every adapter-derived path before IRI conversion
   * so subjects are consistent with full-vault subject IRIs.
   *
   * Normalised: no leading slash, single trailing slash when non-empty, so
   * `${prefix}${path}` stays a valid relative vault path.
   */
  private readonly subjectIriPrefix: string;

  /**
   * RFC 78572fa9 Phase 3 stage-1 (Andrey design-interview §v6, F1/F4) — DEFAULT-OFF
   * migration flag. When enabled, {@link valueToClassURI} (the `exo__Instance_class`
   * emission path) emits an asset's `exo__Instance_class` OBJECT (a resolved class
   * reference) as the class FILE IRI (uid) instead of the SYMBOLIC class IRI. Staged
   * per-predicate: this flag covers
   * ONLY the Instance_class object position (status/value and domain/range are later
   * F1 stages). Default OFF ⇒ byte-identical to the historical symbolic emission, so
   * merging is a no-op behaviour change; existing pure-SPARQL queries/preconditions
   * that reference a class by its readable symbolic name keep working via the
   * query-time `ClassHierarchyResolvingStore` (generalized to this position). An
   * unresolved ref (no class-def in the store) keeps emitting symbolic — no uid can
   * be synthesized — so a mixed store is possible and the resolver unions both forms.
   */
  private readonly emitInstanceClassAsUid: boolean;

  /**
   * Tier 3 of RFC 8f93ff95 (req 7d00a60b): class-file frontmatter read FROM DISK
   * ahead of the synchronous resolver.
   *
   * `valueToClassURI` is synchronous, and the corpus recipe for that shape is
   * pre-resolution rather than an async cascade (making it async would ripple
   * through every caller). So the class files a note references are resolved here,
   * in the async entry point, and parked in this map for the sync resolver to read.
   *
   * Keyed by file path. Consulted ONLY after `getFrontmatter` returns null, i.e.
   * only while the cache is cold — once Obsidian has re-indexed, the cache wins and
   * this map is never read, so a stale entry cannot surface.
   */
  private readonly preResolvedTargetFm = new Map<
    string,
    Record<string, unknown> | null
  >();

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private readonly vault: IVaultAdapter,
    @inject(DI_TOKENS.ILogger) private readonly logger: ILogger = NullLogger,
    options: { subjectIriPrefix?: string; emitInstanceClassAsUid?: boolean } = {},
  ) {
    this.vocabularyMapper = new RDFVocabularyMapper();
    this.subjectIriPrefix = normaliseSubjectIriPrefix(options.subjectIriPrefix);
    this.emitInstanceClassAsUid = options.emitInstanceClassAsUid ?? false;
  }

  /**
   * Converts a single note to RDF triples.
   *
   * Supports both legacy format (exo__/ems__ prefixed properties) and
   * Exo 0.0.3 format (metadata: namespace|anchor|blank_node|statement|body).
   *
   * @param file - The file to convert
   * @returns Array of RDF triples representing the note's metadata
   *
   * @example
   * ```typescript
   * const file = vault.getAbstractFileByPath("My Task.md");
   * const triples = await converter.convertNote(file);
   * ```
   */
  async convertNote(file: IFile): Promise<Triple[]> {
    // Tier 1 of RFC 8f93ff95 (req 7d00a60b): the asset's OWN frontmatter must not
    // be gated on Obsidian's metadataCache. On a cold cache getFrontmatter()
    // returns null, convertNoteFromFrontmatter short-circuits to [], and the whole
    // vault sweep (VaultRDFIndexer) yields an EMPTY store -> no exocmd bindings
    // match -> the dynamic inline buttons vanish. Measured live on desktop
    // 2026-08-29 (plugin 16.235.1): 4 of 7 buttons gone until the cache warmed.
    //
    // Feature-detected, not required: the capability is optional on IVaultAdapter
    // because CLI adapters already read from disk and the in-memory test doubles
    // have no disk at all. Mirrors the same guard used in ButtonGroupsBuilder.
    const frontmatter = this.vault.getFrontmatterWithFallback
      ? await this.vault.getFrontmatterWithFallback(file)
      : this.vault.getFrontmatter(file);
    return this.convertNoteFromFrontmatter(file, frontmatter);
  }

  /**
   * Convert a note to RDF using ALREADY-RESOLVED frontmatter instead of reading
   * it from the vault adapter (`getFrontmatter`, metadataCache-backed).
   *
   * RFC 8f93ff95 — ExoSync writes pulled assets via `vault.adapter.write`,
   * which does NOT refresh Obsidian's metadataCache, so `getFrontmatter` can be
   * stale for a just-synced file. The post-sync targeted reindex parses the
   * frontmatter straight from disk and passes it here, decoupling the per-file
   * conversion from metadataCache freshness. Wikilink TARGET resolution
   * (prototype / Exo 0.0.3 anchors) still flows through the adapter —
   * acceptable for Tier 1: the asset's OWN frontmatter triples (label, class,
   * `ems__Effort_parent`, …) are what make it visible in a parent's Layout.
   * Full disk-resolution of wikilinks is Tier 2.
   *
   * @param file - The note's path/basename identity (a synthetic `IFile` is
   *   fine — only `path`/`basename` are read here).
   * @param frontmatter - The note's frontmatter, already parsed (e.g. from
   *   disk). `null` ⇒ no triples.
   */
  async convertNoteFromFrontmatter(
    file: IFile,
    frontmatter: Record<string, unknown> | null,
  ): Promise<Triple[]> {
    if (!frontmatter) {
      return [];
    }

    // Tier 3 (req 7d00a60b): warm the class-frontmatter map from disk BEFORE the
    // synchronous class resolution below. No-op when the cache is warm or when the
    // adapter has no disk fallback (CLI / in-memory doubles).
    await this.preResolveWikilinkTargets(frontmatter);

    // RFC 1ce2a226 Phase 3a: emit exo:Asset_filename for every parsed file.
    // `file.basename` is the disk basename without `.md` extension, already
    // URL-decoded by Obsidian (e.g. "My Note", not "My%20Note"). Overwrite-
    // on-reindex semantics are provided by VaultRDFIndexer.updateFile/
    // renameFile, which call removeFileTriples(filePath) before re-emitting.
    const fileSubject = this.notePathToIRI(file.path);
    const filenamePredicate = Namespace.EXO.term("Asset_filename");
    const filenameTriple = new Triple(
      fileSubject,
      filenamePredicate,
      new Literal(file.basename),
    );

    // Issue #1366: Check for Exo 0.0.3 format first
    if (Exo003Parser.isExo003Format(frontmatter)) {
      const exo003Triples = await this.convertExo003Note(file, frontmatter);
      return [filenameTriple, ...exo003Triples];
    }

    // Legacy format processing
    return this.convertLegacyNote(file, frontmatter, filenameTriple);
  }

  /**
   * Converts a legacy format note (exo__/ems__ properties) to RDF triples.
   */
  private async convertLegacyNote(
    file: IFile,
    frontmatter: Record<string, unknown>,
    filenameTriple: Triple,
  ): Promise<Triple[]> {
    this.pendingExtraTriples = [];
    const triples: Triple[] = [filenameTriple];
    const subject = this.notePathToIRI(file.path);

    // EKA D5 (reification): capture the resolved subject/predicate/object terms
    // of a reified `exo__Statement` so a logical edge can be materialized after
    // the frontmatter loop (materialize-at-index — see emission note below).
    // `isReifiedStmt` is set from the exo__Instance_class resolution already
    // performed in the loop (no extra valueToClassURI cost on the reindex hot
    // path; covers alias AND bare-UID class forms via the same code path).
    let reifiedSubject: IRI | undefined;
    let reifiedPredicate: IRI | undefined;
    let reifiedObject: IRI | Literal | undefined;
    let isReifiedStmt = false;
    const statementClassIRI = Namespace.EXO.term("Statement").value;

    for (const [key, value] of Object.entries(frontmatter)) {
      // Issue #3043 Phase 1: whitelisted unprefixed frontmatter keys are
      // indexed under the `exo:Asset_<key>` predicate so SPARQL queries like
      // `?s exo:Asset_archived true` can match assets that carry the bare
      // Obsidian-style flag in frontmatter (`archived: true`). Keys outside
      // the whitelist remain skipped to avoid uncontrolled triple growth.
      const normalizedKey = UNPREFIXED_ASSET_FIELDS.has(key)
        ? `exo__Asset_${key}`
        : key;
      if (!this.isExocortexProperty(normalizedKey)) {
        continue;
      }

      const predicate = this.propertyKeyToIRI(normalizedKey);
      const values = Array.isArray(value) ? value : [value];

      for (const val of values) {
        // Skip empty-string / null values for exo__Asset_label and whitelisted
        // unprefixed fields. `new Literal("")` throws (Literal.ts) and null
        // would emit a junk "null" literal; a single bad alias must not discard
        // the whole asset's triples. Boolean flags (archived/draft/pinned:false)
        // are NOT skipped — only null/undefined/blank-string. For exo__Asset_label
        // the basename fallback below still synthesises the label triple.
        if (
          (key === "exo__Asset_label" || UNPREFIXED_ASSET_FIELDS.has(key)) &&
          (val == null || (typeof val === "string" && val.trim() === ""))
        ) {
          continue;
        }
        // Issue #663: For exo__Instance_class, always use namespace URIs for class references
        // This enables canonical SPARQL JOINs: ?s exo:Instance_class ?class . ?class exo:Asset_label ?label .
        // Previously, if the class file existed, we'd use the file URI which couldn't be joined with
        // class definitions (which use namespace URIs as subjects).
        if (key === "exo__Instance_class") {
          const objectNode = this.valueToClassURI(val);
          triples.push(new Triple(subject, predicate, objectNode));
        } else {
          // Issue #2102: valueToRDFObject now returns array for dual storage support
          const objectNodes = await this.valueToRDFObject(val, file, predicate);

          // EKA D5: stash reified-statement components (first IRI/term wins).
          // These reuse the SAME resolution as the raw _subject/_predicate/
          // _object triples emitted below, so the materialized edge's node
          // identities are identical to the statement triples (round-trip-safe).
          if (
            normalizedKey === "exo__Statement_subject" &&
            reifiedSubject === undefined
          ) {
            const iri = objectNodes.find((n): n is IRI => n instanceof IRI);
            if (iri) reifiedSubject = iri;
          } else if (
            normalizedKey === "exo__Statement_predicate" &&
            reifiedPredicate === undefined
          ) {
            const iri = objectNodes.find((n): n is IRI => n instanceof IRI);
            if (iri) reifiedPredicate = iri;
          } else if (
            normalizedKey === "exo__Statement_object" &&
            reifiedObject === undefined
          ) {
            reifiedObject = objectNodes[0];
          }

          for (const objectNode of objectNodes) {
            triples.push(new Triple(subject, predicate, objectNode));

            // Issue #871: Generate additional RDFS triple for properties with vocabulary mappings
            // This enables SPARQL queries using standard RDFS predicates like rdfs:domain, rdfs:range
            // to work with Exocortex ontology properties.
            if (this.vocabularyMapper.hasMappingFor(key) && objectNode instanceof IRI) {
              const mappedTriple = this.vocabularyMapper.generateMappedTriple(
                subject,
                key,
                objectNode,
              );
              if (mappedTriple) {
                triples.push(mappedTriple);
              }
            }
          }
        }
      }

      if (key === "exo__Instance_class") {
        for (const val of values) {
          // `classNode` is the SAME object valueToClassURI produced above — so the
          // RFC 78572fa9 Phase 3 stage-1 emission flip (uid vs symbolic) applies to
          // this co-emitted `rdf:type` triple too. The query-time
          // ClassHierarchyResolvingStore bridges BOTH `exo:Instance_class` AND
          // `rdf:type` membership objects (its MEMBERSHIP_PREDICATES set) so both
          // stay queryable by the symbolic name post-flip — keep them in lockstep.
          const classNode = this.valueToClassURI(val);
          if (classNode instanceof IRI) {
            const rdfType = Namespace.RDF.term("type");
            triples.push(new Triple(subject, rdfType, classNode));
            // EKA D5: reified-statement detection reuses this resolution.
            if (classNode.value === statementClassIRI) {
              isReifiedStmt = true;
            }
          }
        }
      }

      // Issue #2807: exo__Asset_label is the Exocortex display-label property.
      // Emit an additional rdfs:label triple so standard SPARQL queries
      // (e.g. ClassDiscoveryService) can find labels without knowing the
      // Exocortex vocabulary. exo__Asset_label semantically extends rdfs:label.
      if (key === "exo__Asset_label") {
        const rdfsLabel = Namespace.RDFS.term("label");
        for (const val of values) {
          if (typeof val === "string" && val.length > 0) {
            triples.push(new Triple(subject, rdfsLabel, new Literal(val)));
          }
        }
      }
    }

    // exo__Asset_label fallback: when an Exocortex asset's frontmatter lacks
    // a usable label (missing, empty string, or empty array), synthesise
    // rdfs:label + exo:Asset_label from the file basename. Plain markdown
    // notes (no Exocortex properties) do not get synthesised labels.
    const looksLikeAsset =
      "exo__Instance_class" in frontmatter ||
      "exo__Asset_uid" in frontmatter;
    const rawLabel = frontmatter["exo__Asset_label"];
    const hasUsableLabel =
      "exo__Asset_label" in frontmatter &&
      rawLabel !== null &&
      rawLabel !== undefined &&
      !(typeof rawLabel === "string" && rawLabel.trim() === "") &&
      !(Array.isArray(rawLabel) && rawLabel.length === 0);
    if (looksLikeAsset && !hasUsableLabel) {
      const rdfsLabel = Namespace.RDFS.term("label");
      const exoAssetLabel = Namespace.EXO.term("Asset_label");
      const labelLiteral = new Literal(file.basename);
      triples.push(new Triple(subject, rdfsLabel, labelLiteral));
      triples.push(new Triple(subject, exoAssetLabel, labelLiteral));
    }

    // Flush rdf:type triples emitted by valueToRDFObject for enum instance IRIs (Fix #ff3858e5)
    triples.push(...this.pendingExtraTriples);
    this.pendingExtraTriples = [];

    // EKA D5 (USER decision, 2026-06-13): materialize-at-index of a reified
    // exo__Statement. A statement {subject, predicate, object} living in a
    // junction ontology decouples the import edge $ontoA→$ontoB; emitting an
    // additional LOGICAL EDGE `<subject> <predicate> <object>` keeps the
    // relationship visible to SPARQL (BGP + property paths) with ZERO engine
    // changes — it is just a normal triple. The raw exo__Statement_* triples
    // remain (round-trip), and the edge reuses their already-resolved terms.
    // Emitted only when subject AND predicate resolve to IRIs (SPARQL requires
    // an IRI in those positions); the object may be an IRI or a Literal.
    if (isReifiedStmt && reifiedSubject && reifiedPredicate && reifiedObject) {
      triples.push(new Triple(reifiedSubject, reifiedPredicate, reifiedObject));
    }

    // Issue #1329: Index body wikilinks to RDF
    // This enables SPARQL queries to find all notes referencing a target note
    const bodyLinkTriples = await this.convertBodyWikilinks(file, subject);
    triples.push(...bodyLinkTriples);

    return triples;
  }

  /**
   * Converts an Exo 0.0.3 format note to RDF triples.
   *
   * Issue #1366: Support for new file format where each RDF triple is stored as a separate file.
   *
   * @param file - The file to convert
   * @param frontmatter - The parsed frontmatter
   * @returns Array of RDF triples
   */
  private async convertExo003Note(
    file: IFile,
    frontmatter: Record<string, unknown>
  ): Promise<Triple[]> {
    const parseResult = Exo003Parser.parse(frontmatter);

    if (!parseResult.success || !parseResult.metadata) {
      // Invalid Exo 0.0.3 file - skip
      return [];
    }

    const metadata = parseResult.metadata;
    const triples: Triple[] = [];

    switch (metadata.metadata) {
      case Exo003MetadataType.Namespace:
        // Namespace files don't generate triples directly
        // They define prefix-to-URI mappings used by other files
        break;

      case Exo003MetadataType.Anchor:
        triples.push(...this.convertExo003Anchor(file, metadata as Exo003AnchorMetadata));
        break;

      case Exo003MetadataType.BlankNode:
        triples.push(...this.convertExo003BlankNode(file, metadata as Exo003BlankNodeMetadata));
        break;

      case Exo003MetadataType.Statement:
        triples.push(...this.convertExo003Statement(file, metadata as Exo003StatementMetadata));
        break;

      case Exo003MetadataType.Body:
        triples.push(...await this.convertExo003Body(file, metadata as Exo003BodyMetadata));
        break;
    }

    return triples;
  }

  /**
   * Converts an Exo 0.0.3 anchor file to RDF triples.
   * Adds file-to-URI mapping triple.
   */
  private convertExo003Anchor(
    file: IFile,
    metadata: Exo003AnchorMetadata
  ): Triple[] {
    const fileIRI = this.notePathToIRI(file.path);
    const anchorIRI = new IRI(metadata.uri);

    // Map the file to its anchor URI using owl:sameAs
    // This enables queries to find the file by its semantic URI
    return [
      new Triple(fileIRI, Namespace.OWL.term("sameAs"), anchorIRI),
      new Triple(anchorIRI, Namespace.OWL.term("sameAs"), fileIRI),
    ];
  }

  /**
   * Converts an Exo 0.0.3 blank node file to RDF triples.
   */
  private convertExo003BlankNode(
    file: IFile,
    metadata: Exo003BlankNodeMetadata
  ): Triple[] {
    const fileIRI = this.notePathToIRI(file.path);

    // Create a blank node with the URI as its identifier
    // The URI in blank_node files is used as a stable identifier
    const blankNodeId = metadata.uri.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Map the file to the blank node
    return [
      new Triple(fileIRI, Namespace.OWL.term("sameAs"), new BlankNode(blankNodeId)),
    ];
  }

  /**
   * Converts an Exo 0.0.3 statement file to RDF triples.
   * Resolves wikilink references to anchor URIs.
   */
  private convertExo003Statement(
    file: IFile,
    metadata: Exo003StatementMetadata
  ): Triple[] {
    const triples: Triple[] = [];

    try {
      // Build a resolver function for wikilink references
      const resolveReference = this.createExo003ReferenceResolver(file);

      // Use Exo003Parser to convert to triple
      const triple = Exo003Parser.toTriple(metadata, resolveReference);
      triples.push(triple);

      // Also add a triple linking the file to the statement
      const fileIRI = this.notePathToIRI(file.path);
      triples.push(
        new Triple(fileIRI, Namespace.RDF.term("value"), triple.subject)
      );
    } catch {
      // If conversion fails, skip this statement
    }

    return triples;
  }

  /**
   * Converts an Exo 0.0.3 body file to RDF triples.
   * The body content becomes the literal value of the triple.
   */
  private async convertExo003Body(
    file: IFile,
    metadata: Exo003BodyMetadata
  ): Promise<Triple[]> {
    const triples: Triple[] = [];

    try {
      // Read the file to get body content
      const content = await this.vault.read(file);
      const bodyContent = this.extractBodyContent(content);

      // Build a resolver function for wikilink references
      const resolveReference = this.createExo003ReferenceResolver(file);

      // Resolve subject and predicate
      const subjectRef = resolveReference(metadata.subject);
      const predicateRef = resolveReference(metadata.predicate);

      if (subjectRef.type === "literal") {
        throw new Error("Body subject cannot be a literal");
      }
      if (predicateRef.type !== "iri") {
        throw new Error("Body predicate must be an IRI");
      }

      const subject = subjectRef.type === "iri"
        ? new IRI(subjectRef.value)
        : new BlankNode(subjectRef.value);
      const predicate = new IRI(predicateRef.value);

      // Create the literal from body content
      const literal = Exo003Parser.toLiteral(metadata, bodyContent.trim());

      triples.push(new Triple(subject, predicate, literal));

      // Also add a triple linking the file to the subject
      const fileIRI = this.notePathToIRI(file.path);
      triples.push(
        new Triple(fileIRI, Namespace.RDF.term("value"), subject)
      );
    } catch {
      // If conversion fails, skip this body
    }

    return triples;
  }

  /**
   * Creates a reference resolver function for Exo 0.0.3 wikilink references.
   *
   * Resolves [[wikilink]] references to anchor/namespace URIs by looking up
   * the target file's metadata.
   */
  private createExo003ReferenceResolver(
    sourceFile: IFile
  ): (ref: string) => {
    type: "iri" | "blank" | "literal";
    value: string;
    language?: string;
    direction?: "ltr" | "rtl";
    datatype?: string;
  } {
    return (ref: string) => {
      // Check if ref is a wikilink
      const wikilink = this.extractWikilink(ref);
      const targetPath = wikilink || ref;

      // Try to resolve the target file
      const targetFile = this.vault.getFirstLinkpathDest(targetPath, sourceFile.path);

      if (targetFile) {
        // Get the target file's frontmatter
        const targetFrontmatter = this.targetFrontmatter(targetFile);

        if (targetFrontmatter && Exo003Parser.isExo003Format(targetFrontmatter)) {
          const parseResult = Exo003Parser.parse(targetFrontmatter);

          if (parseResult.success && parseResult.metadata) {
            const metadata = parseResult.metadata;

            // Anchor and Namespace files have a URI
            if (
              metadata.metadata === Exo003MetadataType.Anchor ||
              metadata.metadata === Exo003MetadataType.Namespace
            ) {
              return {
                type: "iri",
                value: (metadata as Exo003AnchorMetadata).uri,
              };
            }

            // BlankNode files
            if (metadata.metadata === Exo003MetadataType.BlankNode) {
              return {
                type: "blank",
                value: (metadata as Exo003BlankNodeMetadata).uri.replace(/[^a-zA-Z0-9_-]/g, "_"),
              };
            }
          }
        }

        // Target exists but is not Exo 0.0.3 format - use file IRI
        return {
          type: "iri",
          value: this.notePathToIRI(targetFile.path).value,
        };
      }

      // Check if this is a full URI (not a wikilink)
      if (!wikilink && ref.includes("://")) {
        return {
          type: "iri",
          value: ref,
        };
      }

      // Could not resolve - treat as literal
      return {
        type: "literal",
        value: ref,
      };
    };
  }

  /**
   * Converts all notes in the vault to RDF triples.
   *
   * @param options.excludedFolders - Optional list of vault-relative path
   *   prefixes; any file whose path starts with one of these prefixes is
   *   skipped without validation and without producing a warn-log entry. See
   *   {@link convertVaultWithValidation} for full semantics.
   * @returns Array of all RDF triples from the vault
   *
   * @example
   * ```typescript
   * const allTriples = await converter.convertVault();
   * console.log(`Converted ${allTriples.length} triples`);
   *
   * // Skip the user-managed templates folder:
   * await converter.convertVault({ excludedFolders: ["09 Templates/"] });
   * ```
   */
  async convertVault(
    options: {
      excludedFolders?: string[];
    } = {},
  ): Promise<Triple[]> {
    const result = await this.convertVaultWithValidation({
      strict: false,
      excludedFolders: options.excludedFolders,
    });
    return result.triples;
  }

  /**
   * Information about a file that was skipped during vault conversion.
   */
  public static readonly SkippedFileInfo = class {
    constructor(
      public readonly path: string,
      public readonly reason: string,
    ) {}
  };

  /**
   * Result of vault conversion with validation information.
   *
   * Issue #2205: Provides detailed information about files that were skipped
   * during indexing, including reasons and summary statistics.
   */
  public static readonly VaultValidationResult = class {
    constructor(
      public readonly triples: Triple[],
      public readonly skippedFiles: Array<{ path: string; reason: string }>,
      public readonly summary: {
        total: number;
        indexed: number;
        skipped: number;
      },
    ) {}
  };

  /**
   * Options for vault conversion with validation.
   */
  public static readonly VaultValidationOptions = class {
    constructor(
      public readonly strict: boolean = false,
    ) {}
  };

  /**
   * Converts all notes in the vault to RDF triples with validation.
   *
   * Issue #2205: Enhanced version of convertVault that provides detailed
   * information about skipped files and supports strict mode.
   *
   * @param options - Validation options
   * @param options.strict - If true, throws on first invalid IRI instead of skipping
   * @param options.excludedFolders - Vault-relative path prefixes whose files
   *   are silently dropped before validation (no warn-log entry, no
   *   `skippedFiles` record, no presence in the `summary.total` count). Used
   *   by the Obsidian plugin to keep user-managed templates folders out of the
   *   RDF index. Matching is case-sensitive path-prefix on the forward-slash
   *   form of `file.path`; entries should typically end with a trailing slash
   *   (`"09 Templates/"`) to avoid matching sibling folders sharing a name
   *   prefix (e.g. `"09 Templates Archive/..."`). An empty / whitespace-only
   *   prefix is ignored to prevent the entire vault from being excluded.
   * @returns Result containing triples, skipped files, and summary statistics
   *
   * @example
   * ```typescript
   * // Non-strict mode (default): skip invalid files, return all valid triples
   * const result = await converter.convertVaultWithValidation();
   * console.log(`Indexed ${result.summary.indexed}, skipped ${result.summary.skipped}`);
   *
   * // Strict mode: fail fast on first invalid IRI
   * await converter.convertVaultWithValidation({ strict: true });
   *
   * // Skip a templates folder from validation entirely
   * await converter.convertVaultWithValidation({
   *   excludedFolders: ["09 Templates/", "10 Drafts/"],
   * });
   * ```
   *
   * @throws Error if strict mode is enabled and an invalid IRI is encountered
   */
  async convertVaultWithValidation(
    options: {
      strict?: boolean;
      excludedFolders?: string[];
      /**
       * Periodic progress callback during the walk (#al-activitylog-progress).
       * Invoked `(processed, total)` every {@link options.progressIntervalFiles}
       * files so a long index visibly advances in the activity log instead of
       * going silent until completion. Optional — CLI / tests that omit it pay
       * zero cost. `processed` counts every file the loop visits (indexed AND
       * skipped); `total` is `files.length` after exclusions. The terminal
       * count is delivered by the caller's own completion notice, so this fires
       * only on intermediate multiples (never a redundant final `total of total`).
       * Best-effort: callback throws are swallowed so a bad observer can never
       * break indexing.
       */
      onProgress?: (processed: number, total: number) => void;
      /**
       * Files between {@link options.onProgress} emissions. Default
       * {@link NoteToRDFConverter.INDEX_PROGRESS_INTERVAL}. A small vault below
       * one interval emits nothing intermediate (only the caller's completion
       * notice), so tiny vaults stay quiet.
       */
      progressIntervalFiles?: number;
    } = {}
  ): Promise<{
    triples: Triple[];
    skippedFiles: Array<{ path: string; reason: string }>;
    summary: { total: number; indexed: number; skipped: number };
    fileSpaces: FileSpaceDiscoveryResult;
  }> {
    const allFiles = this.vault.getAllFiles();
    const allTriples: Triple[] = [];
    const skippedFiles: Array<{ path: string; reason: string }> = [];
    const strict = options.strict ?? false;
    // Issue #3468: per-file skip logs go to `info` (console-only by default);
    // the loop counts each category and emits ONE summary `warn` per category
    // after the walk, so bulk indexing of a dirty vault produces at most two
    // Notice toasts instead of one per skipped file.
    let invariantViolationCount = 0;
    let invalidIriCount = 0;

    // FileSpace skip (onto-RFC 18808c73 Phase 5, ExoSync Phase C): spaces
    // declared `exo__FileSpace` in the vault have their mount folders
    // excluded from the index — opaque blobs: no parsing, no triple store,
    // no SHACL. Derived from the RDF declaration (rdf:type), never from
    // hardcoded paths; reuses the same prefix mechanism as the
    // user-configured `excludedFolders` below. The declarations themselves
    // are ordinary assets and keep indexing (convention: they live OUTSIDE
    // their mount folder — discovery warns otherwise).
    const fileSpaces = discoverFileSpaceExclusions(this.vault);
    for (const warning of fileSpaces.warnings) {
      this.logger.warn(`FileSpace discovery: ${warning}`);
    }

    const excludedPrefixes = [
      ...normaliseExcludedFolders(options.excludedFolders),
      ...fileSpaces.prefixes,
    ];

    // Folder-level exclusion: drop files whose vault path starts with any
    // configured prefix BEFORE validation. Excluded files are intentionally
    // invisible to the rest of the pipeline (no warn-log, no skippedFiles
    // record, no `summary.total` contribution) — they are treated as if they
    // never existed in the vault. This is the user-facing escape hatch for
    // template folders whose contents violate Exocortex invariants by design.
    const files = excludedPrefixes.length === 0
      ? allFiles
      : allFiles.filter(
          (file) => !isPathExcluded(file.path, excludedPrefixes),
        );

    // Periodic progress (#al-activitylog-progress). Emit `(processed, total)`
    // every `progressInterval` files so a long walk visibly advances in the
    // activity log. Best-effort — a throwing observer must never abort indexing.
    const onProgress = options.onProgress;
    const progressInterval =
      options.progressIntervalFiles && options.progressIntervalFiles > 0
        ? options.progressIntervalFiles
        : NoteToRDFConverter.INDEX_PROGRESS_INTERVAL;
    const totalFiles = files.length;
    let processed = 0;

    for (const file of files) {
      processed++;
      if (onProgress && processed % progressInterval === 0 && processed < totalFiles) {
        try {
          onProgress(processed, totalFiles);
        } catch {
          // Isolate observer failures — progress is best-effort, never blocks
          // the walk (mirrors ProfileApplyManager.emitProgress).
        }
      }
      try {
        // Issue #2997 Phase 2 — Loader two-phase commit (all-or-nothing).
        //
        // Pipeline (per file):
        //   1. Read frontmatter once.
        //   2. Validate file-level invariants against raw frontmatter
        //      (see `validateExocortexAsset`). Covers the 11 bad shapes
        //      from RFC 0810aad3-…/Phase 2 fixtures (empty required
        //      properties, empty optionals, malformed Instance_class
        //      IRI). Validation is cheap (dictionary lookup) so we
        //      front-load it before any triple work.
        //   3. Build the candidate triple buffer via `convertNote`.
        //      The buffer is local to this iteration — it never enters
        //      `allTriples` if anything below fails.
        //   4. Commit the buffer into `allTriples` atomically.
        //
        // Any violation at step 2, or any throw at step 3, discards the
        // entire buffer and records the file as skipped — a single
        // malformed asset can never leak partial triples into the store
        // (which previously tripped the SPARQL executor with
        // "Literals cannot appear in subject position").
        const frontmatter = this.vault.getFrontmatter(file);
        const violation = frontmatter
          ? this.validateExocortexAsset(frontmatter, file.basename)
          : null;

        if (violation) {
          if (strict) {
            throw new Error(
              `Invariant violation in "${file.path}": ${violation.message}`,
            );
          }
          skippedFiles.push({
            path: file.path,
            reason: `Invariant violation: ${violation.message}`,
          });
          invariantViolationCount++;
          // Issue #3468: info, not warn — per-file detail stays on the
          // console channel without producing one Notice toast per file.
          this.logger.info(
            `Skipping file with invariant violation: ${file.path}`,
            { code: violation.code, property: violation.property, reason: violation.message },
          );
          continue;
        }

        const candidate = await this.convertNote(file);
        allTriples.push(...candidate);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        if (strict) {
          throw new Error(
            `Invalid IRI for file "${file.path}": ${reason}`
          );
        }

        // Issue #2205: Collect skipped files with detailed reasons
        skippedFiles.push({
          path: file.path,
          reason: `Invalid IRI: ${reason}`,
        });
        invalidIriCount++;

        // Issue #684: Skip files with invalid IRIs instead of crashing.
        // Issue #3468: info, not warn — see the summary warns below.
        this.logger.info(`Skipping file with invalid IRI: ${file.path}`, { reason });
      }
    }

    // Issue #3468: one summary warn per category. The default plugin routing
    // sends `warn` to the Notice channel, so a dirty vault yields at most two
    // toasts per walk instead of one per file. The count must live in the
    // message string itself — Notice/file channels only receive the
    // top-level message, context objects go to the console channel.
    if (invariantViolationCount > 0) {
      this.logger.warn(
        `Skipped ${invariantViolationCount} file${invariantViolationCount === 1 ? "" : "s"} with invariant violations during indexing (paths in developer console)`,
        { count: invariantViolationCount },
      );
    }
    if (invalidIriCount > 0) {
      this.logger.warn(
        `Skipped ${invalidIriCount} file${invalidIriCount === 1 ? "" : "s"} with invalid IRI during indexing (paths in developer console)`,
        { count: invalidIriCount },
      );
    }

    return {
      triples: allTriples,
      skippedFiles,
      summary: {
        total: files.length,
        indexed: files.length - skippedFiles.length,
        skipped: skippedFiles.length,
      },
      fileSpaces,
    };
  }

  /**
   * Validates all files in the vault for IRI issues without converting.
   *
   * Issue #2205: Check vault health by identifying files that would
   * cause IRI validation errors during indexing.
   *
   * @returns Array of files with IRI issues and their reasons
   *
   * @example
   * ```typescript
   * const issues = await converter.validateVault();
   * if (issues.length > 0) {
   *   console.log(`Found ${issues.length} files with IRI issues:`);
   *   for (const issue of issues) {
   *     console.log(`  - ${issue.path}: ${issue.reason}`);
   *   }
   * }
   * ```
   */
  /**
   * Validates a single file's frontmatter against Exocortex asset
   * invariants.
   *
   * Issue #2997 Phase 2 — file-level invariants, evaluated against
   * the raw frontmatter before any triple is committed to the store.
   * Used by `convertVaultWithValidation` as the second leg of the
   * two-phase load (build candidate → validate → commit).
   *
   * Trigger: only frontmatter that looks like an Exocortex asset
   * (declares `exo__Instance_class` or `exo__Asset_uid`) is checked.
   * Plain markdown notes with arbitrary frontmatter pass through
   * unchanged.
   *
   * Invariants:
   *   - Required + non-empty: `exo__Asset_uid`, `exo__Instance_class`.
   *   - `exo__Asset_isDefinedBy` and `exo__Asset_label` are no longer
   *     required — converter falls back to defaults when absent.
   *   - Optional but non-empty if present: `ems__Effort_status`,
   *     `ems__Effort_parent`, `ems__Effort_lockedBy`,
   *     `ems__Effort_lockExpires`, `exo__Asset_updatedAt`,
   *     `ems__Effort_startTimestamp`.
   *   - `exo__Instance_class` wikilink target must not contain
   *     whitespace or parentheses when it carries a class-style
   *     namespace prefix (e.g. `exo__`, `ems__`) — those expand to
   *     namespace IRIs and would otherwise produce invalid IRIs.
   *
   * @param frontmatter - The note's parsed frontmatter.
   * @returns The first detected invariant violation, or `null` if the
   *          frontmatter passes (or is not an Exocortex asset).
   */
  /**
   * Returns a label inferred from a basename of the form `prefix__LocalName`
   * (e.g. `exo__Class` → `"exo__Class"`), or `null` if the basename does not
   * match a known Exocortex namespace pattern.
   *
   * Non-UIDified ontology class files (exo__Class.md, ems__Area.md, …) encode
   * their label in the filename.  This helper lets the converter skip the
   * `exo__Asset_label` requirement for those files and synthesise the triple
   * instead of skipping the file entirely (Issue #3101).
   */
  static inferLabelFromBasename(basename: string): string | null {
    return Namespace.fromPropertyKey(basename) !== null ? basename : null;
  }

  validateExocortexAsset(
    frontmatter: Record<string, unknown>,
    basename?: string,
  ): ExocortexInvariantViolation | null {
    const isEmpty = (v: unknown): boolean => {
      if (v === null || v === undefined) return true;
      if (typeof v === "string") return v.trim() === "";
      if (Array.isArray(v)) return v.length === 0 || v.every(isEmpty);
      return false;
    };

    // Trigger: skip non-Exocortex notes entirely.
    const looksLikeAsset =
      "exo__Instance_class" in frontmatter ||
      "exo__Asset_uid" in frontmatter;
    if (!looksLikeAsset) {
      return null;
    }

    // exo__Asset_label is no longer required — convertNote falls back to
    // file.basename when the frontmatter property is missing or empty.
    // The unused `basename` parameter is kept for API compatibility.
    void basename;

    const REQUIRED_PROPERTIES = [
      "exo__Asset_uid",
      "exo__Instance_class",
    ];
    for (const key of REQUIRED_PROPERTIES) {
      if (!(key in frontmatter)) {
        return {
          code: "MISSING_PROPERTY",
          property: key,
          message: `Required property "${key}" is missing`,
        };
      }
      if (isEmpty(frontmatter[key])) {
        return {
          code: "EMPTY_PROPERTY",
          property: key,
          message: `Required property "${key}" is empty`,
        };
      }
    }

    const OPTIONAL_NON_EMPTY_PROPERTIES = [
      "ems__Effort_status",
      "ems__Effort_parent",
      "ems__Effort_lockedBy",
      "ems__Effort_lockExpires",
      "exo__Asset_updatedAt",
      "ems__Effort_startTimestamp",
    ];
    for (const key of OPTIONAL_NON_EMPTY_PROPERTIES) {
      if (key in frontmatter && isEmpty(frontmatter[key])) {
        return {
          code: "EMPTY_OPTIONAL_PROPERTY",
          property: key,
          message: `Optional property "${key}" is present but empty`,
        };
      }
    }

    // Instance_class wikilink shape — only reject when target carries
    // a known namespace prefix (e.g. `exo__`, `ems__`) but contains
    // characters that would produce an invalid namespace IRI.
    //
    // Issue #3121: for multi-valued exo__Instance_class, only reject if
    // ALL entries are invalid. Mixed arrays (one bad + N valid) survive —
    // the bad entries are dropped by `expandClassValue` returning null at
    // triple-build time, while valid entries still produce rdf:type and
    // exo__Instance_class triples. Previously a single malformed entry
    // dropped the entire asset from the store, cascading false sh:class
    // violations on referencing assets.
    const instanceClassValue = frontmatter["exo__Instance_class"];
    const classCandidates = Array.isArray(instanceClassValue)
      ? instanceClassValue
      : [instanceClassValue];
    let firstInvalid: { candidate: string } | null = null;
    let anyValid = false;
    for (const candidate of classCandidates) {
      if (typeof candidate !== "string") continue;
      const cleaned = this.removeQuotes(candidate);
      const wikilink = this.extractWikilink(cleaned);
      const target = (wikilink ?? cleaned).trim();
      const looksLikeNamespacedClass = /^[a-z][a-zA-Z0-9]*__/.test(target);
      if (looksLikeNamespacedClass && /[\s()]/.test(target)) {
        if (!firstInvalid) firstInvalid = { candidate };
      } else {
        anyValid = true;
      }
    }
    if (firstInvalid && !anyValid) {
      return {
        code: "INVALID_INSTANCE_CLASS_IRI",
        property: "exo__Instance_class",
        message: `Invalid Instance_class IRI: "${firstInvalid.candidate}"`,
      };
    }

    return null;
  }

  async validateVault(): Promise<Array<{ path: string; reason: string }>> {
    const files = this.vault.getAllFiles();
    const issues: Array<{ path: string; reason: string }> = [];

    for (const file of files) {
      // Check if the file path can be converted to a valid IRI
      const iriString = vaultPathToIRI(file.path);

      if (!IRI.isValidIRI(iriString)) {
        issues.push({
          path: file.path,
          reason: `Path "${file.path}" cannot be converted to a valid IRI`,
        });
      }
    }

    return issues;
  }

  /**
   * Converts a note path to an obsidian:// IRI.
   *
   * Uses encodeURI (not encodeURIComponent) to preserve forward slashes
   * while encoding spaces and other special characters. This ensures
   * consistent URI normalization for exact SPARQL query matches.
   *
   * @param path - The note path (e.g., "path/to/note.md")
   * @returns IRI with obsidian:// scheme
   *
   * @example
   * ```typescript
   * const iri = converter.notePathToIRI("My Folder/My Note.md");
   * // Returns: obsidian://vault/My%20Folder/My%20Note.md
   * ```
   */
  notePathToIRI(path: string): IRI {
    return new IRI(vaultPathToIRI(`${this.subjectIriPrefix}${path}`));
  }

  /**
   * Issue #3219 — synthesise an IRI for a wikilink target that could not be
   * resolved through this adapter's `getFirstLinkpathDest`. The synthesised
   * path represents a guess at where the target *might* live; it is NOT a
   * file in this vault. The mount prefix MUST NOT be applied here — applying
   * it would produce a non-existent cross-vault IRI when the target really
   * lives in another vault at a different path.
   */
  private synthesizeWikilinkTargetIRI(path: string): IRI {
    return new IRI(vaultPathToIRI(path));
  }

  private isExocortexProperty(key: string): boolean {
    return Namespace.fromPropertyKey(key) !== null;
  }

  private propertyKeyToIRI(key: string): IRI {
    const parsed = Namespace.fromPropertyKey(key);
    if (!parsed) {
      throw new Error(`Invalid property key: ${key}`);
    }
    return parsed.namespace.term(parsed.localName);
  }

  // Fix #ff3858e5: when emitting a class IRI for an enum instance, also push an
  // rdf:type triple derived from the target file's exo__Instance_class frontmatter.
  // This satisfies sh:class constraints in the SHACL-lite engine.
  //
  // Also emit exo:Instance_class triple — ShaclLiteValidator.typePredicateIRI is
  // exo#Instance_class (not rdf:type), so the rdf:type triple alone does not
  // register the enum-instance IRI as a member of its class for sh:class checks.
  // Without this, references like [[<uuid>|inbox__Role]] resolve to namespace IRI
  // <inbox#Role>, but the validator finds no class declaration for that subject
  // and reports false sh:class violations even when the class file exists.
  private emitTypeTripleForEnumInstance(classIRI: IRI, targetFile: IFile): void {
    const targetFm = this.targetFrontmatter(targetFile);
    if (!targetFm) return;
    const targetInstanceClass = targetFm["exo__Instance_class"];
    const raw = Array.isArray(targetInstanceClass)
      ? targetInstanceClass[0]
      : targetInstanceClass;
    if (typeof raw !== "string") return;
    const parentClassIRI = this.valueToClassURI(raw);
    if (parentClassIRI instanceof IRI) {
      this.pendingExtraTriples.push(
        new Triple(classIRI, Namespace.RDF.term("type"), parentClassIRI)
      );
      this.pendingExtraTriples.push(
        new Triple(classIRI, Namespace.EXO.term("Instance_class"), parentClassIRI)
      );
    }
  }

  /**
   * Converts a frontmatter value to RDF object(s).
   *
   * Dual-storage (IRI + UUID Literal) is emitted ONLY for `exo__Asset_prototype` predicate
   * (Issue #2102 original design). All other predicates emit a single IRI per wikilink.
   * Dual-storage on other predicates causes sh:maxCount=1 SHACL violations (Fix #ff3858e5).
   *
   * Side effect: may push rdf:type triples into `pendingExtraTriples` when resolving enum
   * instance wikilinks (e.g. [[pmbok__ClosureOutcomeAllAccepted]]). Caller must flush
   * `pendingExtraTriples` after the frontmatter loop.
   *
   * @param value - The frontmatter value to convert
   * @param sourceFile - The source file for resolving wikilinks
   * @param predicate - The predicate IRI being populated (gates dual-storage to Asset_prototype)
   * @returns Array of RDF objects (IRI or Literal).
   */
  private async valueToRDFObject(
    value: unknown,
    sourceFile: IFile,
    predicate?: IRI
  ): Promise<(IRI | Literal)[]> {
    if (typeof value === "string") {
      const cleanValue = this.removeQuotes(value);

      // Issue #3757: `exocmd__TokenInvocation_parameter` is a pure DATA literal —
      // a frontmatter-KEY name (`exo__Asset_isDefinedBy`) for the `targetProperty`
      // resolver, or a date-format/offset modifier for date tokens — NEVER a
      // class reference. Without this bypass, a key like `exo__Asset_isDefinedBy`
      // matches the `prefix__LocalName` class-shape and gets substituted to the
      // ontology IRI (`<https://exocortex.my/ontology/exo#Asset_isDefinedBy>`).
      // CommandResolver then bakes that IRI into the `$target.property(...)`
      // marker, and the resolver looks up `targetFm[<IRI>]` (a guaranteed miss —
      // targetFm is keyed by the prefixed frontmatter key) → returns null → the
      // created instance silently loses `exo__Asset_isDefinedBy` (and any other
      // `$target.property(prefix__Local)` inheritance). The value is data, not a
      // class ref, so emit it as a plain Literal. Same category as
      // `targetValueLiteral` (a plain-string value read via getLiteralValue,
      // documented below as never entering the wikilink branch) — not a
      // file-IRI reference like the `isGroundingRef` bypass. Sole consumer is
      // CommandResolver.resolveTokenInvocation (via getLiteralValue), which wants
      // the literal key; no path relies on the IRI form.
      if (predicate?.value.endsWith("#TokenInvocation_parameter")) {
        return [new Literal(cleanValue)];
      }

      const wikilink = this.extractWikilink(cleanValue);
      if (wikilink) {
        const targetFile = this.vault.getFirstLinkpathDest(
          wikilink,
          sourceFile.path
        );
        if (targetFile) {
          const fileIRI = this.notePathToIRI(targetFile.path);

          // Issue #2102/#2489: If wikilink is a UUID, store both IRI and Literal
          // This enables SPARQL queries like:
          // ?s exo:Asset_prototype "e3347bcf-bb50-4fb7-9064-14266469384b"
          // Strip display name (e.g. "uuid|Display Name" → "uuid") before UUID check
          const linkpath = wikilink.includes("|")
            ? wikilink.split("|")[0]
            : wikilink;
          if (this.isUUID(linkpath)) {
            const uuidLiteral = new Literal(linkpath);

            // RFC 31c1a0be Phase 3 hotfix: bypass class-IRI substitution for
            // grounding-ref predicates. When a typed grounding ref points at a
            // UUID-named target whose `exo__Asset_label` happens to be a
            // class-prefixed string (e.g. `ems__EffortStatusDoing`), the
            // Issue #2782/#2959 substitution below rewrites the triple to the
            // namespace class IRI. CommandResolver.iriToObsidianName then
            // returns the symbolic local name and the executor writes
            // `"[[ems__EffortStatusDoing]]"` instead of `"[[<UUID>]]"` —
            // defeating the typed-predicate migration. Emit the file IRI so
            // iriToObsidianName extracts the UUID basename instead.
            //
            // `targetValueLiteral` is intentionally excluded — CommandResolver
            // reads it via `getLiteralValue` so it never enters the wikilink
            // branch (it's a plain string, not a wikilink reference).
            //
            // Issue #3212: `Grounding_targetClass` joins the bypass list.
            // create_instance groundings reference the class TBox by
            // `[[<class-uid>]]`; the class file's label is the canonical
            // short-name (`ems__Task`), which would otherwise round-trip
            // back through #2782 → `<ems#Task>` and yield label-form
            // `"[[ems__Task]]"` in the created instance's
            // `exo__Instance_class` — violating UUID-canon TBox.
            //
            // `PropertyDefault_value` joins the bypass list for the same
            // reason: PropertyDefault assets store the default value as a
            // wikilink (e.g. `[[c42245d0-...]]` pointing to
            // `ems__EffortStatusDraft`). Without this bypass the #2782
            // substitution rewrites the triple object to
            // `<ems#EffortStatusDraft>`, CommandResolver.resolvePropertyDefaultValue
            // then writes label-form `"[[ems__EffortStatusDraft]]"` into the
            // created instance — violating UUID-canon for `ems__Effort_status`
            // and the wider PropertyDefault story.
            //
            // RFC 9d20c91f Phase 4: `Grounding_type` joins the bypass list.
            // Post-Phase 1 the property is reshaped to ObjectProperty with
            // range `exocmd__GroundingType`; ABox stores `"[[<uid>]]"` pointing
            // to one of 9 catalog instances. Without bypass the target's label
            // (e.g. `exocmd__GroundingTypePropertySet`) matches the namespace
            // prefix regex → #2782 substitutes to `<exocmd#GroundingTypePropertySet>`,
            // CommandResolver UID-identity dispatch then cannot extract the UUID
            // from the symbolic class IRI (`GROUNDING_TYPE_UID_TO_ENUM` keyed
            // on UID, not label). aiKnow ref: 07d29fd8-6460-430b-b244-2bdb3f726fb9.
            const isGroundingRef =
              predicate?.value.endsWith("#Grounding_targetValueRef") ||
              predicate?.value.endsWith("#Grounding_targetValueSubstitution") ||
              predicate?.value.endsWith("#Grounding_targetClass") ||
              predicate?.value.endsWith("#Grounding_type") ||
              predicate?.value.endsWith("#PropertyDefault_value");
            if (isGroundingRef) {
              return [fileIRI];
            }

            // Issue #2782: when the target file represents a class-like enum
            // member (status/criticality/etc.), REPLACE the dual-storage pair
            // with the namespace URI alone. Additive emission (v15.90.25)
            // does not work for starter-kit preconditions of the form
            //   ASK { ?s != <ems:EffortStatusDoing> }
            // because ASK is existential — any non-matching binding (file IRI
            // or UUID literal) makes the FILTER pass and the gate returns TRUE.
            // Class-like enum targets are never queried by raw UUID literal
            // (#2102 dual storage exists for exo__Asset_prototype only) so the
            // replace is safe. Mirrors valueToClassURI's Issue #2745 lookup.
            //
            // RFC 31c1a0be Phase 4 PR-B (#3194) invariant: the class IRI
            // emitted here is coupled to the symbolic effort-status form in
            // starter-kit ASK preconditions. Migrating to UUID-form requires
            // changing both together; see Phase 5 follow-up.
            const basenameClassIRI = this.expandClassValue(targetFile.basename);
            if (basenameClassIRI) {
              // Fix #ff3858e5: emit rdf:type triple so sh:class constraints resolve
              this.emitTypeTripleForEnumInstance(basenameClassIRI, targetFile);
              return [basenameClassIRI];
            }
            const targetFm = this.targetFrontmatter(targetFile);
            if (targetFm) {
              const label = targetFm["exo__Asset_label"];
              if (typeof label === "string") {
                const labelClassIRI = this.expandClassValue(label);
                if (labelClassIRI) {
                  // Fix: emit class-registration triples for label-derived class IRI
                  // so sh:class constraints resolve for UID-named class declarations
                  // (e.g. `<uuid>.md` with alias `inbox__Role`).
                  this.emitTypeTripleForEnumInstance(labelClassIRI, targetFile);
                  return [labelClassIRI];
                }
              }
            }

            // Fix #ff3858e5: dual-storage (IRI + UUID Literal) is scoped to
            // exo__Asset_prototype only. All other predicates emit a single IRI
            // to avoid sh:maxCount=1 cardinality violations.
            //
            // Issue #3353 (Sub-task B of #3282): opt-in env-flag escape hatch
            // extends dual-storage to additional predicates listed in
            // `EXOCORTEX_DUAL_STORAGE_PREDICATES` (comma-separated local names,
            // e.g. `Effort_area,Effort_parent`). Default unset → no behavior
            // change. `.filter(Boolean)` strips empty/whitespace entries so a
            // stray "," or empty env value never produces a match.
            const isProtoPredicate =
              predicate?.value.endsWith("#Asset_prototype") ||
              predicate?.value.endsWith("/Asset_prototype");
            // Issue #3469: iOS WebKit has no Node `process` global — alias
            // it behind a typeof guard (MOBILE-002) so mobile behaves as
            // "env unset" instead of throwing ReferenceError mid-convert.
            const dualStorageEnv =
              typeof process !== "undefined" ? process.env : undefined;
            const dualPredicates = (
              dualStorageEnv?.EXOCORTEX_DUAL_STORAGE_PREDICATES ?? ""
            )
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
            const isDualPredicate =
              dualPredicates.length > 0 &&
              dualPredicates.some((p) => predicate?.value.endsWith(`#${p}`));
            if (isProtoPredicate || isDualPredicate) {
              return [fileIRI, uuidLiteral];
            }
            return [fileIRI];
          }

          // Issue #2959: When a class-named wikilink resolves to its class
          // definition file (e.g. `ems__Effort_status: "[[ems__EffortStatusDone]]"`
          // → `ems/ems__EffortStatusDone.md`), emit the namespace class IRI
          // (`<https://exocortex.my/ontology/ems#EffortStatusDone>`) instead of
          // the file IRI. SPARQL ASK preconditions of the form
          //   ASK { ?s ems:Effort_status <ems:EffortStatusDone> }
          // require the canonical class IRI to match. Without this, the
          // "Archive Completed" command's "Is in Done status" precondition
          // returned `false` on tasks that were actually Done.
          //
          // This mirrors the Issue #2782 fix for UUID-form wikilinks but
          // applies when the wikilink is itself a class-prefixed name
          // (`ems__*` / `exo__*` / etc.) and the resolved file's basename
          // is a class reference.
          const basenameClassIRI = this.expandClassValue(targetFile.basename);
          if (basenameClassIRI) {
            // Fix #ff3858e5: emit rdf:type triple so sh:class constraints resolve
            this.emitTypeTripleForEnumInstance(basenameClassIRI, targetFile);
            return [basenameClassIRI];
          }

          return [fileIRI];
        }
        // Three-step wikilink resolver (RFC 4724eb62, phased rollout).
        // Step 1: canonical namespace mapping for prefix__LocalName form.
        // Issue #667, #668 — normalize Instance_class/Property_domain.
        if (this.isClassReference(wikilink)) {
          const classIRI = this.expandClassValue(wikilink);
          if (classIRI) {
            return [classIRI];
          }
        }
        // Step 2 (vault file lookup) reached the no-match branch above
        // (`getFirstLinkpathDest` returned null).
        // Step 3 (phase A — UUID-form only): synthesised vault-path IRI
        // when the linkpath is a UUID. Narrow scope intentionally — Fix 3
        // attempt 1 (PR #3106) broadened this to all unresolved wikilinks
        // and broke 4 E2E specs that depend on non-UUID identifier wikilinks
        // (e.g. `[[e2e-bind-status-done-for-tasks]]` in test vault) flowing
        // as Literal so downstream `CommandResolver.normalizeWikilink` can
        // extract the bare reference. Phase B will widen to non-UUID forms
        // once those downstream paths are migrated.
        //
        // Strip optional `|alias` suffix — the alias is a display hint.
        const linkpath = wikilink.includes("|")
          ? wikilink.split("|")[0]
          : wikilink;
        if (this.isUUID(linkpath)) {
          // Issue #3219 — `synthesizeWikilinkTargetIRI` skips the mount
          // prefix because the target is unresolved (could live in any
          // vault, including primary). Applying the prefix here would
          // produce an IRI that doesn't match the target's real subject.
          return [this.synthesizeWikilinkTargetIRI(`${linkpath}.md`)];
        }
        return [new Literal(cleanValue)];
      }

      if (this.isClassReference(cleanValue)) {
        const classIRI = this.expandClassValue(cleanValue);
        if (classIRI) {
          return [classIRI];
        }
      }

      // Check for ISO 8601 dateTime format and apply xsd:dateTime datatype
      if (this.isISO8601DateTime(cleanValue)) {
        return [new Literal(cleanValue, Namespace.XSD.term("dateTime"))];
      }

      return [new Literal(cleanValue)];
    }

    if (typeof value === "boolean") {
      return [new Literal(value.toString())];
    }

    if (typeof value === "number") {
      return [new Literal(
        value.toString(),
        Namespace.XSD.term("decimal")
      )];
    }

    // Handle Date objects (js-yaml auto-parses ISO 8601 strings to Date)
    if (value instanceof Date) {
      return [new Literal(value.toISOString(), Namespace.XSD.term("dateTime"))];
    }

    return [new Literal(String(value))];
  }

  /**
   * Check if a string is a valid ISO 8601 dateTime format.
   *
   * Matches formats:
   * - `YYYY-MM-DDTHH:MM:SSZ` (UTC with Z suffix)
   * - `YYYY-MM-DDTHH:MM:SS` (local time without timezone)
   * - `YYYY-MM-DDTHH:MM:SS.sssZ` (with milliseconds)
   * - `YYYY-MM-DDTHH:MM:SS+HH:MM` (with timezone offset)
   *
   * @param value - String to check
   * @returns True if value matches ISO 8601 dateTime pattern
   */
  private isISO8601DateTime(value: string): boolean {
    // Pattern matches:
    // - Date: YYYY-MM-DD
    // - Time separator: T
    // - Time: HH:MM:SS
    // - Optional milliseconds: .sss
    // - Optional timezone: Z or +/-HH:MM
    const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;
    return iso8601Pattern.test(value);
  }

  private removeQuotes(value: string): string {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.substring(1, trimmed.length - 1);
    }
    return value;
  }

  private extractWikilink(value: string): string | null {
    const match = value.match(/^\[\[([^\]]+)\]\]$/);
    if (!match) return null;
    const linkpath = match[1];
    return linkpath.includes("|") ? linkpath.split("|")[0] : linkpath;
  }

  // Issue #2742: Extract alias from [[UUID|alias]] wikilink format
  private extractWikilinkAlias(value: string): string | null {
    const match = value.match(/^\[\[([^\]]+)\]\]$/);
    if (!match) return null;
    const linkpath = match[1];
    const pipeIndex = linkpath.indexOf("|");
    return pipeIndex >= 0 ? linkpath.substring(pipeIndex + 1).trim() : null;
  }

  /**
   * Converts a value for exo__Instance_class to a namespace URI.
   *
   * Issue #663: Always stores class references as namespace URIs (not file URIs),
   * enabling canonical SPARQL JOINs with class definitions.
   *
   * @param value - The value from frontmatter (e.g., "[[ems__Task]]", "ems__Task", '"[[exo__Class]]"')
   * @returns IRI with namespace URI for class references, or Literal for non-class values
   *
   * @example
   * ```typescript
   * valueToClassURI("[[ems__Task]]")  // → IRI("https://exocortex.my/ontology/ems#Task")
   * valueToClassURI("ems__Task")      // → IRI("https://exocortex.my/ontology/ems#Task")
   * valueToClassURI('"[[exo__Class]]"')  // → IRI("https://exocortex.my/ontology/exo#Class")
   * valueToClassURI("[[SomeNote]]")   // → Literal("[[SomeNote]]") (not a class reference)
   * ```
   */
  /**
   * Tier 3 of RFC 8f93ff95 (req 7d00a60b) — pre-resolve class-file frontmatter.
   *
   * Reuses {@link valueToClassURI}'s OWN normalisation (`removeQuotes` ->
   * `extractWikilink`) rather than re-parsing the value, so the two cannot drift.
   *
   * Tier 4 (req f3ec4a75) WIDENED the scope from the class position to EVERY
   * uid-form wikilink in the frontmatter. Rationale: the #2782 enum-substitution
   * block resolves a VALUE target through the very same `label -> symbolic` lookup
   * ("mirrors valueToClassURI's Issue #2745 lookup", per its own comment), so a cold
   * cache downgraded enum values to file-IRIs. That is worse than a missing button:
   * the starter-kit ASK gates are existential, so `FILTER(?s != <ems:...Doing>)`
   * PASSES on a file-IRI and the gate opens on an asset it was written to close.
   *
   * Cost: one adapter read per DISTINCT cold target, and ZERO once the cache is warm
   * — the `getFrontmatter` probe below short-circuits before any read. Measured over
   * 9054 assets of vault-my: mean 3.69 distinct uid-form targets per asset, p90 5,
   * p99 9, max 27. Label-form and uid+alias references are skipped by `isUUID`.
   */
  /**
   * Frontmatter of a wikilink TARGET, warm cache or not.
   *
   * @req:f3ec4a75-f49c-47db-9cd6-5c8d09fbf0e0 — ONE reader, so a future call-site
   * cannot silently reintroduce the cold-cache downgrade in just one branch. Every
   * consumer that resolves a target through `label -> symbolic IRI` MUST go through
   * here; `preResolveWikilinkTargets` fills the map before the synchronous resolvers
   * run, so this stays sync (`valueToClassURI` cannot await).
   *
   * ⛔ NOT for the warm-up itself: there `getFrontmatter` is the question being asked
   * ("is this target's cache warm?"), and a fallback would answer it with its own map.
   */
  private targetFrontmatter(file: IFile): Record<string, unknown> | null {
    return (
      this.vault.getFrontmatter(file) ??
      this.preResolvedTargetFm.get(file.path) ??
      null
    );
  }

  private async preResolveWikilinkTargets(
    frontmatter: Record<string, unknown>,
  ): Promise<void> {
    const withFallback = this.vault.getFrontmatterWithFallback;
    if (!withFallback) {
      return; // CLI adapter / in-memory doubles: nothing to fall back to
    }

    for (const raw of Object.values(frontmatter)) {
      const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
      for (const value of values) {
        if (typeof value !== "string") {
          continue;
        }
        const cleanValue = this.removeQuotes(value);
        // ⛔ A WIKILINK is required — a bare value is a LITERAL, not a reference.
        // Without this test the warm-up treated `exo__Asset_uid: <uuid>` as a link and
        // read the asset's OWN file back off disk — caught by the Tier 3 axis
        // "does NOT touch disk for the label-bare form", which is why that axis exists.
        const targetRef = this.extractWikilink(cleanValue);
        if (!targetRef || !this.isUUID(targetRef)) {
          continue; // label-form resolves from its own text — no lookup needed
        }
        const resolvedFile = this.vault.getFirstLinkpathDest(targetRef, "");
        if (!resolvedFile || this.preResolvedTargetFm.has(resolvedFile.path)) {
          continue;
        }
        if (this.vault.getFrontmatter(resolvedFile)) {
          continue; // cache is warm for this target — the resolver will use it
        }
        this.preResolvedTargetFm.set(
          resolvedFile.path,
          await withFallback.call(this.vault, resolvedFile),
        );
      }
    }
  }

  private valueToClassURI(value: unknown): IRI | Literal {
    if (typeof value !== "string") {
      return new Literal(String(value));
    }

    const cleanValue = this.removeQuotes(value);
    const wikilink = this.extractWikilink(cleanValue);
    const classRef = wikilink || cleanValue;

    // Try to expand as a class reference (ems__ or exo__ prefix)
    const classIRI = this.expandClassValue(classRef);
    if (classIRI) {
      return classIRI;
    }

    // Issue #2742: If UUID didn't expand, try alias from [[UUID|alias]] format
    const alias = this.extractWikilinkAlias(cleanValue);
    if (alias) {
      const aliasIRI = this.expandClassValue(alias);
      if (aliasIRI) {
        return aliasIRI;
      }
    }

    // Issue #2745: If UUID-only wikilink, look up file in vault and resolve via basename/label
    // Issue #3242: when the resolved class file has no namespace-derivable name
    // (UUID basename, no namespace-prefixed `exo__Asset_label`), fall back to
    // the resolved file IRI instead of `Literal`. Without this, the validator
    // skips the type triple entirely (ShaclLiteValidator only processes
    // `obj.type === 'iri'`), leaving the asset apparently classless and
    // emitting false `sh:class` violations against any referencing asset.
    // The file IRI is still traversable by `TripleClassHierarchy` via
    // `exo__Class_superClass` triples emitted by the class file itself.
    if (this.isUUID(classRef)) {
      const resolvedFile = this.vault.getFirstLinkpathDest(classRef, "");
      if (resolvedFile) {
        // RFC 78572fa9 Phase 3 stage-1 (`valueToClassURI` is called ONLY for
        // `exo__Instance_class`): when `emitInstanceClassAsUid` is on, emit the class
        // FILE IRI (uid) instead of the symbolic class IRI for a RESOLVED class ref
        // (the canonical UID-canon form `exo__Instance_class: "[[<class-uid>]]"`). The
        // file IRI is the class-def subject and is graph-traversable via
        // `exo__Class_superClass`; the query-time `ClassHierarchyResolvingStore`
        // bridges a symbolic-name query back to it. A label-form / unresolved ref
        // above keeps emitting symbolic (no uid to synthesize) and the resolver unions
        // both forms.
        const basenameIRI = this.expandClassValue(resolvedFile.basename);
        if (basenameIRI) {
          return this.emitInstanceClassAsUid
            ? this.notePathToIRI(resolvedFile.path)
            : basenameIRI;
        }

        // Tier 3 (req 7d00a60b): cold cache => getFrontmatter is null => the label
        // is never seen => the code used to fall through to notePathToIRI() and emit
        // a FILE-IRI, silently breaking every ASK precondition that compares against
        // the SYMBOLIC form (3 of 36 on vault-my, incl. "Is Prototype").
        const fm = this.targetFrontmatter(resolvedFile);
        if (fm) {
          const label = fm["exo__Asset_label"];
          if (typeof label === "string") {
            const labelIRI = this.expandClassValue(label);
            if (labelIRI) {
              return this.emitInstanceClassAsUid
                ? this.notePathToIRI(resolvedFile.path)
                : labelIRI;
            }
          }
        }

        // Issue #3242 fall-through: resolved class file lacks any
        // namespace-derivable identifier — use its file IRI so the type
        // triple remains graph-traversable.
        return this.notePathToIRI(resolvedFile.path);
      }
    }

    // Not a class reference - return as literal (preserves original wiki-link format)
    return new Literal(cleanValue);
  }

  private isClassReference(value: string): boolean {
    if (/\s/.test(value)) return false;
    return Namespace.fromPropertyKey(value) !== null;
  }

  /**
   * Check if a string is a valid UUID format.
   *
   * Issue #2102: Used to detect UUID-based wikilinks for dual storage
   * (both File IRI and UUID Literal).
   *
   * @param value - String to check
   * @returns True if value is a valid UUID format
   *
   * @example
   * ```typescript
   * isUUID("e3347bcf-bb50-4fb7-9064-14266469384b")  // → true
   * isUUID("ems__Task")                              // → false
   * isUUID("My Document")                            // → false
   * ```
   */
  isUUID(value: string): boolean {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidPattern.test(value);
  }

  private expandClassValue(value: string): IRI | null {
    const cleanValue = this.removeQuotes(value);
    const parsed = Namespace.fromPropertyKey(cleanValue);
    if (!parsed) return null;
    // Issue #3121: reject local names whose IRI form would be invalid
    // (whitespace, parens). Without this gate, `Namespace.term` throws and
    // aborts the entire vault-load iteration via the outer catch, dropping
    // every triple for the asset — including valid sibling rdf:type triples
    // from other entries in a multi-valued exo__Instance_class array.
    if (/[\s()]/.test(parsed.localName)) return null;
    return parsed.namespace.term(parsed.localName);
  }

  /**
   * Extracts the body content from a markdown file (everything after the frontmatter).
   *
   * @param content - Full file content including frontmatter
   * @returns Body content without frontmatter, or full content if no frontmatter
   */
  private extractBodyContent(content: string): string {
    // Frontmatter pattern: starts with ---, ends with ---
    const frontmatterPattern = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
    return content.replace(frontmatterPattern, "");
  }

  /**
   * Extracts all wikilinks from markdown body content.
   *
   * Matches both [[Target]] and [[Target|Alias]] formats.
   * Does NOT match embedded images: ![[image.png]]
   *
   * @param bodyContent - The markdown body content (without frontmatter)
   * @returns Array of unique wikilink targets
   *
   * @example
   * ```typescript
   * const links = extractBodyWikilinks("See [[Note A]] and [[Note B|alias]].");
   * // Returns: ["Note A", "Note B"]
   * ```
   */
  extractBodyWikilinks(bodyContent: string): string[] {
    const links = new Set<string>();
    let match: RegExpExecArray | null;

    // Reset regex lastIndex for each call (important for global regex)
    const pattern = new RegExp(this.BODY_WIKILINK_PATTERN.source, "g");

    while ((match = pattern.exec(bodyContent)) !== null) {
      // match[1] contains the link target (without alias)
      if (match[1]) {
        links.add(match[1]);
      }
    }

    return Array.from(links);
  }

  /**
   * Converts body wikilinks to RDF triples.
   *
   * Issue #1329: Index body wikilinks to enable complete graph analysis.
   * Body links are stored with predicate exo:Asset_bodyLink.
   *
   * @param file - The source file
   * @param subject - The subject IRI for the note
   * @returns Array of triples for body links
   */
  async convertBodyWikilinks(
    file: IFile,
    subject: IRI,
  ): Promise<Triple[]> {
    const triples: Triple[] = [];

    try {
      const content = await this.vault.read(file);
      const bodyContent = this.extractBodyContent(content);
      const wikilinks = this.extractBodyWikilinks(bodyContent);

      const bodyLinkPredicate = Namespace.EXO.term("Asset_bodyLink");

      for (const linkTarget of wikilinks) {
        // Try to resolve the wikilink to an actual file
        const targetFile = this.vault.getFirstLinkpathDest(
          linkTarget,
          file.path
        );

        if (targetFile) {
          // Link resolves to a file - use file IRI
          const objectIRI = this.notePathToIRI(targetFile.path);
          triples.push(new Triple(subject, bodyLinkPredicate, objectIRI));
        } else if (this.isClassReference(linkTarget)) {
          // Link might be a class reference (ems__/exo__ prefix)
          const classIRI = this.expandClassValue(linkTarget);
          if (classIRI) {
            triples.push(new Triple(subject, bodyLinkPredicate, classIRI));
          } else {
            // Could not expand - store as literal
            triples.push(new Triple(subject, bodyLinkPredicate, new Literal(linkTarget)));
          }
        } else {
          // Link doesn't resolve - store the target as literal for discoverability
          triples.push(new Triple(subject, bodyLinkPredicate, new Literal(linkTarget)));
        }
      }
    } catch {
      // If file read fails, silently skip body links (file may be binary or inaccessible)
    }

    return triples;
  }
}

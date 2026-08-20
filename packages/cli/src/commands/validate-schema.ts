import { Command } from "commander";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, relative, join } from "path";
import { execSync } from "child_process";
import * as yaml from "js-yaml";
import {
  InMemoryTripleStore,
  ExoQLParser,
  ExoQLAlgebraTranslator,
  AlgebraOptimizer,
  ExoQLQueryExecutor,
  NoteToRDFConverter,
  Triple,
  ShapeLoader,
  ShaclShapeRegistry,
  shaclValidate,
  DomainIRI,
  DomainLiteral,
  DomainTriple,
  type ValidationReport,
  type Violation,
  type ClassHierarchy,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { detectTermIriCollisions } from "../services/termIriCollisions.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";
import { CacheManager } from "../cache/CacheManager.js";
import { injectExocortexPrefixes } from "../utils/QueryPrefixInjector.js";

/**
 * Non-ontology YAML keys used by Obsidian or convention.
 * These are never checked against the ontology.
 */
export const NON_ONTOLOGY_KEYS: ReadonlySet<string> = new Set([
  "aliases",
  "archived",
  "tags",
  "cssclasses",
  "publish",
  "permalink",
  "description",
  "image",
  "cover",
  "banner",
  "title",
  // Obsidian Share plugin
  "share",
  "share_link",
  "share_updated",
  // Metadata / other plugins
  "metadata",
  "uri",
]);

/**
 * Known Exocortex namespace prefixes used in frontmatter property keys.
 * Maps the double-underscore prefix to the ontology namespace URI.
 */
export const NAMESPACE_PREFIX_MAP: ReadonlyMap<string, string> = new Map([
  ["exo__", "https://exocortex.my/ontology/exo#"],
  ["ems__", "https://exocortex.my/ontology/ems#"],
  ["exocmd__", "https://exocortex.my/ontology/exocmd#"],
  ["ims__", "https://exocortex.my/ontology/ims#"],
  // RFC 78c2b7d0 C4 — read-side query ontology (exoql__Query) + its C4
  // refinement (query__NamedQuery). Without these, TripleClassHierarchy's
  // labelToOntologyIRI returns null for query__/exoql__ class labels, so the
  // ontology-URI subClassOf edges (query#NamedQuery → exoql#Query → exo#Asset)
  // are never built — making `sh:class exo__Asset` range checks on a
  // `targetValueQuery → query__NamedQuery` reference (C5 «Archive Ontologically»)
  // a false violation even though NamedQuery IS-A exo__Asset via that chain.
  // NoteToRDFConverter already derives these IRIs dynamically (Namespace.fromPropertyKey);
  // this keeps the validator's curated prefix registry in sync.
  ["exoql__", "https://exocortex.my/ontology/exoql#"],
  ["query__", "https://exocortex.my/ontology/query#"],
  ["ztlk__", "https://exocortex.my/ontology/ztlk#"],
  ["ptms__", "https://exocortex.my/ontology/ptms#"],
  ["lit__", "https://exocortex.my/ontology/lit#"],
  ["inbox__", "https://exocortex.my/ontology/inbox#"],
  ["place__", "https://exocortex.my/ontology/place#"],
  ["pn__", "https://exocortex.my/ontology/pn#"],
  ["period__", "https://exocortex.my/ontology/period#"],
  // External W3C vocabularies — canonical bases, matching core's
  // Namespace.KNOWN_NAMESPACES (req aceaa2cc-15b6-4e1c-bf63-72c7c209de51).
  // `xsd__`/`sh__` were absent while rdf/rdfs/owl were already canonical here;
  // once core emits all five canonically, a missing entry means this map builds
  // subClassOf edges under a DIFFERENT IRI than the converter emits, so
  // isSubClassOf returns false → false `sh:class` violations (the `person__`
  // incident documented at labelToOntologyIRI below).
  ["rdf__", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  ["rdfs__", "http://www.w3.org/2000/01/rdf-schema#"],
  ["owl__", "http://www.w3.org/2002/07/owl#"],
  ["xsd__", "http://www.w3.org/2001/XMLSchema#"],
  ["sh__", "http://www.w3.org/ns/shacl#"],
]);

export type ShapesFormat = "text" | "json" | "earl";

export interface ValidateSchemaOptions {
  vault: string;
  output?: OutputFormat;
  staged?: boolean;
  useCache?: boolean;
  shapesMode?: boolean;
  format?: ShapesFormat;
  /** RFC 8e83442b T1.4: only validate files whose exo__Instance_class contains this IRI/slug. */
  class?: string;
}

/**
 * RFC 8e83442b T1.4: Check whether a file's frontmatter exo__Instance_class
 * declarations include the requested class. Match is permissive — substring
 * match on the wikilink target (so users can pass either the full IRI, the
 * slug like "ems__Task", or the bare UUID).
 */
export function frontmatterMatchesClass(
  frontmatter: Record<string, unknown> | null,
  classFilter: string,
): boolean {
  if (!frontmatter) return false;
  const raw = frontmatter["exo__Instance_class"];
  if (raw === undefined || raw === null) return false;
  const values = Array.isArray(raw) ? raw : [raw];
  for (const v of values) {
    if (typeof v !== "string") continue;
    // Strip wikilink brackets and alias suffix
    const match = v.match(/\[\[([^|\]]+)/);
    const target = match ? match[1] : v;
    if (target === classFilter) return true;
    if (target.includes(classFilter)) return true;
  }
  return false;
}

/**
 * Loads triples from the vault into a single array.
 */
async function loadTriplesFromAllVaults(
  vaultPath: string,
  useCache: boolean,
): Promise<{ triples: DomainTriple[]; cacheHit: boolean }> {
  let triples: DomainTriple[];
  let cacheHit = false;
  if (useCache) {
    const cacheManager = new CacheManager(vaultPath);
    const cacheResult = await cacheManager.loadOrBuild();
    triples = cacheResult.triples as DomainTriple[];
    cacheHit = cacheResult.cacheHit;
  } else {
    const adapter = new FileSystemVaultAdapter(vaultPath);
    const converter = new NoteToRDFConverter(adapter);
    triples = (await converter.convertVault()) as DomainTriple[];
  }

  return { triples, cacheHit };
}

const RDF_TYPE_IRI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/**
 * Resolves a focusNode IRI (obsidian://vault/<relPath>) to the absolute
 * filesystem path inside one of the vault roots. Returns the first vault
 * root whose <root>/<relPath> exists; falls back to primary vault otherwise.
 */
export function qualifyFocusNodePath(
  focusNode: string,
  vaultPaths: string[],
): string {
  const prefix = "obsidian://vault/";
  let relPath = focusNode;
  if (focusNode.startsWith(prefix)) {
    relPath = decodeURIComponent(focusNode.substring(prefix.length));
  } else {
    return focusNode;
  }
  for (const root of vaultPaths) {
    const candidate = join(root, relPath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return join(vaultPaths[0] ?? "", relPath);
}

export interface SchemaViolation {
  file: string;
  property: string;
  reason: string;
}

export interface SchemaValidationResult {
  vaultPath: string;
  filesChecked: number;
  violations: SchemaViolation[];
  healthy: boolean;
}

/**
 * Extract frontmatter from a .md file's raw content.
 * Returns null if no valid frontmatter block is found.
 */
export function extractFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    // Handle empty frontmatter: ---\n---
    if (content.match(/^---\r?\n---/)) return {};
    return null;
  }

  // Simple YAML key extraction — we only need top-level keys
  const lines = match[1].split("\n");
  const result: Record<string, unknown> = {};
  for (const line of lines) {
    // Match top-level YAML keys: "key:" or "key: value"
    const keyMatch = line.match(/^(\w[\w]*):\s*(.*)$/);
    if (keyMatch) {
      result[keyMatch[1]] = true; // We only care about key existence
    }
  }
  return result;
}

/**
 * Check if a frontmatter key uses a known Exocortex namespace prefix.
 */
export function hasKnownPrefix(key: string): boolean {
  for (const prefix of NAMESPACE_PREFIX_MAP.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Convert a frontmatter key to its full ontology URI.
 * e.g., "ems__Effort_status" → "https://exocortex.my/ontology/ems#Effort_status"
 *
 * Returns null if no matching prefix is found.
 */
export function keyToURI(key: string): string | null {
  for (const [prefix, uri] of NAMESPACE_PREFIX_MAP) {
    if (key.startsWith(prefix)) {
      return uri + key.substring(prefix.length);
    }
  }
  return null;
}

/**
 * Convert a full ontology URI back to a frontmatter key.
 * e.g., "https://exocortex.my/ontology/ems#Effort_status" → "ems__Effort_status"
 *
 * Returns null if no matching namespace is found.
 */
export function uriToKey(uri: string): string | null {
  for (const [prefix, nsUri] of NAMESPACE_PREFIX_MAP) {
    if (uri.startsWith(nsUri)) {
      return prefix + uri.substring(nsUri.length);
    }
  }
  return null;
}

/**
 * Determine which frontmatter keys should be validated against the ontology.
 * Filters out NON_ONTOLOGY_KEYS and keys without a known namespace prefix.
 *
 * Keys without a known prefix that are NOT in the whitelist are flagged
 * with reason "unknown_prefix".
 */
export function classifyKeys(
  keys: string[],
): { toValidate: string[]; unknownPrefix: string[] } {
  const toValidate: string[] = [];
  const unknownPrefix: string[] = [];

  for (const key of keys) {
    if (NON_ONTOLOGY_KEYS.has(key)) continue;
    if (hasKnownPrefix(key)) {
      toValidate.push(key);
    } else {
      unknownPrefix.push(key);
    }
  }

  return { toValidate, unknownPrefix };
}

/**
 * Get list of git-staged .md files relative to vault path.
 */
export function getStagedMdFiles(vaultPath: string): string[] {
  try {
    const stdout = execSync("git diff --cached --name-only", {
      cwd: vaultPath,
      encoding: "utf-8",
    });
    return stdout
      .split("\n")
      .filter((f) => f.endsWith(".md") && f.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Collect all .md files in a vault directory (recursive).
 */
function collectMdFiles(dirPath: string): string[] {
  const result: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".md")) {
        result.push(relative(dirPath, fullPath));
      }
    }
  }

  walk(dirPath);
  return result;
}

/**
 * Extract property name from an obsidian:// vault URI.
 * e.g., "obsidian://vault/03%20Knowledge/ems/ems__Effort_status.md"
 *   → "ems__Effort_status"
 *
 * Returns null if the filename doesn't look like an Exocortex property key.
 */
export function extractPropertyNameFromURI(uri: string): string | null {
  // Get the filename from the URI path
  const lastSlash = uri.lastIndexOf("/");
  if (lastSlash === -1) return null;
  let filename = decodeURIComponent(uri.substring(lastSlash + 1));
  if (filename.endsWith(".md")) {
    filename = filename.slice(0, -3);
  }
  // Only return if it looks like an Exocortex property (has known prefix)
  if (hasKnownPrefix(filename)) {
    return filename;
  }
  return null;
}

/**
 * Build the set of declared property URIs from the ontology in the vault.
 *
 * Two-pass approach:
 * 1. Query all notes typed as *Property → extract property names from
 *    subject URIs (filename) and from exo:Asset_label IRI values
 * 2. Convert property names to full ontology URIs
 *
 * One SPARQL query total — O(1) not O(files).
 */
export async function loadDeclaredProperties(
  triples: Triple[],
): Promise<Set<string>> {
  const tripleStore = new InMemoryTripleStore();
  await tripleStore.addAll(triples);

  const parser = new ExoQLParser();

  // Query: Get all subjects that are Property instances via two paths:
  // 1. rdf:type (properly resolved exo__Instance_class values)
  // 2. exo:Instance_class literal (UUID wikilinks stored as strings)
  const queryString = injectExocortexPrefixes(
    `SELECT ?s ?label WHERE {
      {
        ?s a ?type .
        FILTER(CONTAINS(STR(?type), "Property"))
        FILTER(!CONTAINS(STR(?type), "PropertySchema"))
        FILTER(!CONTAINS(STR(?type), "PropertySetRule"))
        FILTER(!CONTAINS(STR(?type), "PropertyCardinality"))
      }
      UNION
      {
        ?s exo:Instance_class ?class .
        FILTER(CONTAINS(STR(?class), "Property"))
        FILTER(!CONTAINS(STR(?class), "PropertySchema"))
        FILTER(!CONTAINS(STR(?class), "PropertySetRule"))
        FILTER(!CONTAINS(STR(?class), "PropertyCardinality"))
      }
      OPTIONAL { ?s exo:Asset_label ?label }
    }`
  );

  const ast = parser.parse(queryString);
  const translator = new ExoQLAlgebraTranslator();
  let algebra = translator.translate(ast);
  const optimizer = new AlgebraOptimizer();
  algebra = optimizer.optimize(algebra);

  const executor = new ExoQLQueryExecutor(tripleStore);
  const results = await executor.executeAll(algebra);

  const declaredProperties = new Set<string>();

  for (const result of results) {
    const json = result.toJSON();

    // Source 1: Extract property name from subject URI filename
    const subject = json.s;
    if (typeof subject === "string") {
      const propName = extractPropertyNameFromURI(subject);
      if (propName) {
        const uri = keyToURI(propName);
        if (uri) declaredProperties.add(uri);
      }
    }

    // Source 2: IRI labels (full ontology URIs stored as exo:Asset_label)
    const label = json.label;
    if (typeof label === "string" && label.startsWith("https://exocortex.my/ontology/")) {
      declaredProperties.add(label);
    }
  }

  return declaredProperties;
}

/**
 * Detect frontmatter that a STRICT YAML parser rejects — most notably a
 * duplicated mapping key (#3800). Such files are invisible to
 * SPARQL/preconditions (an adapter falls back to `{}` → 0 triples) yet the
 * regex-based {@link extractFrontmatter} above still key-extracts them, so
 * `validate schema` used to skip them silently. Returns a one-line reason, or
 * null when the frontmatter parses strictly (or there is no frontmatter block).
 */
export function detectUnparseableFrontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    yaml.load(match[1]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.split("\n")[0] : String(error);
  }
}

/**
 * Validate a single file's frontmatter against the declared properties set.
 */
export function validateFile(
  filePath: string,
  relativePath: string,
  declaredPropertyURIs: Set<string>,
): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  // #3800: surface frontmatter a strict YAML parser rejects (e.g. a duplicated
  // mapping key) — otherwise the file is invisible to SPARQL/preconditions AND
  // to this validator. Reported so the user can fix it via `repair-frontmatter`.
  const parseError = detectUnparseableFrontmatter(content);
  if (parseError) {
    violations.push({
      file: relativePath,
      property: "(frontmatter)",
      reason: `Unparseable YAML frontmatter (${parseError}) — invisible to SPARQL/preconditions; repair with: exocortex repair-frontmatter "${relativePath}"`,
    });
  }

  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) return violations;

  const keys = Object.keys(frontmatter);
  const { toValidate, unknownPrefix } = classifyKeys(keys);

  // Report unknown prefix keys
  for (const key of unknownPrefix) {
    violations.push({
      file: relativePath,
      property: key,
      reason: `Unknown namespace prefix in "${key}"`,
    });
  }

  // Check known-prefix keys against ontology
  for (const key of toValidate) {
    const uri = keyToURI(key);
    if (uri && !declaredPropertyURIs.has(uri)) {
      violations.push({
        file: relativePath,
        property: key,
        reason: `Property "${key}" is not declared in the ontology`,
      });
    }
  }

  return violations;
}

const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const EXO_CLASS_SUPER_CLASS = "https://exocortex.my/ontology/exo#Class_superClass";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

/**
 * Converts a frontmatter label string (e.g. "ims__Concept") to its ontology URI
 * (e.g. "https://exocortex.my/ontology/ims#Concept").
 *
 * Resolution is namespace-agnostic (Issue #3512): the curated NAMESPACE_PREFIX_MAP
 * is consulted first (it carries the non-exocortex.my namespaces — rdf/rdfs/owl —
 * whose URIs do NOT follow the standard ontology pattern), then ANY well-formed
 * lowercase-leading prefix falls back to the canonical
 * `https://exocortex.my/ontology/<prefix>#<Local>` form. This mirrors
 * Namespace.forPrefix / NoteToRDFConverter, which already derive ad-hoc namespaces
 * for unlisted prefixes.
 *
 * Returns null if the label is not a well-formed `<prefix>__<Local>` token.
 */
export function labelToOntologyIRI(label: string): string | null {
  const dunderIdx = label.indexOf("__");
  if (dunderIdx === -1) return null;
  const prefixWithDunder = label.slice(0, dunderIdx + 2); // e.g. "ims__"
  const prefix = label.slice(0, dunderIdx); // e.g. "ims"
  const local = label.slice(dunderIdx + 2); // e.g. "Concept"
  if (!local) return null;

  // 1. Curated map first — preserves the non-standard namespaces (rdf/rdfs/owl)
  //    and the canonical exocortex prefixes verbatim.
  const ns = NAMESPACE_PREFIX_MAP.get(prefixWithDunder);
  if (ns) return ns + local;

  // 2. Namespace-agnostic fallback (Issue #3512): derive the canonical ontology
  //    IRI for any well-formed lowercase prefix not in the curated map. Without
  //    this, ontology-URI subClassOf edges for classes in namespaces like
  //    `person__` were never materialised in TripleClassHierarchy, so
  //    isSubClassOf("person#Person", "ems#Agent") returned false — a false
  //    sh:class violation even though person__Person IS-A ems__Agent via
  //    exo__Class_superClass. (The legacy `ims__Person` bridged only because
  //    `ims__` happened to be in the curated map; the only difference between the
  //    two classes is the prefix.) Prefix shape mirrors Namespace.forPrefix; the
  //    local-name guard mirrors NoteToRDFConverter.expandClassValue (which rejects
  //    `[\s()]` local names) so the derived IRI always matches the converter's
  //    emitted rdf:type — never an inert, unmatchable hierarchy entry.
  if (/^[a-z][a-zA-Z0-9]*$/.test(prefix) && !/[\s()]/.test(local)) {
    return `https://exocortex.my/ontology/${prefix}#${local}`;
  }
  return null;
}

/**
 * Tries to extract an ontology URI from a file IRI by examining the filename.
 * File IRIs for label-named class files look like:
 *   obsidian://vault/03%20Knowledge/exo/exo__Asset.md
 * The filename stem "exo__Asset" can be converted to "https://exocortex.my/ontology/exo#Asset".
 * Returns null for UUID-named files or unrecognised prefixes.
 */
function fileIriToOntologyURIFromFilename(fileIri: string): string | null {
  const decodedIri = decodeURIComponent(fileIri);
  const lastSlash = decodedIri.lastIndexOf("/");
  if (lastSlash === -1) return null;
  const filename = decodedIri.slice(lastSlash + 1);
  const stem = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  return labelToOntologyIRI(stem);
}

type AlgebraIRI = { type: "iri"; value: string };
type AlgebraLiteral = { type: "literal"; value: string; datatype?: string; language?: string };
type AlgebraBlank = { type: "blank"; value: string };
type AlgebraNode = AlgebraIRI | AlgebraLiteral | AlgebraBlank;

interface AlgebraStyleTriple {
  subject: AlgebraNode;
  predicate: AlgebraNode;
  object: AlgebraNode;
}

/**
 * Converts domain Triple[] (class-based) to algebra-compatible Triple[] (interface-based).
 * Required because ShaclLiteValidator.validate() expects algebra Triple types.
 */
export function domainToAlgebraTriples(triples: DomainTriple[]): AlgebraStyleTriple[] {
  const mapNode = (node: unknown): AlgebraNode | null => {
    if (node instanceof DomainIRI) return { type: "iri", value: node.value };
    if (node instanceof DomainLiteral) {
      const lit: AlgebraLiteral = { type: "literal", value: node.value };
      if (node.datatype) lit.datatype = node.datatype.value;
      if (node.language) lit.language = node.language;
      return lit;
    }
    return null;
  };

  const result: AlgebraStyleTriple[] = [];
  for (const t of triples) {
    const s = mapNode(t.subject);
    const p = mapNode(t.predicate);
    const o = mapNode(t.object);
    if (s && p && o) result.push({ subject: s, predicate: p, object: o });
  }
  return result;
}

/**
 * Builds a ClassHierarchy by extracting rdfs:subClassOf triples.
 *
 * The hierarchy is built in two IRI spaces simultaneously:
 *   1. File IRIs  — from rdfs:subClassOf triples as emitted by NoteToRDFConverter
 *   2. Ontology URIs — derived via rdfs:label + NAMESPACE_PREFIX_MAP
 *
 * This dual mapping is necessary because exo__Instance_class values are converted
 * to ontology URIs (e.g. "ims#Concept") while rdfs:subClassOf triples use file IRIs.
 * Without the dual mapping, isSubClassOf("ims#Concept", "exo#Asset") always returns false.
 */
export class TripleClassHierarchy implements ClassHierarchy {
  private readonly subClassMap: Map<string, Set<string>> = new Map();

  constructor(triples: DomainTriple[]) {
    // Pass 1: build fileIRI → ontologyURI map.
    // Primary source: rdfs:label triples (e.g. from UUID-named class files with exo__Asset_label).
    // Fallback: filename stem (e.g. "exo__Asset.md" → exo#Asset for label-named class files).
    const fileIriToOntologyUri = new Map<string, string>();

    // Collect file IRIs that appear in rdfs:subClassOf or exo:Class_superClass triples
    // (candidates for class files that need their ontologyURI resolved)
    const classFileIris = new Set<string>();
    const isSubClassPredicate = (iri: string) =>
      iri === RDFS_SUBCLASS_OF || iri === EXO_CLASS_SUPER_CLASS;
    for (const t of triples) {
      if (
        t.predicate instanceof DomainIRI &&
        isSubClassPredicate(t.predicate.value) &&
        t.subject instanceof DomainIRI &&
        t.object instanceof DomainIRI
      ) {
        classFileIris.add(t.subject.value);
        classFileIris.add(t.object.value);
      }
    }

    // Populate from rdfs:label triples first (preferred — explicit label)
    for (const t of triples) {
      if (
        t.predicate instanceof DomainIRI &&
        t.predicate.value === RDFS_LABEL &&
        t.subject instanceof DomainIRI &&
        t.object instanceof DomainLiteral
      ) {
        const ontologyUri = labelToOntologyIRI(t.object.value);
        if (ontologyUri) {
          fileIriToOntologyUri.set(t.subject.value, ontologyUri);
        }
      }
    }

    // Fallback: derive from filename for class-file IRIs not covered by rdfs:label
    for (const fileIri of classFileIris) {
      if (!fileIriToOntologyUri.has(fileIri)) {
        const ontologyUri = fileIriToOntologyURIFromFilename(fileIri);
        if (ontologyUri) {
          fileIriToOntologyUri.set(fileIri, ontologyUri);
        }
      }
    }

    // Pass 2a: add identity entries so that fileIri is-a ontologyUri.
    // Example: <dda12c48-file-IRI> rdfs:label "ims__Concept"
    // → isSubClassOf("dda12c48-file-IRI", "ims#Concept") must return true.
    // This handles the case where exo__Instance_class stores a UUID wikilink
    // (resolves to file IRI) but the range check uses the ontology URI.
    for (const [fileIri, ontUri] of fileIriToOntologyUri) {
      const selfSet = this.subClassMap.get(fileIri) ?? new Set<string>();
      selfSet.add(ontUri);
      this.subClassMap.set(fileIri, selfSet);
    }

    // Pass 2b: build subClassMap for both file IRIs and ontology URIs.
    // Processes both rdfs:subClassOf and exo:Class_superClass (the Exocortex-native
    // superclass declaration predicate). Without exo:Class_superClass support, classes
    // declared via exo__Class_superClass (e.g. ims#Concept → exo#Asset) are invisible
    // to the hierarchy, causing false sh:class violations on properties like exo:Asset_relates.
    for (const t of triples) {
      if (
        t.predicate instanceof DomainIRI &&
        isSubClassPredicate(t.predicate.value) &&
        t.subject instanceof DomainIRI &&
        t.object instanceof DomainIRI
      ) {
        const childFileIri = t.subject.value;
        const parentFileIri = t.object.value;

        // File IRI hierarchy entry (original behaviour)
        const fileSet = this.subClassMap.get(childFileIri) ?? new Set<string>();
        fileSet.add(parentFileIri);
        this.subClassMap.set(childFileIri, fileSet);

        // Ontology URI hierarchy entry (enables isSubClassOf for ontology URIs).
        // The parent object may already be an ontology URI (when [[exo__Asset]] wikilink
        // resolves to a class-named file and NoteToRDFConverter emits the namespace IRI
        // directly). In that case, use it as-is; otherwise look it up via fileIriToOntologyUri
        // or fall back to the filename-derived mapping.
        const childOntUri = fileIriToOntologyUri.get(childFileIri);
        const parentOntUri = parentFileIri.startsWith("obsidian://")
          ? fileIriToOntologyUri.get(parentFileIri)
          : parentFileIri; // already an ontology URI
        if (childOntUri && parentOntUri) {
          const ontSet = this.subClassMap.get(childOntUri) ?? new Set<string>();
          ontSet.add(parentOntUri);
          this.subClassMap.set(childOntUri, ontSet);
        }
      }
    }

    // Pass 3: Single-level metaclass propagation (Issue #3247).
    //
    // Rule (one level only): ∀C: if `<C> rdf:type <Mc>` AND `<Mc> rdfs:subClassOf <Super>`
    //                              (directly or transitively, as already in subClassMap),
    //                              then `<C> rdfs:subClassOf <Super>` (inferred).
    //
    // Specifically: any class file typed as exo:Class (the meta-class for classes)
    // inherits exo:Class's own superClass declarations. Without this pass, class
    // files that fail to declare `exo__Class_superClass: [[exo__Asset]]` produce
    // false sh:class violations for every instance, even though the chain is
    // logically derivable from the metaclass declaration alone.
    //
    // Scope note: this is single-level OWL Full punning, NOT a fixpoint loop.
    // It propagates ONE step from Mc → C using `subClassMap` as populated by
    // Pass 2b. Multi-level meta chains (Mc2 rdf:type Mc1, Mc1 subClassOf X,
    // C rdf:type Mc2 → expect C subClassOf X) are order-dependent and may miss
    // the propagation. Sufficient for the current vault shape (only `exo:Class`
    // serves as a meta-class). If multi-level meta is introduced in future,
    // wrap this pass in a do/while loop until `subClassMap.size` stabilises.
    //
    // Naming: variables are named generically (childIri / metaclassIri) because
    // rdf:type triples carry EITHER file IRIs OR ontology URIs depending on the
    // emission path in NoteToRDFConverter:
    //   - main path (valueToClassURI): object is ontology URI for labeled
    //     classes, file IRI for label-less (Issue #3242 fall-back).
    //   - enum-instance path: both subject and object are ontology URIs.
    // The dual indexing (file IRI scope + ontology URI scope) handles both
    // uniformly through subClassMap.
    //
    // Instance pollution caveat: this pass fires for ALL rdf:type triples,
    // including instance-level ones (e.g. `<task> rdf:type ems:Task`). The
    // resulting `<task> subClassMap += {ems:Effort, exo:Asset}` is semantically
    // incorrect (an instance is a *member*, not a *subclass*), but currently
    // INERT because `ShaclLiteValidator.isSubClassOf(...)` only ever calls with
    // class IRIs in the `child` position (sourced from `subjectClasses` map
    // built from rdf:type objects). Future callers must NOT rely on subClassMap
    // for class-vs-instance discrimination.
    //
    // Cost: empirically vault-2025 emits ~12-15K rdf:type triples (one per
    // exo__Instance_class value + enum paths). With chain depth ≤4 and
    // dual-index ops O(1), total ~50-100K Set operations — sub-second.
    const typeTriples = triples.filter(
      (t) =>
        t.predicate instanceof DomainIRI &&
        t.predicate.value === RDF_TYPE_IRI &&
        t.subject instanceof DomainIRI &&
        t.object instanceof DomainIRI,
    );
    for (const t of typeTriples) {
      const childIri = (t.subject as DomainIRI).value;
      const metaclassIri = (t.object as DomainIRI).value;

      // Collect all supers of the metaclass (transitive BFS over current subClassMap)
      const metaSupers = this.collectAncestors(metaclassIri);

      // Primary IRI scope: child inherits each meta-super (skip self-loops)
      for (const sup of metaSupers) {
        if (childIri === sup) continue;
        const set = this.subClassMap.get(childIri) ?? new Set<string>();
        set.add(sup);
        this.subClassMap.set(childIri, set);
      }

      // Ontology URI scope: if both child and the meta-supers resolve to
      // ontology URIs, propagate them as well. This keeps the dual-index
      // behaviour from Pass 2b consistent — `isSubClassOf` callers may use
      // either IRI form.
      const childOntUri = fileIriToOntologyUri.get(childIri);
      if (!childOntUri) continue;
      // Ontology-URI supers may be either ontology URIs (when meta-super was
      // already an ontology URI parent) or file IRIs that we can resolve back
      // to ontology URIs.
      for (const sup of metaSupers) {
        const supOntUri = sup.startsWith("obsidian://")
          ? fileIriToOntologyUri.get(sup)
          : sup;
        if (!supOntUri || childOntUri === supOntUri) continue;
        const set = this.subClassMap.get(childOntUri) ?? new Set<string>();
        set.add(supOntUri);
        this.subClassMap.set(childOntUri, set);
      }
    }
  }

  /**
   * Collect all ancestors of `iri` reachable through the existing subClassMap.
   * Cycle-safe via visited set. Used by metaclass inference (Pass 3) to find the
   * transitive superclass chain of a metaclass before propagating to instances.
   */
  private collectAncestors(iri: string): Set<string> {
    const result = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [iri];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const supers = this.subClassMap.get(current);
      if (!supers) continue;
      for (const s of supers) {
        if (s === iri) continue; // skip ancestors equal to the starting node
        result.add(s);
        if (!visited.has(s)) queue.push(s);
      }
    }
    return result;
  }

  isSubClassOf(child: string, parent: string): boolean {
    const visited = new Set<string>();
    const queue: string[] = [child];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === parent) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const superClasses = this.subClassMap.get(current);
      if (superClasses) {
        for (const sc of superClasses) queue.push(sc);
      }
    }
    return false;
  }
}

export interface EARLReport {
  "@context": Record<string, string>;
  "@graph": unknown[];
}

/**
 * Maps a SHACL severity onto an EARL outcome.
 *
 * EARL has no "warning" outcome — its vocabulary offers passed / failed /
 * cantTell / inapplicable / untested. `earl:cantTell` is the one that means
 * "the assertion was made, but the result is neither a pass nor a fail",
 * which is exactly what an sh:Warning (or sh:Info) is here: the CLI keeps
 * `conforms` true and exits 0 for them, so reporting them as `earl:failed`
 * made the EARL surface contradict the other two.
 *
 * The set enumerates the NON-failing severities rather than the failing one
 * on purpose: an unrecognised severity then lands on `earl:failed`, so an
 * EARL consumer gating on failures errs towards a false alarm rather than
 * towards silence.
 */
const NON_FAILING_SEVERITIES = new Set(["sh:Warning", "sh:Info"]);

function earlOutcomeFor(severity: string): string {
  return NON_FAILING_SEVERITIES.has(severity) ? "earl:cantTell" : "earl:failed";
}

/**
 * Formats a ValidationReport as W3C EARL JSON-LD.
 */
export function buildEARLReport(vaultPath: string, report: ValidationReport): EARLReport {
  const subjectId = `file://${vaultPath}`;
  const assertorId = "https://exocortex.my/cli/shacl-validator";

  const context = {
    earl: "http://www.w3.org/ns/earl#",
    dc: "http://purl.org/dc/terms/",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    sh: "http://www.w3.org/ns/shacl#",
  };

  const graph: unknown[] = [
    {
      "@type": "earl:Assertor",
      "@id": assertorId,
      "dc:title": "Exocortex CLI SHACL-lite Validator",
    },
    {
      "@type": "earl:TestSubject",
      "@id": subjectId,
      "dc:title": vaultPath,
    },
  ];

  if (report.violations.length === 0) {
    graph.push({
      "@type": "earl:Assertion",
      "earl:assertedBy": { "@id": assertorId },
      "earl:subject": { "@id": subjectId },
      "earl:result": {
        "@type": "earl:TestResult",
        "earl:outcome": { "@id": "earl:passed" },
        "dc:description": "All nodes conform to shapes",
      },
    });
  } else {
    for (const v of report.violations) {
      graph.push({
        "@type": "earl:Assertion",
        "earl:assertedBy": { "@id": assertorId },
        "earl:subject": { "@id": subjectId },
        "earl:test": { "@id": v.propertyPath },
        "earl:result": {
          "@type": "earl:TestResult",
          "earl:outcome": { "@id": earlOutcomeFor(v.severity) },
          "dc:description": v.message,
          "sh:focusNode": v.focusNode,
          "sh:resultPath": v.propertyPath,
          "sh:resultSeverity": { "@id": `sh:${v.severity.replace("sh:", "")}` },
          ...(v.actualValue !== undefined ? { "sh:value": v.actualValue } : {}),
        },
      });
    }
  }

  return { "@context": context, "@graph": graph };
}

const LEGACY_EXCEPTION_IRI = "https://exocortex.my/ontology/exo#Asset_legacyValidationException";

/**
 * P4.3: Filters out violations for assets marked with exo__Asset_legacyValidationException.
 * Grandfathered assets have pre-existing violations that are intentionally silenced.
 */
export function applyLegacyExceptionFilter(
  triples: DomainTriple[],
  report: ValidationReport,
): ValidationReport {
  const exemptNodes = new Set<string>(
    triples
      .filter(t => t.predicate instanceof DomainIRI && t.predicate.value === LEGACY_EXCEPTION_IRI)
      .map(t => (t.subject instanceof DomainIRI ? t.subject.value : null))
      .filter((v): v is string => v !== null),
  );
  if (exemptNodes.size === 0) return report;
  const violations = report.violations.filter(v => !exemptNodes.has(v.focusNode));
  return {
    conforms: violations.every(v => v.severity !== "sh:Violation"),
    violations,
  };
}

/**
 * Runs SHACL-lite shapes validation against vault triples.
 */
export async function runShapesValidation(
  vaultPath: string,
  triples: DomainTriple[],
): Promise<ValidationReport> {
  // Load shapes from the merged RDF graph rather than the filesystem. After
  // RFC-004 UUID-canonicalization, exo__Property_domain/range frontmatter is
  // pure-UID wikilinks (`[[<uid>]]`) that the filesystem loader cannot resolve
  // to canonical class IRIs without scanning every TBox class file. The graph
  // loader uses in-memory rdfs:label triples to bridge file IRI → namespace
  // IRI.
  void vaultPath;
  const tripleStore = new InMemoryTripleStore();
  await tripleStore.addAll(triples as unknown as Triple[]);
  const registry = new ShaclShapeRegistry(
    (await ShapeLoader.loadFromRDFGraph(tripleStore)).getAll(),
  );
  const hierarchy = new TripleClassHierarchy(triples);
  const algebraTriples = domainToAlgebraTriples(triples);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return shaclValidate(algebraTriples as any, registry, hierarchy);
}

/**
 * Issue #3245: Filter a SHACL ValidationReport to only those violations whose
 * focusNode resolves to a path in the staged-files set. focusNode IRIs emitted
 * by NoteToRDFConverter use the `obsidian://vault/<encoded-relPath>` form, so
 * decode the suffix and intersect with the staged relPath set.
 *
 * Violations whose focusNode does NOT use the obsidian://vault/ scheme (e.g.
 * synthetic IRIs or shape-level diagnostics) are dropped — staged-mode is
 * scoped to per-file ABox violations by definition.
 */
export function filterReportToStagedFocusNodes(
  report: ValidationReport,
  stagedRelPaths: ReadonlySet<string>,
): ValidationReport {
  const prefix = "obsidian://vault/";
  const violations = report.violations.filter((v) => {
    if (!v.focusNode.startsWith(prefix)) return false;
    let relPath: string;
    try {
      relPath = decodeURIComponent(v.focusNode.substring(prefix.length));
    } catch {
      relPath = v.focusNode.substring(prefix.length);
    }
    return stagedRelPaths.has(relPath);
  });
  return {
    conforms: violations.every((v) => v.severity !== "sh:Violation"),
    violations,
  };
}

/**
 * Issue #3245: Emit the "no staged files" success response in the same shape
 * runShapesModeAction would normally produce, so pre-commit hooks see a
 * consistent contract (conforms=true, violationCount=0, exit 0).
 */
function emitEmptyStagedShapesResult(
  vaultPath: string,
  fmt: ShapesFormat,
): void {
  if (fmt === "earl") {
    const earl = buildEARLReport(vaultPath, { conforms: true, violations: [] });
    console.log(JSON.stringify(earl, null, 2));
  } else if (fmt === "json") {
    const response = ResponseBuilder.success({
      vaultPath,
      conforms: true,
      violationCount: 0,
      violations: [],
    });
    console.log(JSON.stringify(response, null, 2));
  } else {
    console.log("✅ No staged .md files to validate.");
  }
}

/**
 * Issue #3245: Dependency-injection seam for tests. Production callers omit
 * `deps` and the action uses {@link getStagedMdFiles}. Tests can pass a
 * pre-computed staged list and avoid relying on a real git repository in the
 * test fixture, which keeps the suite robust against environments (such as a
 * husky pre-commit hook) that leak GIT_INDEX_FILE / GIT_DIR into child
 * processes.
 */
export interface RunShapesModeActionDeps {
  getStagedMdFiles?: (vaultPath: string) => string[];
}

export async function runShapesModeAction(
  options: ValidateSchemaOptions,
  deps: RunShapesModeActionDeps = {},
): Promise<void> {
  const fmt = (options.format || "text") as ShapesFormat;
  const stagedResolver = deps.getStagedMdFiles ?? getStagedMdFiles;

  try {
    const vaultPath = resolve(options.vault);
    if (!existsSync(vaultPath)) {
      throw new VaultNotFoundError(vaultPath);
    }

    // Issue #3245: when --staged is set, scope SHACL violations to git-staged
    // files. Short-circuit on the zero-staged case to mirror frontmatter-mode
    // behaviour (line ~1157-1172 below) and avoid a full-vault parse on every
    // pre-commit invocation with nothing to check.
    let stagedFilter: ReadonlySet<string> | null = null;
    if (options.staged) {
      const stagedFiles = stagedResolver(vaultPath);
      if (stagedFiles.length === 0) {
        emitEmptyStagedShapesResult(vaultPath, fmt);
        return;
      }
      stagedFilter = new Set(stagedFiles);
    }

    if (fmt === "text") {
      console.log(`📦 Loading vault (shapes-mode): ${vaultPath}...`);
    }

    const { triples, cacheHit } = await loadTriplesFromAllVaults(
      vaultPath,
      Boolean(options.useCache),
    );
    if (fmt === "text" && cacheHit) {
      console.log("🚀 Cache hit! Loading from persistent cache...");
    }

    if (fmt === "text") {
      console.log(`✅ Loaded ${triples.length} triples`);
      console.log(`🔍 Running SHACL-lite validation...`);
    }

    const rawReport = await runShapesValidation(vaultPath, triples);
    const report = assembleShapesReport(rawReport, triples, stagedFilter);

    const qualifyNode = (focusNode: string): string => focusNode;

    // Issue #3488: split results by severity. `sh:Violation` are genuine
    // (errors); `sh:Warning` are unresolvable cross-vault / symbolic / external
    // references that cannot be hard-failed under open-world semantics. Warnings
    // are reported with a dedicated counter but do NOT break the exit code.
    const errorResults = report.violations.filter((v) => v.severity === "sh:Violation");
    const warningResults = report.violations.filter((v) => v.severity !== "sh:Violation");
    const crossVaultRefWarnings = warningResults.filter((v) => v.constraint === "class").length;
    const collisionWarningCount = warningResults.filter((v) => v.constraint === "term-iri-collision").length;
    const collidingIris = new Set(
      warningResults.filter((v) => v.constraint === "term-iri-collision").map((v) => v.actualValue ?? ""),
    );

    if (fmt === "earl") {
      const earl = buildEARLReport(vaultPath, report);
      console.log(JSON.stringify(earl, null, 2));
    } else if (fmt === "json") {
      const annotate = (v: Violation) => ({
        ...v,
        vaultQualifiedPath: qualifyNode(v.focusNode),
      });
      const response = ResponseBuilder.success({
        vaultPath,
        conforms: report.conforms,
        violationCount: errorResults.length,
        warningCount: warningResults.length,
        crossVaultRefWarnings,
        termIriCollisionWarnings: collisionWarningCount,
        violations: errorResults.map(annotate),
        warnings: warningResults.map(annotate),
      });
      console.log(JSON.stringify(response, null, 2));
    } else {
      if (errorResults.length > 0) {
        const byNode = new Map<string, Violation[]>();
        for (const v of errorResults) {
          const existing = byNode.get(v.focusNode) ?? [];
          existing.push(v);
          byNode.set(v.focusNode, existing);
        }
        console.log(`⚠️  Found ${errorResults.length} SHACL violation(s) in ${byNode.size} node(s):\n`);
        for (const [node, violations] of byNode) {
          console.log(`   ❌ ${node}`);
          for (const v of violations) {
            const sev = v.severity.replace("sh:", "");
            console.log(`      [${sev}] ${v.message}`);
          }
        }
      } else {
        console.log(`✅ Vault conforms to all shapes (no violations).`);
      }
      if (warningResults.length > 0) {
        console.log(
          `\nℹ️  ${warningResults.length} warning(s)` +
            (crossVaultRefWarnings > 0
              ? ` (${crossVaultRefWarnings} unresolvable class/symbolic ref(s) — not validated)`
              : "") +
            ` — these do not affect the exit code.`,
        );
        // req 00e8079e — name the colliding IRIs here. The point of the check is
        // that the condition was previously INVISIBLE; reporting it only as a few
        // extra units inside a several-hundred-warning aggregate would leave it
        // just as invisible on the default surface. Detail lines above are printed
        // for errors only, so warnings need their own breakdown.
        if (collisionWarningCount > 0) {
          console.log(
            `   ⚠️  ${collidingIris.size} term-IRI collision(s) — one IRI emitted by several assets ` +
              `(${collisionWarningCount} entr${collisionWarningCount === 1 ? "y" : "ies"}):`,
          );
          for (const iri of [...collidingIris].sort()) {
            console.log(`      • ${iri}`);
          }
          console.log(`   Run with --format json for the emitting assets.`);
        }
      }
    }

    if (!report.conforms) {
      process.exitCode = 1;
    }
  } catch (error) {
    ErrorHandler.handle(error as Error);
  }
}

/**
 * Assemble the final shapes report: shape-engine findings PLUS term-IRI collisions,
 * then both report filters.
 *
 * ⛔ Ordering is the whole point of extracting this, and it is asserted by tests.
 * Collisions are folded in BEFORE `applyLegacyExceptionFilter` and the staged
 * filter, deliberately:
 *   • the legacy-exception filter must be able to exempt a collision like any other
 *     finding on that asset;
 *   • `--staged` must scope collisions too. The per-emitter fan-out is what makes
 *     that correct — a commit INTRODUCING a collision still surfaces (the staged
 *     file is itself an emitter), while pre-existing collisions among untouched
 *     files fall away, which is exactly what `--staged` advertises. Appending
 *     AFTER the filters (the shape review measured this) made every commit in a
 *     vault with old collisions carry warnings about unrelated files.
 *
 * ⛔ Why folding in early cannot flip `conforms` — and the trap in the obvious
 * explanation. It is NOT that "both filters recompute conforms": with no
 * exemptions `applyLegacyExceptionFilter` returns the report object untouched
 * (see its `exemptNodes.size === 0` early return), and the staged filter only
 * runs under `--staged`, so on the DEFAULT path nothing recomputes it — `conforms`
 * is a passthrough from `rawReport`. Collisions are safe for two separate reasons,
 * one per path: on the default path we never touch `conforms`, and on the paths
 * that DO recompute it the predicate is
 * `violations.every(v => v.severity !== "sh:Violation")`, which warnings satisfy.
 * ⚠ Consequence for anyone extending this: folding a `sh:Violation`-severity
 * finding in here would NOT flip `conforms` on the default path — it would ship a
 * silent exit 0. Such a finding must set `conforms` explicitly.
 * (Measured 2026-08-17 by review round 3, probe P4.)
 *
 * req `00e8079e-fb36-4ce3-b33f-abb18c212143`
 */
export function assembleShapesReport(
  rawReport: ValidationReport,
  triples: DomainTriple[],
  stagedFilter: ReadonlySet<string> | null,
): ValidationReport {
  const collisionWarnings = detectTermIriCollisions(triples);
  const withCollisions =
    collisionWarnings.length > 0
      ? { ...rawReport, violations: [...rawReport.violations, ...collisionWarnings] }
      : rawReport;

  let report = applyLegacyExceptionFilter(triples, withCollisions);
  if (stagedFilter) {
    report = filterReportToStagedFocusNodes(report, stagedFilter);
  }
  return report;
}

/**
 * Creates the 'validate schema' subcommand for checking frontmatter
 * properties against the ontology.
 *
 * Issue #2713: Schema linter for frontmatter properties.
 */
export function validateSchemaCommand(): Command {
  return new Command("schema")
    .description("Check frontmatter properties against ontology (Issue #2713)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--staged", "Only validate git-staged .md files (for pre-commit hooks)")
    .option("--use-cache", "Use persistent triple cache (faster vault loading)")
    .option("--shapes-mode", "Run SHACL-lite shapes validation instead of schema linting")
    .option("--format <type>", "Output format for shapes-mode: text|json|earl", "text")
    .option("--class <iri>", "Only validate assets whose exo__Instance_class matches this IRI/slug (RFC 8e83442b T1.4)")
    .action(async (options: ValidateSchemaOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      if (options.shapesMode) {
        await runShapesModeAction(options);
        return;
      }

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // 1. Determine target files
        let targetFiles: string[];
        if (options.staged) {
          targetFiles = getStagedMdFiles(vaultPath);
          if (targetFiles.length === 0) {
            if (outputFormat === "json") {
              const response = ResponseBuilder.success<SchemaValidationResult>({
                vaultPath,
                filesChecked: 0,
                violations: [],
                healthy: true,
              });
              console.log(JSON.stringify(response, null, 2));
            } else {
              console.log("✅ No staged .md files to validate.");
            }
            return;
          }
        } else {
          targetFiles = collectMdFiles(vaultPath);
        }

        // RFC 8e83442b T1.4: apply --class filter
        if (options.class) {
          const classFilter = options.class;
          targetFiles = targetFiles.filter((relPath) => {
            try {
              const content = readFileSync(resolve(vaultPath, relPath), "utf-8");
              const fm = extractFrontmatter(content);
              return frontmatterMatchesClass(fm, classFilter);
            } catch {
              return false;
            }
          });
        }

        // 2. Load vault into triple store
        if (outputFormat === "text") {
          console.log(`📦 Loading vault: ${vaultPath}...`);
        }

        const { triples: loadedTriples, cacheHit } = await loadTriplesFromAllVaults(
          vaultPath,
          Boolean(options.useCache),
        );
        const triples: Triple[] = loadedTriples as Triple[];
        if (outputFormat === "text" && cacheHit) {
          console.log("🚀 Cache hit! Loading from persistent cache...");
        }

        if (outputFormat === "text") {
          console.log(`✅ Loaded ${triples.length} triples`);
          console.log(`🔍 Querying ontology for declared properties...`);
        }

        // 3. Build set of declared property URIs
        const declaredPropertyURIs = await loadDeclaredProperties(triples);

        if (outputFormat === "text") {
          console.log(`📋 Found ${declaredPropertyURIs.size} declared properties in ontology`);
          console.log(`🔍 Validating ${targetFiles.length} file(s)...\n`);
        }

        // 4. Validate each file
        const allViolations: SchemaViolation[] = [];
        for (const relPath of targetFiles) {
          const fullPath = resolve(vaultPath, relPath);
          const violations = validateFile(fullPath, relPath, declaredPropertyURIs);
          allViolations.push(...violations);
        }

        // 5. Output results
        const result: SchemaValidationResult = {
          vaultPath,
          filesChecked: targetFiles.length,
          violations: allViolations,
          healthy: allViolations.length === 0,
        };

        if (outputFormat === "json") {
          const response = ResponseBuilder.success(result);
          console.log(JSON.stringify(response, null, 2));
        } else {
          if (allViolations.length === 0) {
            console.log(`✅ All ${targetFiles.length} file(s) pass schema validation.`);
          } else {
            // Group violations by file
            const byFile = new Map<string, SchemaViolation[]>();
            for (const v of allViolations) {
              const existing = byFile.get(v.file) || [];
              existing.push(v);
              byFile.set(v.file, existing);
            }

            console.log(`⚠️  Found ${allViolations.length} schema violation(s) in ${byFile.size} file(s):\n`);
            for (const [file, violations] of byFile) {
              console.log(`   ❌ ${file}`);
              for (const v of violations) {
                console.log(`      • ${v.reason}`);
              }
            }
            console.log("\n📝 To fix these issues:");
            console.log("   - Remove undeclared properties from frontmatter");
            console.log("   - Or declare them in the ontology as Property instances");
          }
        }

        // Exit with code 1 if there are violations
        if (allViolations.length > 0) {
          process.exitCode = 1;
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

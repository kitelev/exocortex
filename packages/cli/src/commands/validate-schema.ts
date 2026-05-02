import { Command } from "commander";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, relative, join } from "path";
import { execSync } from "child_process";
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
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
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
  ["ztlk__", "https://exocortex.my/ontology/ztlk#"],
  ["ptms__", "https://exocortex.my/ontology/ptms#"],
  ["lit__", "https://exocortex.my/ontology/lit#"],
  ["inbox__", "https://exocortex.my/ontology/inbox#"],
  ["place__", "https://exocortex.my/ontology/place#"],
  ["exoob__", "https://exocortex.my/ontology/exoob#"],
  ["pn__", "https://exocortex.my/ontology/pn#"],
  ["period__", "https://exocortex.my/ontology/period#"],
  ["rdf__", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  ["rdfs__", "http://www.w3.org/2000/01/rdf-schema#"],
  ["owl__", "http://www.w3.org/2002/07/owl#"],
]);

export type ShapesFormat = "text" | "json" | "earl";

export interface ValidateSchemaOptions {
  vault: string;
  output?: OutputFormat;
  staged?: boolean;
  useCache?: boolean;
  shapesMode?: boolean;
  format?: ShapesFormat;
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

  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) return [];

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
 */
export class TripleClassHierarchy implements ClassHierarchy {
  private readonly subClassMap: Map<string, Set<string>> = new Map();

  constructor(triples: DomainTriple[]) {
    for (const t of triples) {
      if (
        t.predicate instanceof DomainIRI &&
        t.predicate.value === RDFS_SUBCLASS_OF &&
        t.subject instanceof DomainIRI &&
        t.object instanceof DomainIRI
      ) {
        const set = this.subClassMap.get(t.subject.value) ?? new Set<string>();
        set.add(t.object.value);
        this.subClassMap.set(t.subject.value, set);
      }
    }
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
          "earl:outcome": { "@id": "earl:failed" },
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

/**
 * Runs SHACL-lite shapes validation against vault triples.
 */
export async function runShapesValidation(
  vaultPath: string,
  triples: DomainTriple[],
): Promise<ValidationReport> {
  const standaloneRegistry = await ShapeLoader.loadFromVaultFS(vaultPath);
  const shapes = standaloneRegistry.getAll();
  const registry = new ShaclShapeRegistry(shapes);
  const hierarchy = new TripleClassHierarchy(triples);
  const algebraTriples = domainToAlgebraTriples(triples);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return shaclValidate(algebraTriples as any, registry, hierarchy);
}

async function runShapesModeAction(options: ValidateSchemaOptions): Promise<void> {
  const fmt = (options.format || "text") as ShapesFormat;

  try {
    const vaultPath = resolve(options.vault);
    if (!existsSync(vaultPath)) {
      throw new VaultNotFoundError(vaultPath);
    }

    if (fmt === "text") {
      console.log(`📦 Loading vault (shapes-mode): ${vaultPath}...`);
    }

    let triples: DomainTriple[];
    if (options.useCache) {
      const cacheManager = new CacheManager(vaultPath);
      const cacheResult = await cacheManager.loadOrBuild();
      triples = cacheResult.triples as DomainTriple[];
      if (fmt === "text" && cacheResult.cacheHit) {
        console.log("🚀 Cache hit! Loading from persistent cache...");
      }
    } else {
      const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
      const converter = new NoteToRDFConverter(vaultAdapter);
      triples = await converter.convertVault() as DomainTriple[];
    }

    if (fmt === "text") {
      console.log(`✅ Loaded ${triples.length} triples`);
      console.log(`🔍 Running SHACL-lite validation...`);
    }

    const report = await runShapesValidation(vaultPath, triples);

    if (fmt === "earl") {
      const earl = buildEARLReport(vaultPath, report);
      console.log(JSON.stringify(earl, null, 2));
    } else if (fmt === "json") {
      const response = ResponseBuilder.success({
        vaultPath,
        conforms: report.conforms,
        violationCount: report.violations.length,
        violations: report.violations,
      });
      console.log(JSON.stringify(response, null, 2));
    } else {
      if (report.conforms) {
        console.log(`✅ Vault conforms to all shapes (${report.violations.length === 0 ? "no violations" : `${report.violations.length} warning(s)`}).`);
      } else {
        const byNode = new Map<string, Violation[]>();
        for (const v of report.violations) {
          const existing = byNode.get(v.focusNode) ?? [];
          existing.push(v);
          byNode.set(v.focusNode, existing);
        }
        console.log(`⚠️  Found ${report.violations.length} SHACL violation(s) in ${byNode.size} node(s):\n`);
        for (const [node, violations] of byNode) {
          console.log(`   ❌ ${node}`);
          for (const v of violations) {
            const sev = v.severity.replace("sh:", "");
            console.log(`      [${sev}] ${v.message}`);
          }
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

        // 2. Load vault into triple store
        if (outputFormat === "text") {
          console.log(`📦 Loading vault: ${vaultPath}...`);
        }

        let triples: Triple[];
        if (options.useCache) {
          const cacheManager = new CacheManager(vaultPath);
          const cacheResult = await cacheManager.loadOrBuild();
          triples = cacheResult.triples;
          if (outputFormat === "text" && cacheResult.cacheHit) {
            console.log("🚀 Cache hit! Loading from persistent cache...");
          }
        } else {
          const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
          const converter = new NoteToRDFConverter(vaultAdapter);
          triples = await converter.convertVault();
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

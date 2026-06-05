import { SPARQLQueryService } from "./SPARQLQueryService";
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

/**
 * Represents a discoverable class from the ontology.
 */
export interface DiscoveredClass {
  /** The class name (e.g., "ems__Task", "exo__Area") */
  className: string;
  /** Human-readable label for display (e.g., "Task", "Area") */
  label: string;
  /** Description from rdfs:comment (if available) */
  description?: string;
  /** Parent class (if any, via rdfs:subClassOf) */
  superClass?: string;
  /** Whether this class is deprecated (owl:deprecated) */
  deprecated: boolean;
  /** Whether instances of this class can be created (not abstract) */
  canCreateInstance: boolean;
  /**
   * The class definition's `exo__Asset_uid` (its UUID-canon filename stem).
   * Populated from the ontology when discovered; absent for the hardcoded
   * fallback classes. Consumed by the Create-asset flow (H3 PR2, #3384) to
   * emit `exo__Instance_class: [[<uuid>]]` strip-canon instead of the legacy
   * `[[<className>]]` label form. When absent the create path falls back to
   * the label form.
   */
  classUid?: string;
}

/**
 * Read the lexical value of a SPARQL binding term.
 *
 * RDF Literal `.toString()` serializes to the quoted N-Triples form
 * (`"<value>"^^<datatype>`), so reading a Literal binding (e.g. an
 * `exo__Asset_uid`) via `.toString()` yields a quote-wrapped string. RDF terms
 * expose the bare lexical form via `.value`; fall back to `String(term)` for
 * any term shape that lacks it.
 */
function literalValue(term: unknown): string | undefined {
  if (term === null || term === undefined) return undefined;
  if (typeof term === "object" && "value" in term) {
    const value = (term as { value: unknown }).value;
    return typeof value === "string" ? value : String(value);
  }
  return String(term);
}

/**
 * Service for discovering available classes from the RDF ontology.
 *
 * Queries the triple store to find all defined classes, including
 * their metadata such as labels, descriptions, and hierarchy.
 *
 * @example
 * ```typescript
 * const discoveryService = new ClassDiscoveryService(sparqlService);
 * const classes = await discoveryService.discoverClasses();
 * // Returns: [{ className: "ems__Task", label: "Task", ... }, ...]
 * ```
 */
export class ClassDiscoveryService {
  private readonly logger = LoggerFactory.create("ClassDiscoveryService");

  constructor(private sparqlService: SPARQLQueryService) {}

  /**
   * Discover all available classes from the ontology.
   *
   * Queries for classes defined with rdf:type exo:Class or rdfs:Class,
   * and filters out deprecated classes.
   *
   * @returns Array of discovered classes sorted alphabetically by label
   */
  async discoverClasses(): Promise<DiscoveredClass[]> {
    // Issue #2810: Split into two queries. The SPARQL engine's OPTIONAL does
    // not reliably bind rdfs:label / exo:Asset_label alongside rdf:type in
    // the plugin's in-memory triple store. A separate mandatory-join query
    // for labels is robust and fast (<5ms on typical vaults).
    const classQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>

      SELECT ?class WHERE {
        {
          ?class rdf:type exo:Class .
        } UNION {
          ?class rdf:type rdfs:Class .
        }
      }
    `;

    const labelQuery = `
      PREFIX exo: <https://exocortex.my/ontology/exo#>

      SELECT ?class ?label WHERE {
        ?class exo:Asset_label ?label .
      }
    `;

    // Issue #3384 (H3 PR2): a separate mandatory-join query for the class
    // definition's UUID-canon stem (`exo__Asset_uid`). Kept distinct from the
    // label query for the same robustness reason as #2810 — the engine's
    // OPTIONAL does not reliably bind multiple properties alongside rdf:type in
    // the in-memory store, so a single-pattern query + JS join is the safe path.
    const uidQuery = `
      PREFIX exo: <https://exocortex.my/ontology/exo#>

      SELECT ?class ?uid WHERE {
        ?class exo:Asset_uid ?uid .
      }
    `;

    try {
      const [classResults, labelResults, uidResults] = await Promise.all([
        this.sparqlService.query(classQuery),
        this.sparqlService.query(labelQuery),
        this.sparqlService.query(uidQuery),
      ]);

      // Build a label lookup: file IRI → exo__Asset_label value
      const labelByIRI = new Map<string, string>();
      for (const binding of labelResults) {
        const iri = binding.get("class")?.toString();
        const label = binding.get("label")?.toString();
        if (iri && label) {
          labelByIRI.set(iri, label);
        }
      }

      // Build a UID lookup: file IRI → exo__Asset_uid value (UID-canon stem).
      // The uid binding is an RDF Literal; its `.toString()` wraps the lexical
      // value in quotes (`"<uid>"`) which would corrupt the downstream
      // `[[<uid>]]` wikilink. Read the LEXICAL value (`.value`) instead. The
      // class binding is an IRI, whose `.toString()` is already the bare IRI,
      // and must stay `.toString()` to match the join key built elsewhere.
      const uidByIRI = new Map<string, string>();
      for (const binding of uidResults) {
        const iri = binding.get("class")?.toString();
        const uid = literalValue(binding.get("uid"));
        if (iri && uid) {
          uidByIRI.set(iri, uid);
        }
      }

      const classMap = new Map<string, DiscoveredClass>();

      for (const binding of classResults) {
        const classUri = binding.get("class");
        if (!classUri) continue;

        const classIRI = String(classUri);

        // Issue #2807 + #2810: Prefer the exo__Asset_label value as the
        // canonical className. The label may be stored as:
        // 1. A prefixed name string ("ems__Task") — use directly
        // 2. A namespace IRI ("https://exocortex.my/ontology/ems#Task") —
        //    NoteToRDFConverter expands class-like values to IRIs via
        //    isClassReference(), so convert back via toClassName()
        // 3. Absent — fall back to extracting from the file IRI
        const labelValue = labelByIRI.get(classIRI);
        let className: string | null;
        if (this.isPrefixedClassName(labelValue)) {
          className = labelValue as string;
        } else if (labelValue) {
          className = this.toClassName(labelValue) || this.toClassName(classIRI);
        } else {
          className = this.toClassName(classIRI);
        }
        if (!className) continue;

        // Skip if already processed (avoid duplicates from UNION)
        if (classMap.has(className)) continue;

        // Derive human-readable display label from the canonical className
        // ("ems__Task" → "Task"). Falls back to whatever the binding gave us.
        const label = this.extractLabel(className);

        classMap.set(className, {
          className,
          label,
          deprecated: false,
          canCreateInstance: this.canCreateInstance(className),
          classUid: uidByIRI.get(classIRI),
        });
      }

      // Sort by label alphabetically
      const classes = Array.from(classMap.values())
        .filter(c => !c.deprecated)
        .sort((a, b) => a.label.localeCompare(b.label));

      return classes;
    } catch (error) {
      this.logger.warn("Failed to discover classes from ontology", error);
      return this.getDefaultClasses();
    }
  }

  /**
   * Get classes that can have instances created.
   * Filters out abstract classes and meta-classes.
   */
  async getCreatableClasses(): Promise<DiscoveredClass[]> {
    const allClasses = await this.discoverClasses();
    return allClasses.filter(c => c.canCreateInstance);
  }

  /**
   * Fallback list of classes when SPARQL query fails.
   * Returns commonly used classes from the EMS ontology.
   */
  getDefaultClasses(): DiscoveredClass[] {
    return [
      {
        className: "ems__Task",
        label: "Task",
        description: "A unit of work that can be tracked and completed",
        deprecated: false,
        canCreateInstance: true,
      },
      {
        className: "ems__Project",
        label: "Project",
        description: "A collection of related tasks working toward a goal",
        deprecated: false,
        canCreateInstance: true,
      },
      {
        className: "ems__Area",
        label: "Area",
        description: "An area of responsibility or interest",
        deprecated: false,
        canCreateInstance: true,
      },
      {
        className: "ems__Meeting",
        label: "Meeting",
        description: "A scheduled meeting or event",
        deprecated: false,
        canCreateInstance: true,
      },
      {
        className: "exo__Event",
        label: "Event",
        description: "A one-time or recurring event",
        deprecated: false,
        canCreateInstance: true,
      },
      {
        className: "ims__Concept",
        label: "Concept",
        description: "An abstract concept or idea",
        deprecated: false,
        canCreateInstance: true,
      },
    ];
  }

  /**
   * Check whether a label value looks like a canonical prefixed class name
   * (e.g. "ems__Task", "exo__Area"). Used by Issue #2807 to prefer the
   * frontmatter label over a file-IRI fallback when building className.
   */
  private isPrefixedClassName(value: string | undefined): boolean {
    if (!value) return false;
    return /^[a-z]+__[A-Za-z][A-Za-z0-9_]*$/.test(value);
  }

  /**
   * Convert full IRI to class name format (e.g., "ems__Task").
   */
  private toClassName(iri: string): string | null {
    // Handle prefixed names that were already converted
    if (iri.startsWith("ems__") || iri.startsWith("exo__") ||
        iri.startsWith("ims__") || iri.startsWith("pn__")) {
      return iri;
    }

    const match = iri.match(
      /https:\/\/exocortex\.my\/ontology\/([a-z]+)#(.+)$/,
    );
    if (match) {
      const [, prefix, localName] = match;
      return `${prefix}__${localName}`;
    }

    // Fallback: try to extract local name from any URI
    const hashIndex = iri.lastIndexOf("#");
    const slashIndex = iri.lastIndexOf("/");
    const separator = Math.max(hashIndex, slashIndex);
    if (separator >= 0) {
      return iri.substring(separator + 1);
    }

    return null;
  }

  /**
   * Extract human-readable label from class name.
   */
  private extractLabel(className: string): string {
    // Remove prefix (ems__, exo__, etc.)
    const withoutPrefix = className.replace(/^[a-z]+__/, "");

    // Convert camelCase to spaces and capitalize first letter
    return withoutPrefix
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (s) => s.toUpperCase());
  }

  /**
   * Determine if instances of a class can be created.
   * Meta-classes, prototypes, and system classes cannot be instantiated.
   */
  private canCreateInstance(className: string): boolean {
    // Issue #2810: Classes without a resolved prefixed className (still UUID
    // filenames) should not appear in the dropdown — they are class-def files
    // missing exo__Asset_label or in an unregistered namespace.
    if (!this.isPrefixedClassName(className)) {
      return false;
    }

    // Meta-classes cannot be instantiated
    if (className === "exo__Class" || className === "rdfs__Class") {
      return false;
    }

    // Prototype classes create instances, not prototypes
    if (className.includes("Prototype")) {
      return true; // Prototypes CAN create instances (tasks/meetings from prototypes)
    }

    // System event classes should not be manually created
    if (className === "ems__SessionStartEvent" ||
        className === "ems__SessionEndEvent") {
      return false;
    }

    // Daily notes have special creation flow
    if (className === "pn__DailyNote") {
      return false;
    }

    return true;
  }
}

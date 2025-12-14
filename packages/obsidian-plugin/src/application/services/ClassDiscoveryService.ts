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
    const query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?class ?label ?comment ?superClass ?deprecated WHERE {
        {
          ?class rdf:type exo:Class .
        } UNION {
          ?class rdf:type rdfs:Class .
        }
        OPTIONAL { ?class rdfs:label ?label . }
        OPTIONAL { ?class rdfs:comment ?comment . }
        OPTIONAL { ?class rdfs:subClassOf ?superClass . }
        OPTIONAL { ?class owl:deprecated ?deprecated . }
      }
    `;

    try {
      const results = await this.sparqlService.query(query);
      const classMap = new Map<string, DiscoveredClass>();

      for (const binding of results) {
        const classUri = binding.get("class");
        if (!classUri) continue;

        const className = this.toClassName(String(classUri));
        if (!className) continue;

        // Skip if already processed (avoid duplicates from UNION)
        if (classMap.has(className)) continue;

        const labelValue = binding.get("label")?.toString();
        const label = labelValue || this.extractLabel(className);
        const description = binding.get("comment")?.toString();
        const superClassUri = binding.get("superClass")?.toString();
        const superClass = superClassUri ? this.toClassName(superClassUri) : undefined;
        const deprecated = binding.get("deprecated")?.toString() === "true";

        classMap.set(className, {
          className,
          label,
          description,
          superClass: superClass || undefined,
          deprecated,
          canCreateInstance: this.canCreateInstance(className),
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

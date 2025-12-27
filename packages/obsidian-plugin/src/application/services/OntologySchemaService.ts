import { SPARQLQueryService } from "./SPARQLQueryService";
import { PropertyFieldType } from "exocortex";
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

/**
 * Extended property definition for ontology-driven forms.
 * Contains all metadata needed to render a property field dynamically.
 */
export interface OntologyPropertyDefinition {
  /** Property URI (e.g., "exo__Asset_label") */
  uri: string;
  /** Human-readable label for the property */
  label: string;
  /** Field type for rendering (text, datetime, wikilink, etc.) */
  fieldType: PropertyFieldType;
  /** Whether this property is deprecated */
  deprecated: boolean;
  /** Whether this property is required */
  required: boolean;
  /** Description of the property (from rdfs:comment) */
  description?: string;
  /** The range type IRI (e.g., xsd:string) */
  rangeType?: string;
}

/**
 * Service for reading class properties from the RDF ontology.
 *
 * Queries the triple store to discover which properties are defined
 * for a given class, including inherited properties from superclasses.
 *
 * @example
 * ```typescript
 * const schemaService = new OntologySchemaService(sparqlService);
 * const properties = await schemaService.getClassProperties("ems__Task");
 * // Returns properties from Task, Effort (if inherited), and Asset
 * ```
 */
export class OntologySchemaService {
  private readonly logger = LoggerFactory.create("OntologySchemaService");

  constructor(private sparqlService: SPARQLQueryService) {}

  /**
   * Get all properties for a class, including inherited properties.
   *
   * @param className - The class name (e.g., "ems__Task")
   * @returns Array of property definitions sorted by label
   */
  async getClassProperties(
    className: string,
  ): Promise<OntologyPropertyDefinition[]> {
    // Get direct properties for this class
    const directProperties = await this.getDirectProperties(className);

    // Get superclasses and their properties
    const superClasses = await this.getClassHierarchy(className);
    const inheritedProperties: OntologyPropertyDefinition[] = [];

    for (const superClass of superClasses) {
      const superProps = await this.getDirectProperties(superClass);
      inheritedProperties.push(...superProps);
    }

    // Combine and deduplicate (prefer direct over inherited)
    const propertyMap = new Map<string, OntologyPropertyDefinition>();

    // Add inherited first
    for (const prop of inheritedProperties) {
      propertyMap.set(prop.uri, prop);
    }

    // Override with direct (if same property defined both places)
    for (const prop of directProperties) {
      propertyMap.set(prop.uri, prop);
    }

    // Sort by label alphabetically
    return Array.from(propertyMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  /**
   * Get the class hierarchy (superclass chain) for a given class.
   *
   * Returns all superclasses that the class inherits from, ordered by
   * proximity (immediate superclass first, then its superclass, etc.).
   *
   * @param className - The class name (e.g., "ems__Task")
   * @returns Array of superclass names (e.g., ["ems__Effort", "exo__Asset"])
   *
   * @example
   * ```typescript
   * const hierarchy = await schemaService.getClassHierarchy("ems__Task");
   * // Returns: ["ems__Effort", "exo__Asset"]
   * ```
   */
  async getClassHierarchy(className: string): Promise<string[]> {
    const classIri = this.toClassIri(className);

    const query = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?superClass WHERE {
        <${classIri}> rdfs:subClassOf+ ?superClass .
      }
    `;

    try {
      const results = await this.sparqlService.query(query);
      const superClasses: string[] = [];

      for (const binding of results) {
        const superClassUri = binding.get("superClass");
        if (superClassUri) {
          const superClassName = this.toClassName(String(superClassUri));
          if (superClassName) {
            superClasses.push(superClassName);
          }
        }
      }

      return superClasses;
    } catch (error) {
      this.logger.warn(`Failed to get class hierarchy for ${className}`, error);
      return [];
    }
  }

  /**
   * Check if a property is deprecated in the ontology.
   *
   * @param propertyUri - The property URI (e.g., "exo__Asset_prototype")
   * @returns true if the property is marked as deprecated, false otherwise
   *
   * @example
   * ```typescript
   * const isDeprecated = await schemaService.isDeprecatedProperty("exo__Asset_prototype");
   * // Returns: false
   * ```
   */
  async isDeprecatedProperty(propertyUri: string): Promise<boolean> {
    const fullUri = this.toPropertyIri(propertyUri);

    // Use SELECT query instead of ASK for compatibility
    const query = `
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?deprecated WHERE {
        <${fullUri}> owl:deprecated ?deprecated .
      }
      LIMIT 1
    `;

    try {
      const results = await this.sparqlService.query(query);
      // Check if any results returned with deprecated = true
      if (results.length > 0) {
        const binding = results[0];
        const deprecatedValue = binding.get("deprecated");
        // The value should be a Literal with value "true"
        return deprecatedValue?.toString() === "true";
      }
      return false;
    } catch (error) {
      this.logger.warn(`Failed to check deprecated status for ${propertyUri}`, error);
      return false;
    }
  }

  /**
   * Get the range class(es) for a property.
   *
   * Returns the class names that are valid targets for this property.
   * Uses rdfs:range from the ontology.
   *
   * @param propertyUri - The property URI (e.g., "ems__Effort_project")
   * @returns Array of class names (e.g., ["ems__Project"])
   *
   * @example
   * ```typescript
   * const rangeClasses = await schemaService.getPropertyRangeClasses("ems__Effort_project");
   * // Returns: ["ems__Project"]
   * ```
   */
  async getPropertyRangeClasses(propertyUri: string): Promise<string[]> {
    const fullUri = this.toPropertyIri(propertyUri);

    const query = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?range WHERE {
        <${fullUri}> rdfs:range ?range .
      }
    `;

    try {
      const results = await this.sparqlService.query(query);
      const rangeClasses: string[] = [];

      for (const binding of results) {
        const rangeUri = binding.get("range");
        if (rangeUri) {
          const className = this.toClassName(String(rangeUri));
          if (className) {
            rangeClasses.push(className);
          }
        }
      }

      // If no range found, try to infer from property name
      if (rangeClasses.length === 0) {
        const inferred = this.inferRangeFromPropertyName(propertyUri);
        if (inferred) {
          rangeClasses.push(inferred);
        }
      }

      return rangeClasses;
    } catch (error) {
      this.logger.warn(`Failed to get property range for ${propertyUri}`, error);
      // Fallback to inference
      const inferred = this.inferRangeFromPropertyName(propertyUri);
      return inferred ? [inferred] : [];
    }
  }

  /**
   * Infer range class from property name when ontology data is unavailable.
   */
  private inferRangeFromPropertyName(propertyUri: string): string | null {
    const lowerUri = propertyUri.toLowerCase();

    if (lowerUri.includes("project") || lowerUri.endsWith("_project")) {
      return "ems__Project";
    }
    if (lowerUri.includes("area") || lowerUri.endsWith("_area")) {
      return "ems__Area";
    }
    if (lowerUri.includes("task") || lowerUri.endsWith("_task")) {
      return "ems__Task";
    }
    if (lowerUri.includes("parent")) {
      // Parent is usually same class or generic asset
      return null;
    }

    return null;
  }

  /**
   * Convert property name to full IRI.
   */
  private toPropertyIri(propertyName: string): string {
    if (
      propertyName.startsWith("http://") ||
      propertyName.startsWith("https://")
    ) {
      return propertyName;
    }

    // Parse prefix (ems__, exo__, etc.)
    const match = propertyName.match(/^([a-z]+)__(.+)$/);
    if (match) {
      const [, prefix, localName] = match;
      switch (prefix) {
        case "ems":
          return `https://exocortex.my/ontology/ems#${localName}`;
        case "exo":
          return `https://exocortex.my/ontology/exo#${localName}`;
        default:
          return `https://exocortex.my/ontology/${prefix}#${localName}`;
      }
    }

    return propertyName;
  }

  /**
   * Get properties directly defined for a class (not inherited).
   */
  private async getDirectProperties(
    className: string,
  ): Promise<OntologyPropertyDefinition[]> {
    const classIri = this.toClassIri(className);

    // Query for properties where rdfs:domain matches this class
    const query = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?property ?label ?range ?deprecated ?comment WHERE {
        ?property rdfs:domain <${classIri}> .
        OPTIONAL { ?property rdfs:label ?label . }
        OPTIONAL { ?property rdfs:range ?range . }
        OPTIONAL { ?property owl:deprecated ?deprecated . }
        OPTIONAL { ?property rdfs:comment ?comment . }
      }
    `;

    try {
      const results = await this.sparqlService.query(query);
      const properties: OntologyPropertyDefinition[] = [];

      for (const binding of results) {
        const propertyUri = binding.get("property");
        if (!propertyUri) continue;

        const uri = this.toPropertyName(String(propertyUri));
        const label =
          binding.get("label")?.toString() || this.extractLabel(uri);
        const rangeType = binding.get("range")?.toString();
        const deprecated = binding.get("deprecated")?.toString() === "true";
        const description = binding.get("comment")?.toString();

        properties.push({
          uri,
          label,
          fieldType: this.rangeToFieldType(rangeType),
          deprecated,
          required: false, // Could be determined from cardinality constraints
          description,
          rangeType,
        });
      }

      return properties;
    } catch (error) {
      // If query fails (e.g., no ontology loaded), return empty array
      this.logger.warn(`Failed to get properties for class ${className}`, error);
      return [];
    }
  }

  /**
   * Convert class name to full IRI.
   */
  private toClassIri(className: string): string {
    if (className.startsWith("http://") || className.startsWith("https://")) {
      return className;
    }

    // Parse prefix (ems__, exo__, etc.)
    const match = className.match(/^([a-z]+)__(.+)$/);
    if (match) {
      const [, prefix, localName] = match;
      switch (prefix) {
        case "ems":
          return `https://exocortex.my/ontology/ems#${localName}`;
        case "exo":
          return `https://exocortex.my/ontology/exo#${localName}`;
        default:
          return `https://exocortex.my/ontology/${prefix}#${localName}`;
      }
    }

    return className;
  }

  /**
   * Convert IRI to class name format.
   */
  private toClassName(iri: string): string | null {
    const match = iri.match(
      /https:\/\/exocortex\.my\/ontology\/([a-z]+)#(.+)$/,
    );
    if (match) {
      const [, prefix, localName] = match;
      return `${prefix}__${localName}`;
    }
    return null;
  }

  /**
   * Convert IRI to property name format.
   */
  private toPropertyName(iri: string): string {
    const match = iri.match(
      /https:\/\/exocortex\.my\/ontology\/([a-z]+)#(.+)$/,
    );
    if (match) {
      const [, prefix, localName] = match;
      return `${prefix}__${localName}`;
    }
    // Return last segment as fallback
    const lastHash = iri.lastIndexOf("#");
    const lastSlash = iri.lastIndexOf("/");
    const separator = Math.max(lastHash, lastSlash);
    return separator >= 0 ? iri.substring(separator + 1) : iri;
  }

  /**
   * Extract human-readable label from property URI.
   */
  private extractLabel(uri: string): string {
    // Remove prefix (ems__, exo__, etc.)
    const withoutPrefix = uri.replace(/^[a-z]+__/, "");

    // Split on underscore (e.g., "Asset_label" -> "Label")
    const parts = withoutPrefix.split("_");
    const propertyPart = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];

    // Convert camelCase to spaces
    return propertyPart
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (s) => s.toUpperCase());
  }

  /**
   * Map RDF range type to property field type.
   */
  private rangeToFieldType(rangeType?: string): PropertyFieldType {
    if (!rangeType) {
      return PropertyFieldType.Text;
    }

    // Check for XSD types
    if (rangeType.includes("XMLSchema#") || rangeType.startsWith("xsd:")) {
      if (rangeType.includes("dateTime") || rangeType.includes("date")) {
        return PropertyFieldType.Timestamp;
      }
      if (rangeType.includes("integer") || rangeType.includes("decimal") || rangeType.includes("float") || rangeType.includes("double")) {
        return PropertyFieldType.Number;
      }
      if (rangeType.includes("boolean")) {
        return PropertyFieldType.Boolean;
      }
      return PropertyFieldType.Text;
    }

    // Check for EMS/EXO types
    if (rangeType.includes("EffortStatus")) {
      return PropertyFieldType.StatusSelect;
    }
    if (rangeType.includes("TaskSize")) {
      return PropertyFieldType.SizeSelect;
    }

    // Check if it's a reference to another class
    if (
      rangeType.includes("exocortex.my/ontology") ||
      rangeType.includes("Asset") ||
      rangeType.includes("Task") ||
      rangeType.includes("Project") ||
      rangeType.includes("Area")
    ) {
      return PropertyFieldType.Wikilink;
    }

    return PropertyFieldType.Text;
  }

  /**
   * Get hardcoded default properties for a class when no ontology data is available.
   * This ensures the modal can still function without full RDF data.
   */
  getDefaultProperties(className: string): OntologyPropertyDefinition[] {
    const baseProperties: OntologyPropertyDefinition[] = [
      {
        uri: "exo__Asset_label",
        label: "Label",
        fieldType: PropertyFieldType.Text,
        deprecated: false,
        required: false,
        description: "Display label for the asset",
      },
    ];

    // Task-specific properties
    if (className === "ems__Task" || className.startsWith("ems__Task_")) {
      return [
        ...baseProperties,
        {
          uri: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
          deprecated: false,
          required: false,
          description: "Estimated size of the task",
        },
        {
          uri: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
          deprecated: false,
          required: false,
          description: "Current status of the effort",
        },
      ];
    }

    return baseProperties;
  }
}

import type {
  PropertySchemaResolver,
  PropertySchema,
  ClassHierarchyResolver,
} from "exocortex";
import type { PropertySchemaDefinition, PropertyFieldType } from "./PropertySchemas";

/**
 * Maps ontology property types (from PropertySchemaResolver) to the
 * UI field types used by the property editor.
 *
 * This is an intentional static mapping: the ontology can express types
 * more granularly (e.g. "datetime", "date", "reference") while the
 * property editor UI has a fixed set of field renderers. Unknown types
 * fall back to "text".
 *
 * @internal — stable mapping, changes only when new field renderers are added
 */
const FIELD_TYPE_MAP: Record<string, PropertyFieldType> = {
  text: "text",
  number: "number",
  boolean: "boolean",
  "status-select": "status-select",
  "size-select": "size-select",
  wikilink: "wikilink",
  reference: "wikilink",
  timestamp: "timestamp",
  datetime: "timestamp",
  date: "timestamp",
  enum: "text",
  unknown: "text",
};

function coreSchemaToDefinition(
  propertyIRI: string,
  schema: PropertySchema,
): PropertySchemaDefinition {
  const mappedType = FIELD_TYPE_MAP[schema.type] || "text";

  const definition: PropertySchemaDefinition = {
    name: propertyIRI,
    type: mappedType,
    required: schema.validation?.required ?? false,
    label: schema.label,
  };

  if (schema.options && schema.options.length > 0) {
    definition.options = schema.options.map((o) => o.value);
  }

  if (schema.validation?.minValue !== undefined) {
    definition.min = schema.validation.minValue;
  }

  if (schema.validation?.maxValue !== undefined) {
    definition.max = schema.validation.maxValue;
  }

  if (schema.readOnly) {
    definition.readOnly = true;
  }

  return definition;
}

export class PropertySchemaService {
  private readonly hierarchyResolver: ClassHierarchyResolver | null;

  constructor(
    private readonly resolver: PropertySchemaResolver,
    hierarchyResolver?: ClassHierarchyResolver,
  ) {
    this.hierarchyResolver = hierarchyResolver ?? null;
  }

  async getPropertySchemaForClass(
    instanceClass: string,
  ): Promise<PropertySchemaDefinition[]> {
    const cleanClass = instanceClass.replace(/\[\[|\]\]/g, "");

    const allSchemas = await this.resolver.getAllSchemas();
    if (allSchemas.size === 0) {
      return [];
    }

    const classProperties = await this.getPropertyNamesForClass(cleanClass, allSchemas);
    const definitions: PropertySchemaDefinition[] = [];

    for (const propIRI of classProperties) {
      const schema = allSchemas.get(propIRI);
      if (schema) {
        definitions.push(coreSchemaToDefinition(propIRI, schema));
      }
    }

    return definitions;
  }

  async getSchema(
    propertyIRI: string,
  ): Promise<PropertySchemaDefinition | null> {
    const schema = await this.resolver.getSchema(propertyIRI);
    if (!schema) {
      return null;
    }
    return coreSchemaToDefinition(propertyIRI, schema);
  }

  private async getPropertyNamesForClass(
    className: string,
    allSchemas: Map<string, PropertySchema>,
  ): Promise<string[]> {
    const properties: string[] = [];

    const classHierarchy = await this.resolveClassHierarchy(className);

    for (const [propIRI] of allSchemas) {
      const propPrefix = this.getPropertyClassPrefix(propIRI);
      if (propPrefix && classHierarchy.includes(propPrefix)) {
        properties.push(propIRI);
      }
    }

    return properties;
  }

  private async resolveClassHierarchy(className: string): Promise<string[]> {
    if (this.hierarchyResolver) {
      const resolved = await this.hierarchyResolver.resolve(className);
      if (resolved.length > 1) {
        return resolved;
      }
      return [className, "exo__Asset"];
    }

    return [className, "exo__Asset"];
  }

  private getPropertyClassPrefix(propertyIRI: string): string | null {
    const match = propertyIRI.match(/^([a-z]+__[A-Z][a-zA-Z]*)_/);
    if (match) {
      return match[1];
    }
    return null;
  }
}

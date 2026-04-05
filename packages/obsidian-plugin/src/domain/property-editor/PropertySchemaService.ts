import type {
  PropertySchemaResolver,
  PropertySchema,
} from "exocortex";
import type { PropertySchemaDefinition, PropertyFieldType } from "./PropertySchemas";

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

  const readOnlyProperties = new Set([
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "ems__Effort_startTimestamp",
    "ems__Effort_endTimestamp",
  ]);
  if (readOnlyProperties.has(propertyIRI)) {
    definition.readOnly = true;
  }

  return definition;
}

export class PropertySchemaService {
  constructor(private readonly resolver: PropertySchemaResolver) {}

  async getPropertySchemaForClass(
    instanceClass: string,
  ): Promise<PropertySchemaDefinition[]> {
    const cleanClass = instanceClass.replace(/\[\[|\]\]/g, "");

    const allSchemas = await this.resolver.getAllSchemas();
    if (allSchemas.size === 0) {
      return [];
    }

    const classProperties = this.getPropertyNamesForClass(cleanClass, allSchemas);
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

  private getPropertyNamesForClass(
    className: string,
    allSchemas: Map<string, PropertySchema>,
  ): string[] {
    const properties: string[] = [];

    const classHierarchy = this.resolveClassHierarchy(className);

    for (const [propIRI] of allSchemas) {
      const propPrefix = this.getPropertyClassPrefix(propIRI);
      if (propPrefix && classHierarchy.includes(propPrefix)) {
        properties.push(propIRI);
      }
    }

    return properties;
  }

  private resolveClassHierarchy(className: string): string[] {
    const hierarchy: string[] = [className];

    const inheritanceMap: Record<string, string[]> = {
      ems__Task: ["ems__Effort", "exo__Asset"],
      ems__Meeting: ["ems__Task", "ems__Effort", "exo__Asset"],
      ems__Project: ["ems__Effort", "exo__Asset"],
      ems__Initiative: ["ems__Effort", "exo__Asset"],
      ems__Area: ["exo__Asset"],
      ims__Concept: ["exo__Asset"],
    };

    const parents = inheritanceMap[className];
    if (parents) {
      hierarchy.push(...parents);
    } else {
      hierarchy.push("exo__Asset");
    }

    return hierarchy;
  }

  private getPropertyClassPrefix(propertyIRI: string): string | null {
    const match = propertyIRI.match(/^([a-z]+__[A-Z][a-zA-Z]*)_/);
    if (match) {
      return match[1];
    }
    return null;
  }
}

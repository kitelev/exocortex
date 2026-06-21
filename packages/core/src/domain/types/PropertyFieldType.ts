/**
 * Property field type enumeration.
 * Represents the different types of properties that can be rendered in UI forms.
 * These types map to RDF range types (xsd:string, xsd:dateTime, etc.)
 */
export enum PropertyFieldType {
  /** Plain text field */
  Text = "text",

  /** Numeric value field */
  Number = "number",

  /** Date-only field (xsd:date) */
  Date = "date",

  /** Date and time field (xsd:dateTime) */
  DateTime = "datetime",

  /** Boolean checkbox field */
  Boolean = "boolean",

  /** Reference to another asset (wikilink) */
  Reference = "reference",

  /** Fixed set of enumerated values */
  Enum = "enum",

  /** Status selection dropdown (e.g., EffortStatus) */
  StatusSelect = "status-select",

  /** Size selection dropdown (e.g., TaskSize) */
  SizeSelect = "size-select",

  /** Wikilink field for asset references */
  Wikilink = "wikilink",

  /** Timestamp field (ISO 8601 format) */
  Timestamp = "timestamp",

  /** Unknown or unmapped field type */
  Unknown = "unknown",
}

/**
 * XSD namespace URI for XML Schema datatypes.
 */
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

/**
 * Exocortex ontology namespace URIs.
 */
const EXO_NS = "https://exocortex.my/ontology/exo#";
const EMS_NS = "https://exocortex.my/ontology/ems#";

/**
 * Map RDF range type IRI to PropertyFieldType.
 *
 * Converts XSD datatypes and custom ontology types to their
 * corresponding UI field types for form rendering.
 *
 * @param rangeType - The RDF range type IRI (e.g., "http://www.w3.org/2001/XMLSchema#string")
 * @returns The corresponding PropertyFieldType
 *
 * @example
 * ```typescript
 * rangeToFieldType("http://www.w3.org/2001/XMLSchema#dateTime");
 * // Returns: PropertyFieldType.DateTime
 *
 * rangeToFieldType("http://www.w3.org/2001/XMLSchema#string");
 * // Returns: PropertyFieldType.Text
 *
 * rangeToFieldType("https://exocortex.my/ontology/ems#EffortStatus");
 * // Returns: PropertyFieldType.StatusSelect
 * ```
 */
export function rangeToFieldType(rangeType?: string): PropertyFieldType {
  if (!rangeType) {
    return PropertyFieldType.Unknown;
  }

  // Normalize the range type (handle both full IRI and prefixed forms)
  const normalizedType = rangeType.trim();

  // Empty string after trim is considered unknown
  if (!normalizedType) {
    return PropertyFieldType.Unknown;
  }

  // Check for XSD types (full IRI)
  if (normalizedType.startsWith(XSD_NS)) {
    const localName = normalizedType.substring(XSD_NS.length);
    return xsdTypeToFieldType(localName);
  }

  // Check for XSD types (prefixed form)
  if (normalizedType.startsWith("xsd:")) {
    const localName = normalizedType.substring(4);
    return xsdTypeToFieldType(localName);
  }

  // Check for XMLSchema# pattern in the IRI
  if (normalizedType.includes("XMLSchema#")) {
    const hashIndex = normalizedType.indexOf("XMLSchema#");
    const localName = normalizedType.substring(hashIndex + 10);
    return xsdTypeToFieldType(localName);
  }

  // Check for EMS types
  if (normalizedType.startsWith(EMS_NS) || normalizedType.startsWith("ems:")) {
    return emsTypeToFieldType(normalizedType);
  }

  // Check for EXO types
  if (normalizedType.startsWith(EXO_NS) || normalizedType.startsWith("exo:")) {
    return PropertyFieldType.Reference;
  }

  // Check for known class references
  if (isClassReference(normalizedType)) {
    return PropertyFieldType.Reference;
  }

  // Default to text for unknown types
  return PropertyFieldType.Text;
}

/**
 * Map XSD local name to PropertyFieldType.
 */
function xsdTypeToFieldType(localName: string): PropertyFieldType {
  switch (localName.toLowerCase()) {
    case "string":
    case "normalizedstring":
    case "token":
    case "language":
    case "nmtoken":
    case "name":
    case "ncname":
    case "anyuri":
      return PropertyFieldType.Text;

    case "integer":
    case "int":
    case "long":
    case "short":
    case "byte":
    case "nonnegativeinteger":
    case "positiveinteger":
    case "nonpositiveinteger":
    case "negativeinteger":
    case "unsignedlong":
    case "unsignedint":
    case "unsignedshort":
    case "unsignedbyte":
    case "decimal":
    case "float":
    case "double":
      return PropertyFieldType.Number;

    case "date":
      return PropertyFieldType.Date;

    case "datetime":
    case "datetimestamp":
      return PropertyFieldType.DateTime;

    case "boolean":
      return PropertyFieldType.Boolean;

    case "time":
      return PropertyFieldType.Timestamp;

    default:
      return PropertyFieldType.Text;
  }
}

/**
 * Map EMS namespace types to PropertyFieldType.
 */
function emsTypeToFieldType(typeIri: string): PropertyFieldType {
  const normalizedType = typeIri.toLowerCase();

  if (normalizedType.includes("effortstatus")) {
    return PropertyFieldType.StatusSelect;
  }

  if (normalizedType.includes("tasksize")) {
    return PropertyFieldType.SizeSelect;
  }

  // Default to reference for other EMS types (likely class references)
  return PropertyFieldType.Reference;
}

/**
 * Check if the type IRI represents a class reference.
 */
function isClassReference(typeIri: string): boolean {
  const lowerType = typeIri.toLowerCase();

  // Check for common class patterns
  if (lowerType.includes("exocortex.my/ontology")) {
    return true;
  }

  // Check for known class names
  const classPatterns = [
    "asset",
    "task",
    "project",
    "area",
    "effort",
    "class",
    "property",
    "concept",
  ];

  return classPatterns.some((pattern) => lowerType.includes(pattern));
}

/**
 * W3C XML-Schema datatype references as they appear in Exocortex frontmatter
 * (`exo__Property_range`, SHACL `sh:datatype` inputs): either the CURIE
 * literal `xsd:<local>` — the form `create --class DatatypeProperty` writes
 * and 100 % of live datatype ranges use — or the full namespace IRI
 * `http://www.w3.org/2001/XMLSchema#<local>`.
 *
 * One parser for BOTH consumers (ticket b151005b, NIT of review #4266):
 *
 * - `RequiredPropertyResolver` (form field type from a range) — needs the
 *   LOCAL NAME and compares it lower-cased (`xsd:dateTime` → "datetime");
 * - `ShapeLoader.datatypeRangeToIRI` (both shape loaders) — needs the FULL IRI
 *   and keeps the local name exactly as written (`xsd:dateTime` →
 *   `…XMLSchema#dateTime`, the tag the converter emits).
 *
 * ⛔ Case policy is deliberately NOT part of this helper: the local name is
 * returned as written, and each consumer applies its own policy at the call
 * site (lower-case in the resolver, verbatim in the loader). Unifying them
 * here would be a behaviour change for one of the two.
 *
 * Only the W3C namespace is recognised. A foreign CURIE (`ex:date`), a foreign
 * IRI (`https://exocortex.my/ontology/ems#Task`) or any other string is not a
 * datatype reference → `null`. A bare prefix (`xsd:` / the namespace alone)
 * yields an EMPTY local name (not `null`), and each consumer keeps its
 * pre-existing handling of it: the resolver's field-type table has no entry
 * for `""`, so it falls through to `text`; `ShapeLoader.datatypeRangeToIRI`
 * returns the bare namespace as the range IRI (`xsdDatatypeIRI("xsd:") ===
 * XSD_NS`), exactly as `XSD_NS + raw.substring(4)` did before.
 *
 * Not consolidated here (own prefix sets / own `includes`-based parsing):
 * `ShaclLiteValidator.xsdLocalName`, `PropertyFieldType.mapRangeToFieldType`
 * and the plugin's `OntologySchemaService.rangeToFieldType`.
 */

/** The W3C XML-Schema datatype namespace. */
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

/** CURIE prefix of the W3C XML-Schema datatype namespace (`xsd:dateTime`). */
const XSD_CURIE_PREFIX = "xsd:";

/**
 * Local name of an XSD datatype reference, as written (case preserved), or
 * `null` when `raw` does not start with the XSD namespace or the `xsd:` CURIE
 * prefix. `xsdDatatypeLocalName("xsd:dateTime") === "dateTime"`,
 * `xsdDatatypeLocalName("http://www.w3.org/2001/XMLSchema#integer") === "integer"`,
 * `xsdDatatypeLocalName("ex:date") === null`.
 */
export function xsdDatatypeLocalName(raw: string): string | null {
  if (raw.startsWith(XSD_NS)) return raw.slice(XSD_NS.length);
  if (raw.startsWith(XSD_CURIE_PREFIX))
    return raw.slice(XSD_CURIE_PREFIX.length);
  return null;
}

/**
 * Full XSD datatype IRI for an XSD datatype reference (the CURIE `xsd:<local>`
 * expands to the W3C namespace; a full XSD IRI is returned as-is), or `null`
 * when `raw` is not an XSD datatype reference at all.
 */
export function xsdDatatypeIRI(raw: string): string | null {
  const local = xsdDatatypeLocalName(raw);
  return local === null ? null : XSD_NS + local;
}

/**
 * The numeric FAMILY of an XSD datatype local name, or `null` for a
 * non-numeric one (`string`, `boolean`, `dateTime`, `anyURI`, `gYear`, …).
 *
 * Consumer: the frontmatter writers (`serializeYamlScalar` via
 * `scalarTypingForRange`, ticket 2227d660) — a scalar under a numeric declared
 * range is emitted BARE when its lexical form is a canonical number, so the
 * YAML reader types it as a number and the converter tags it `xsd:integer` /
 * `xsd:decimal` — the pairing `ShaclLiteValidator.literalConformsToDatatype`
 * accepts under that range. The two name sets mirror the keys of the
 * validator's `DECIMAL_TAG_LEXICAL` table (integer-derived types on one side,
 * `decimal` / `float` / `double` on the other); `gYear` is deliberately NOT a
 * numeric family for the writer — a year under `xsd:gYear` is a date, and the
 * writer keeps today's behaviour for it. The validator keeps its own table
 * (per-type lexical policy is its concern, not this helper's).
 */
export function xsdNumericFamily(
  localName: string,
): "integer" | "decimal" | null {
  if (XSD_INTEGER_FAMILY.has(localName)) return "integer";
  if (XSD_DECIMAL_FAMILY.has(localName)) return "decimal";
  return null;
}

/** XSD 1.1 §3.4 integer-derived datatypes: whole numbers only. */
const XSD_INTEGER_FAMILY: ReadonlySet<string> = new Set([
  "integer",
  "long",
  "int",
  "short",
  "byte",
  "nonNegativeInteger",
  "unsignedLong",
  "unsignedInt",
  "unsignedShort",
  "unsignedByte",
  "positiveInteger",
  "nonPositiveInteger",
  "negativeInteger",
]);

/** XSD datatypes whose lexical space admits a fractional part. */
const XSD_DECIMAL_FAMILY: ReadonlySet<string> = new Set([
  "decimal",
  "float",
  "double",
]);

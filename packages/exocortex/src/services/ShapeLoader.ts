import { ShapeRegistry, Shape } from "./ShapeRegistry";
import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";

// W3C SHACL namespace base
const SH_NS = "http://www.w3.org/ns/shacl#";
// XML Schema Datatypes namespace base
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

// Legacy whitelist retained for documentation; runtime resolution now goes
// through Namespace.fromPropertyKey, which auto-extends to any well-formed
// `<prefix>__<local>` key (RFC: SHACL namespace whitelist relaxation).
const NAMESPACE_MAP: ReadonlyArray<[string, Namespace]> = [
  ["exo__", Namespace.EXO],
  ["ems__", Namespace.EMS],
  ["exocmd__", Namespace.EXOCMD],
  ["ims__", Namespace.IMS],
  ["ztlk__", Namespace.ZTLK],
  ["ptms__", Namespace.PTMS],
  ["lit__", Namespace.LIT],
  ["inbox__", Namespace.INBOX],
  ["pmbok__", Namespace.PMBOK],
];

void NAMESPACE_MAP;

/** Cached shape format written to / read from ~/.cache/exocortex/property-shapes.json */
export interface ShapeJSONCache {
  version: number;
  vaultMtime: number;
  shapes: Record<string, Omit<Shape, "propertyIRI"> & { propertyIRI: string }>;
}

export class ShapeLoader {
  /**
   * Node.js only: walks vaultPath, parses all exo__Property*.md files and
   * builds ShapeRegistry from their frontmatter.
   */
  static async loadFromVaultFS(vaultPath: string): Promise<ShapeRegistry> {
    // eslint-disable-next-line import/no-nodejs-modules
    const { readdir, readFile } = await import("fs/promises");
    // eslint-disable-next-line import/no-nodejs-modules
    const path = await import("path");
    const registry = new ShapeRegistry();
    await ShapeLoader.scanDir(vaultPath, registry, { readdir, readFile, path });
    return registry;
  }

  /**
   * Browser-safe: loads shapes from an in-memory ITripleStore
   * (as populated by VaultRDFIndexer / NoteToRDFConverter).
   */
  static async loadFromRDFGraph(graph: ITripleStore): Promise<ShapeRegistry> {
    const registry = new ShapeRegistry();

    const EXO = Namespace.EXO;
    const RDFS = Namespace.RDFS;
    const RDF = Namespace.RDF;

    // Find all property definition subjects (exo:Property or exo:ObjectProperty)
    const [objPropTriples, basePropTriples] = await Promise.all([
      graph.match(undefined, RDF.term("type"), EXO.term("ObjectProperty")),
      graph.match(undefined, RDF.term("type"), EXO.term("Property")),
    ]);

    const subjects = new Set<string>();
    for (const t of [...objPropTriples, ...basePropTriples]) {
      if (t.subject instanceof IRI) subjects.add(t.subject.value);
    }

    for (const subjectValue of subjects) {
      let subject: IRI;
      try {
        subject = new IRI(subjectValue);
      } catch {
        continue;
      }

      const [
        rdfsDomainTs,
        exoDomainTs,
        rdfsRangeTs,
        exoRangeTs,
        cardTs,
        sevTs,
        exoLabelTs,
        rdfsLabelTs,
        minCountTs,
        patternTs,
      ] = await Promise.all([
        graph.match(subject, RDFS.term("domain"), undefined),
        graph.match(subject, EXO.term("Property_domain"), undefined),
        graph.match(subject, RDFS.term("range"), undefined),
        graph.match(subject, EXO.term("Property_range"), undefined),
        graph.match(subject, EXO.term("Property_cardinality"), undefined),
        graph.match(subject, EXO.term("Property_severity"), undefined),
        graph.match(subject, EXO.term("Asset_label"), undefined),
        // Issue #2807 twin: when exo__Asset_label parses as a class reference
        // (`ems__Foo`), NoteToRDFConverter emits it as an IRI instead of a
        // Literal, breaking the Literal-only check below. Fall back to the
        // rdfs:label Literal twin that Exocortex always emits alongside.
        graph.match(subject, RDFS.term("label"), undefined),
        graph.match(subject, EXO.term("Property_minCount"), undefined),
        graph.match(subject, EXO.term("Property_pattern"), undefined),
      ]);
      const labelTs = [...exoLabelTs, ...rdfsLabelTs];
      // NoteToRDFConverter emits the RDFS-mapped twin triple only when the
      // object is an IRI (Issue #871). Plain-string range/domain values
      // (e.g. xsd:integer URIs) arrive only under the native
      // exo:Property_range / exo:Property_domain predicate, so we union both
      // sources to recover them.
      const domainTs = [...rdfsDomainTs, ...exoDomainTs];
      const rangeTs = [...rdfsRangeTs, ...exoRangeTs];

      if (domainTs.length === 0) continue;

      let propertyIRI: string | null = null;
      for (const t of labelTs) {
        if (t.object instanceof Literal) {
          propertyIRI = ShapeLoader.labelToIRI(t.object.value);
          if (propertyIRI) break;
        }
      }
      if (!propertyIRI) continue;

      // Resolve domain/range IRIs to canonical namespace form. After RFC-004
      // UUID-canonicalization, exo__Property_domain/range frontmatter holds
      // pure-UID wikilinks like `[[1b20a8f0-...]]`, which NoteToRDFConverter
      // converts to file IRIs (`obsidian://vault/.../1b20a8f0.md`) — not the
      // canonical class IRI (`https://exocortex.my/ontology/ems#Task`).
      // To make sh:class constraints fire against rdf:type triples (which DO
      // use canonical IRIs via valueToClassURI), look up each file IRI's
      // rdfs:label and convert to canonical IRI.
      const domainRaw = await Promise.all(
        domainTs.map(async (t) =>
          t.object instanceof IRI
            ? await ShapeLoader.resolveClassIRI(t.object.value, graph)
            : null,
        ),
      );
      const domain = Array.from(
        new Set(domainRaw.filter((v): v is string => v !== null)),
      );

      const rangeValuesRaw = await Promise.all(
        rangeTs.map(async (t) => {
          if (t.object instanceof IRI) {
            return await ShapeLoader.resolveClassIRI(t.object.value, graph);
          }
          // Plain-string range values (e.g. `exo__Property_range:
          // "http://www.w3.org/2001/XMLSchema#integer"`) arrive as Literals
          // because NoteToRDFConverter only emits IRI objects for wikilink
          // values. Accept any literal whose lexical form is itself a valid
          // IRI — this covers xsd:* datatype ranges and explicit HTTP IRIs.
          if (t.object instanceof Literal) {
            const raw = t.object.value;
            if (raw.startsWith("http://") || raw.startsWith("https://")) {
              return raw;
            }
          }
          return null;
        }),
      );
      const rangeValues = Array.from(
        new Set(rangeValuesRaw.filter((v): v is string => v !== null)),
      );

      const cardinality = ShapeLoader.cardinalityFromIRI(
        cardTs[0]?.object instanceof IRI ? cardTs[0].object.value : undefined,
      );

      const severity = ShapeLoader.severityFromValue(
        sevTs[0]?.object instanceof Literal
          ? sevTs[0].object.value
          : sevTs[0]?.object instanceof IRI
            ? sevTs[0].object.value
            : undefined,
      );

      const minCountLiteral = minCountTs[0]?.object;
      const minCountParsed =
        minCountLiteral instanceof Literal ? parseInt(minCountLiteral.value, 10) : NaN;
      const minCount = !isNaN(minCountParsed) ? minCountParsed : undefined;

      const patternLiteral = patternTs[0]?.object;
      const pattern =
        patternLiteral instanceof Literal && patternLiteral.value.length > 0
          ? patternLiteral.value
          : undefined;

      registry.register({
        propertyIRI,
        domain,
        range: rangeValues.length > 0 ? rangeValues : undefined,
        cardinality,
        severity,
        minCount,
        pattern,
      });
    }

    return registry;
  }

  /**
   * Reads pre-baked shape cache from a JSON file.
   * Format: ShapeJSONCache — see RFC 82a72aca §"Cached shape format".
   */
  static async loadFromShapeJSON(jsonPath: string): Promise<ShapeRegistry> {
    // eslint-disable-next-line import/no-nodejs-modules
    const { readFile } = await import("fs/promises");
    const raw = await readFile(jsonPath, "utf-8");
    const cache: ShapeJSONCache = JSON.parse(raw) as ShapeJSONCache;
    const registry = new ShapeRegistry();
    for (const shape of Object.values(cache.shapes)) {
      registry.register(shape);
    }
    return registry;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolves a domain/range IRI to its canonical namespace form.
   *
   * Context: after RFC-004 UUID-canonicalization, `exo__Property_domain` and
   * `exo__Property_range` frontmatter values are pure-UID wikilinks
   * `[[1b20a8f0-...]]`. NoteToRDFConverter emits these as file IRIs
   * (`obsidian://vault/.../1b20a8f0.md`) via `valueToRDFObject`, not as the
   * canonical class IRI (`https://exocortex.my/ontology/ems#Task`).
   *
   * sh:class constraints must compare against `rdf:type` triples which DO use
   * canonical IRIs (NoteToRDFConverter routes `exo__Instance_class` through
   * `valueToClassURI`). To bridge the two IRI spaces, this helper looks up
   * the class file's `rdfs:label` / `exo:Asset_label` literal and converts
   * via `labelToIRI`.
   *
   * Returns:
   *   - the passed IRI unchanged if it's already canonical
   *     (`https://exocortex.my/ontology/...` or `http://www.w3.org/...`)
   *   - the canonical IRI if a label lookup succeeds
   *   - the original file IRI as a passthrough fallback if no label exists
   *     (validator will likely skip; preserves prior behaviour)
   */
  private static async resolveClassIRI(
    iri: string,
    graph: ITripleStore,
  ): Promise<string | null> {
    if (
      iri.startsWith("https://exocortex.my/ontology/") ||
      iri.startsWith("http://www.w3.org/")
    ) {
      return iri;
    }

    let subject: IRI;
    try {
      subject = new IRI(iri);
    } catch {
      // Malformed file IRI (rare edge case) — drop this domain/range entry
      // rather than abort the entire shape registration.
      return null;
    }
    const RDFS = Namespace.RDFS;
    const EXO = Namespace.EXO;

    const [rdfsLabelTs, exoLabelTs] = await Promise.all([
      graph.match(subject, RDFS.term("label"), undefined),
      graph.match(subject, EXO.term("Asset_label"), undefined),
    ]);

    for (const t of [...rdfsLabelTs, ...exoLabelTs]) {
      if (t.object instanceof Literal) {
        const resolved = ShapeLoader.labelToIRI(t.object.value);
        if (resolved) return resolved;
      }
    }

    // Unresolvable — return original file IRI; validator will not match
    // against canonical rdf:type values, but at least domain[] is non-empty
    // so the shape still registers and other constraints (cardinality,
    // minCount) still apply.
    return iri;
  }

  private static async scanDir(
    dir: string,
    registry: ShapeRegistry,
    io: {
      readdir: (
        p: string,
        opts: { withFileTypes: true },
      ) => Promise<import("fs").Dirent[]>;
      readFile: (p: string, enc: "utf-8") => Promise<string>;
      path: typeof import("path");
    },
  ): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await io.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = io.path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await ShapeLoader.scanDir(full, registry, io);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // Fail-soft: one malformed property asset should not abort the scan.
        try {
          await ShapeLoader.processFile(full, registry, io.readFile, io.path);
        } catch {
          // Skip the offending file silently
        }
      }
    }
  }

  private static async processFile(
    filePath: string,
    registry: ShapeRegistry,
    readFile: (p: string, enc: "utf-8") => Promise<string>,
    path?: typeof import("path"),
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return;
    }

    const fm = ShapeLoader.parseFrontmatter(content);
    if (!fm) return;

    // Must be a property definition.
    // After RFC-004 UUID-canonicalization (2026-05-16), TBox class IRIs in
    // exo__Instance_class are written as pure UID wikilinks (no alias suffix),
    // so we must accept both:
    //   - label-form `[[exo__Property]]` / `[[exo__ObjectProperty]]` (legacy)
    //   - UID+alias form `[[<uid>|exo__Property]]` (intermediate canon)
    //   - pure UID form `[[<uid>]]` (current strip-canon)
    const EXO_PROPERTY_UID = "38277bfa-d7f9-4a75-b856-b23276ab0db3";
    const EXO_OBJECT_PROPERTY_UID = "9a1cf31c-9d41-4ef3-9023-584a8d087d16";
    const classes = ShapeLoader.asArray(fm["exo__Instance_class"]);
    const isProperty = classes.some((c) => {
      const ref = ShapeLoader.extractWikilinkRef(c);
      return (
        ref === "exo__Property" ||
        ref === "exo__ObjectProperty" ||
        ref === EXO_PROPERTY_UID ||
        ref === EXO_OBJECT_PROPERTY_UID ||
        ref?.includes("|exo__Property") ||
        ref?.includes("|exo__ObjectProperty")
      );
    });
    if (!isProperty) return;

    // Resolve label: prefer explicit `exo__Asset_label`, fall back to filename
    // basename for property assets that omit the label field (issue #3099).
    let label: string | null = null;
    const labelRaw = fm["exo__Asset_label"];
    if (typeof labelRaw === "string" && labelRaw.trim().length > 0) {
      label = labelRaw.trim();
    } else if (path) {
      const basename = path.basename(filePath, ".md");
      if (Namespace.fromPropertyKey(basename)) {
        label = basename;
      }
    }
    if (!label) return;

    const propertyIRI = ShapeLoader.labelToIRI(label);
    if (!propertyIRI) return;

    const domainRaw = fm["exo__Property_domain"];
    const rangeRaw = fm["exo__Property_range"];
    const cardRaw = fm["exo__Property_cardinality"];
    const sevRaw = fm["exo__Property_severity"];
    const minCountRaw = fm["exo__Property_minCount"];
    const patternRaw = fm["exo__Property_pattern"];

    const domain = ShapeLoader.asArray(domainRaw)
      .map((v) => ShapeLoader.wikilinkToIRI(v))
      .filter((v): v is string => v !== null);
    if (domain.length === 0) return;

    const range = ShapeLoader.asArray(rangeRaw)
      .map((v) => ShapeLoader.wikilinkToIRI(v))
      .filter((v): v is string => v !== null);

    const cardinality = ShapeLoader.cardinalityFromLabel(
      typeof cardRaw === "string" ? cardRaw : undefined,
    );

    const severity = ShapeLoader.severityFromValue(
      typeof sevRaw === "string" ? sevRaw : undefined,
    );

    const minCountParsed =
      typeof minCountRaw === "string" ? parseInt(minCountRaw, 10) : undefined;
    const minCount =
      minCountParsed !== undefined && !isNaN(minCountParsed) ? minCountParsed : undefined;

    // Strip surrounding YAML quotes that the simple regex-based parseFrontmatter
    // leaves in place. Pattern values typically need quoting due to regex special
    // characters, so this case is common in practice.
    const patternStripped =
      typeof patternRaw === "string"
        ? patternRaw.replace(/^["']|["']$/g, "")
        : undefined;
    const pattern =
      patternStripped !== undefined && patternStripped.length > 0
        ? patternStripped
        : undefined;

    registry.register({
      propertyIRI,
      domain,
      range: range.length > 0 ? range : undefined,
      cardinality,
      severity,
      minCount,
      pattern,
    });
  }

  /**
   * Parses YAML frontmatter (between --- delimiters).
   * Handles simple key: value and key:\n  - item arrays.
   * Returns null if no frontmatter found.
   */
  private static parseFrontmatter(
    content: string,
  ): Record<string, string | string[]> | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match) return null;

    const yaml = match[1];
    const result: Record<string, string | string[]> = {};
    const lines = yaml.split(/\r?\n/);
    let currentKey: string | null = null;
    let currentArray: string[] | null = null;

    for (const line of lines) {
      const arrayItem = /^ {2}- (.*)$/.exec(line);
      if (arrayItem) {
        if (currentKey && currentArray) {
          currentArray.push(arrayItem[1].trim());
        }
        continue;
      }

      // Save pending array
      if (currentKey && currentArray) {
        result[currentKey] = currentArray;
        currentKey = null;
        currentArray = null;
      }

      const kvMatch = /^([^:]+):\s*(.*)$/.exec(line);
      if (!kvMatch) continue;
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      if (value === "") {
        // Next lines may be array items
        currentKey = key;
        currentArray = [];
      } else {
        result[key] = value;
      }
    }

    // Flush pending array
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
    }

    return result;
  }

  /**
   * Converts label like `ems__Effort_parent` to full IRI, returning null only
   * for shapes that do not match the `<prefix>__<local>` form. Auto-extends to
   * ad-hoc namespaces under `https://exocortex.my/ontology/<prefix>#` for
   * prefixes outside the static whitelist (e.g. `aiKnow__`).
   */
  private static labelToIRI(label: string): string | null {
    const parsed = Namespace.fromPropertyKey(label);
    if (!parsed) return null;
    try {
      return parsed.namespace.term(parsed.localName).value;
    } catch {
      // Label contains characters that produce an invalid IRI when appended to
      // the namespace base (e.g. whitespace, brackets). Treat as unresolvable.
      return null;
    }
  }

  /** Extracts the first part of [[ref]] or [[ref|alias]], stripping quotes. */
  private static extractWikilinkRef(value: string): string | null {
    const clean = value.replace(/^["']|["']$/g, "");
    const m = /\[\[([^\]]+)\]\]/.exec(clean);
    if (!m) return clean;
    return m[1];
  }

  /**
   * Converts a wikilink value to a full IRI string.
   * Handles: "[[ems__Effort]]", "[[uuid|ems__Effort]]", "[[exo__PropertyCardinalitySingle]]"
   */
  private static wikilinkToIRI(value: string): string | null {
    const ref = ShapeLoader.extractWikilinkRef(value);
    if (!ref) return null;

    // [[uuid|alias]] — take alias part
    const parts = ref.split("|");
    const candidates = parts.length > 1 ? [parts[1], parts[0]] : [parts[0]];

    for (const candidate of candidates) {
      const iri = ShapeLoader.labelToIRI(candidate.trim());
      if (iri) return iri;
    }

    // Try as a full IRI
    if (ref.startsWith("http")) return ref;
    // Try SHACL prefix
    if (ref.startsWith("sh:")) return SH_NS + ref.substring(3);
    // Try XSD prefix
    if (ref.startsWith("xsd:")) return XSD_NS + ref.substring(4);

    return null;
  }

  private static asArray(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") return [v];
    return [];
  }

  private static cardinalityFromIRI(iri: string | undefined): "Single" | "Multiple" | undefined {
    if (!iri) return undefined;
    if (iri.endsWith("PropertyCardinalitySingle")) return "Single";
    if (iri.endsWith("PropertyCardinalityMultiple")) return "Multiple";
    return undefined;
  }

  private static cardinalityFromLabel(raw: string | undefined): "Single" | "Multiple" | undefined {
    if (!raw) return undefined;
    const ref = ShapeLoader.extractWikilinkRef(raw) ?? raw;
    const label = ref.split("|").pop() ?? ref;
    if (label.includes("Single")) return "Single";
    if (label.includes("Multiple")) return "Multiple";
    return undefined;
  }

  private static severityFromValue(
    raw: string | undefined,
  ): "sh:Violation" | "sh:Warning" | "sh:Info" {
    if (!raw) return "sh:Violation";
    if (raw.includes("Violation") || raw === SH_NS + "Violation") return "sh:Violation";
    if (raw.includes("Warning") || raw === SH_NS + "Warning") return "sh:Warning";
    if (raw.includes("Info") || raw === SH_NS + "Info") return "sh:Info";
    return "sh:Violation";
  }
}

import { ShapeRegistry, Shape } from "./ShapeRegistry";
import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";

// W3C SHACL namespace base
const SH_NS = "http://www.w3.org/ns/shacl#";

// Maps namespace prefix → Namespace (mirrors NoteToRDFConverter.NAMESPACE_MAP)
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const { readdir, readFile } = require("fs/promises") as typeof import("fs/promises");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const path = require("path") as typeof import("path");
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
      const subject = new IRI(subjectValue);

      const [domainTs, rangeTs, cardTs, sevTs, labelTs] = await Promise.all([
        graph.match(subject, RDFS.term("domain"), undefined),
        graph.match(subject, RDFS.term("range"), undefined),
        graph.match(subject, EXO.term("Property_cardinality"), undefined),
        graph.match(subject, EXO.term("Property_severity"), undefined),
        graph.match(subject, EXO.term("Asset_label"), undefined),
      ]);

      if (domainTs.length === 0) continue;

      const labelObj = labelTs[0]?.object;
      if (!(labelObj instanceof Literal)) continue;
      const propertyIRI = ShapeLoader.labelToIRI(labelObj.value);
      if (!propertyIRI) continue;

      const domain = domainTs
        .map((t) => (t.object instanceof IRI ? t.object.value : null))
        .filter((v): v is string => v !== null);

      const rangeValues = rangeTs
        .map((t) => (t.object instanceof IRI ? t.object.value : null))
        .filter((v): v is string => v !== null);

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

      registry.register({
        propertyIRI,
        domain,
        range: rangeValues.length > 0 ? rangeValues : undefined,
        cardinality,
        severity,
      });
    }

    return registry;
  }

  /**
   * Reads pre-baked shape cache from a JSON file.
   * Format: ShapeJSONCache — see RFC 82a72aca §"Cached shape format".
   */
  static async loadFromShapeJSON(jsonPath: string): Promise<ShapeRegistry> {
    // Dynamic import avoids static no-restricted-imports lint rule while
    // supporting both CommonJS (transpiled) and ESM (--experimental-vm-modules) contexts.
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
        await ShapeLoader.processFile(full, registry, io.readFile);
      }
    }
  }

  private static async processFile(
    filePath: string,
    registry: ShapeRegistry,
    readFile: (p: string, enc: "utf-8") => Promise<string>,
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return;
    }

    const fm = ShapeLoader.parseFrontmatter(content);
    if (!fm) return;

    // Must be a property definition
    const classes = ShapeLoader.asArray(fm["exo__Instance_class"]);
    const isProperty = classes.some((c) => {
      const ref = ShapeLoader.extractWikilinkRef(c);
      return (
        ref === "exo__Property" ||
        ref === "exo__ObjectProperty" ||
        ref?.includes("|exo__Property") ||
        ref?.includes("|exo__ObjectProperty")
      );
    });
    if (!isProperty) return;

    const labelRaw = fm["exo__Asset_label"];
    if (!labelRaw || typeof labelRaw !== "string") return;
    const label = labelRaw.trim();
    const propertyIRI = ShapeLoader.labelToIRI(label);
    if (!propertyIRI) return;

    const domainRaw = fm["exo__Property_domain"];
    const rangeRaw = fm["exo__Property_range"];
    const cardRaw = fm["exo__Property_cardinality"];
    const sevRaw = fm["exo__Property_severity"];

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

    registry.register({
      propertyIRI,
      domain,
      range: range.length > 0 ? range : undefined,
      cardinality,
      severity,
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

  /** Converts label like "ems__Effort_parent" to full IRI, or null if unknown prefix. */
  private static labelToIRI(label: string): string | null {
    for (const [prefix, ns] of NAMESPACE_MAP) {
      if (label.startsWith(prefix)) {
        return ns.term(label.substring(prefix.length)).value;
      }
    }
    return null;
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

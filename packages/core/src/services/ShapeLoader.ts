import { ShapeRegistry, Shape } from "./ShapeRegistry";
import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { xsdDatatypeIRI } from "../utilities/xsdDatatype";

// W3C SHACL namespace base
const SH_NS = "http://www.w3.org/ns/shacl#";

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

/** One `exo__Class_superClass` declaration seen by the FS scan (ticket 84bb4d08). */
interface FsClassEdge {
  /** Keys the declaring class file can be named by: filename stem, `exo__Asset_uid`, `exo__Asset_label`. */
  childKeys: readonly string[];
  /** Keys of every declared superclass (wikilink ref, and both halves of `uid|alias`). */
  parentKeys: readonly string[];
}

/** A file with an `exo__Property_domain`, kept until the class hierarchy is known. */
interface FsCandidate {
  filePath: string;
  fm: Record<string, string | string[]>;
}

interface FsScan {
  classEdges: FsClassEdge[];
  candidates: FsCandidate[];
}

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
   *
   * One pass over the tree collects (a) every `exo__Class_superClass` edge
   * and (b) every property-definition candidate (frontmatter with an
   * `exo__Property_domain`); candidates are registered only after the pass,
   * once the set of classes that IS-A `exo__Property` is known from (a) —
   * so a def typed `exo__DatatypeProperty` / `exo__StringProperty` / … is
   * accepted through the declared hierarchy, exactly as loadFromRDFGraph
   * does through the graph (ticket 84bb4d08).
   */
  static async loadFromVaultFS(vaultPath: string): Promise<ShapeRegistry> {
    const { readdir, readFile } = await import("fs/promises");
    const path = await import("path");
    const registry = new ShapeRegistry();
    const scan: FsScan = { classEdges: [], candidates: [] };
    await ShapeLoader.scanDir(vaultPath, scan, { readdir, readFile, path });
    const propertyClassKeys = ShapeLoader.propertyClassKeysFromEdges(scan.classEdges);
    for (const candidate of scan.candidates) {
      // Fail-soft: one malformed property asset should not abort the load.
      try {
        ShapeLoader.registerCandidate(candidate, registry, propertyClassKeys, path);
      } catch {
        // Skip the offending file silently
      }
    }
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

    // Issue #3523: build a UID → canonical-class-IRI index once, so a
    // domain/range value that arrived as a *synthesized* UUID-only file IRI
    // (`obsidian://vault/<uid>.md`, no directory) — emitted by a vault's
    // converter when a dependency's class def could not be resolved locally —
    // still canonicalizes to the same symbolic ontology IRI as the merged
    // single-vault case. The owning dep vault emits that class's `rdfs:label`
    // under its *full-path* subject IRI (`obsidian://vault/tbox/<uid>.md`), so
    // an exact-IRI label lookup misses; keying by the bare UID bridges the two
    // file-IRI forms.
    const uidToClassIRI = await ShapeLoader.buildUidClassIndex(graph);

    // Find all property definition subjects: every node typed as exo:Property
    // OR any of its (transitive) subclasses — exo:ObjectProperty,
    // exo:DatatypeProperty, exo:StringProperty → exo:DatatypeProperty, … —
    // resolved from the graph's own exo:Class_superClass / rdfs:subClassOf
    // edges (ticket 84bb4d08: an rdf:type-only match on Property|ObjectProperty
    // left 291/220/200 live defs [exodev/my/tbank] without a shape).
    const propertyClassIRIs = await ShapeLoader.collectPropertyClassIRIs(
      graph,
      uidToClassIRI,
    );
    const typeTripleSets = await Promise.all(
      [...propertyClassIRIs].map(async (classIRI) => {
        try {
          return await graph.match(undefined, RDF.term("type"), new IRI(classIRI));
        } catch {
          return [];
        }
      }),
    );

    const subjects = new Set<string>();
    for (const t of typeTripleSets.flat()) {
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
            ? await ShapeLoader.resolveClassIRI(t.object.value, graph, uidToClassIRI)
            : null,
        ),
      );
      const domain = Array.from(
        new Set(domainRaw.filter((v): v is string => v !== null)),
      );

      const rangeValuesRaw = await Promise.all(
        rangeTs.map(async (t) => {
          if (t.object instanceof IRI) {
            return await ShapeLoader.resolveClassIRI(t.object.value, graph, uidToClassIRI);
          }
          // Plain-string range values (e.g. `exo__Property_range:
          // "http://www.w3.org/2001/XMLSchema#integer"` or the live-corpus
          // CURIE form `"xsd:integer"`) arrive as Literals because
          // NoteToRDFConverter only emits IRI objects for wikilink values.
          // Resolve them with the SAME helper loadFromVaultFS uses, so the
          // two loaders agree on `shape.range` (ticket a9b55ead).
          if (t.object instanceof Literal) {
            return ShapeLoader.datatypeRangeToIRI(t.object.value);
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

      registry.register({
        propertyIRI,
        domain,
        range: rangeValues.length > 0 ? rangeValues : undefined,
        cardinality,
        severity,
        minCount,
      });
    }

    return registry;
  }

  /**
   * Reads pre-baked shape cache from a JSON file.
   * Format: ShapeJSONCache — see RFC 82a72aca §"Cached shape format".
   */
  static async loadFromShapeJSON(jsonPath: string): Promise<ShapeRegistry> {
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

  /** Matches `obsidian://vault/[<dirs>/]<uuid>.md` and captures the bare UUID. */
  private static readonly FILE_IRI_UID_RE =
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;

  /** Extracts the lowercase UUID from a `…/<uuid>.md` file IRI, or null. */
  private static extractUidFromFileIRI(iri: string): string | null {
    const m = ShapeLoader.FILE_IRI_UID_RE.exec(iri);
    return m ? m[1].toLowerCase() : null;
  }

  /**
   * Issue #3523: builds `uid → canonical-class-IRI` from every labelled subject
   * in the merged graph. Used
   * by {@link resolveClassIRI} to canonicalize a domain/range value that arrived
   * as a synthesized UUID-only file IRI whose exact-IRI label lookup misses
   * because the labelled subject lives under a full-path IRI in another vault.
   *
   * Only labels that parse to a `<prefix>__<Local>` ontology IRI are indexed —
   * human-named (non-symbolic) class files are left to the validator's existing
   * UID-twin / open-world handling. First-label-wins per UID (UIDs are unique).
   */
  private static async buildUidClassIndex(
    graph: ITripleStore,
  ): Promise<Map<string, string>> {
    const RDFS = Namespace.RDFS;
    const EXO = Namespace.EXO;
    const [rdfsLabelTs, exoLabelTs] = await Promise.all([
      graph.match(undefined, RDFS.term("label"), undefined),
      graph.match(undefined, EXO.term("Asset_label"), undefined),
    ]);
    const map = new Map<string, string>();
    for (const t of [...rdfsLabelTs, ...exoLabelTs]) {
      if (!(t.subject instanceof IRI) || !(t.object instanceof Literal)) continue;
      const uid = ShapeLoader.extractUidFromFileIRI(t.subject.value);
      if (!uid || map.has(uid)) continue;
      const labelValue = t.object.value.trim();
      // labelToIRI splits on the first `__`; multi-word labels would yield an
      // invalid IRI. Restrict to single-token labels for a safe namespace IRI.
      if (/\s/.test(labelValue)) continue;
      const classIRI = ShapeLoader.labelToIRI(labelValue);
      if (classIRI) map.set(uid, classIRI);
    }
    return map;
  }

  /**
   * Ticket 84bb4d08: the set of canonical class IRIs whose instances are
   * property definitions — `exo:Property` plus every class reachable from it
   * DOWNWARD through `exo:Class_superClass` / `rdfs:subClassOf` edges
   * (transitive: `exo:StringProperty → exo:DatatypeProperty → exo:Property`).
   *
   * Seeded with `exo:Property` and `exo:ObjectProperty` — the two classes the
   * loader matched before the walk existed — so a graph that carries no TBox
   * class files (fixtures, partial mounts) keeps its previous behaviour
   * verbatim; the walk only ever ADDS classes, and starts from BOTH seeds.
   *
   * Edge endpoints are canonicalized with the same {@link resolveClassIRI}
   * used for domain/range, so a file-IRI subject (`obsidian://…/<uid>.md`)
   * and a symbolic object (`exo#Property`) land in one IRI space. Cycles are
   * harmless (visited set); unresolvable endpoints stay as file IRIs and
   * simply never match an `rdf:type` object.
   */
  private static async collectPropertyClassIRIs(
    graph: ITripleStore,
    uidToClassIRI: ReadonlyMap<string, string>,
  ): Promise<Set<string>> {
    const EXO = Namespace.EXO;
    const RDFS = Namespace.RDFS;
    const [superTs, subClassOfTs] = await Promise.all([
      graph.match(undefined, EXO.term("Class_superClass"), undefined),
      graph.match(undefined, RDFS.term("subClassOf"), undefined),
    ]);

    // Memoized endpoint canonicalization — the same class file is the subject
    // of several edges and the object of many more.
    const resolved = new Map<string, string | null>();
    const canon = async (iri: string): Promise<string | null> => {
      let v = resolved.get(iri);
      if (v === undefined) {
        v = await ShapeLoader.resolveClassIRI(iri, graph, uidToClassIRI);
        resolved.set(iri, v);
      }
      return v;
    };

    // parent canonical IRI → child canonical IRIs
    const children = new Map<string, Set<string>>();
    for (const t of [...superTs, ...subClassOfTs]) {
      if (!(t.subject instanceof IRI) || !(t.object instanceof IRI)) continue;
      const [child, parent] = await Promise.all([
        canon(t.subject.value),
        canon(t.object.value),
      ]);
      if (!child || !parent || child === parent) continue;
      const set = children.get(parent) ?? new Set<string>();
      set.add(child);
      children.set(parent, set);
    }

    const result = new Set<string>([
      EXO.term("Property").value,
      EXO.term("ObjectProperty").value,
    ]);
    // Walk from EVERY seed: exo:ObjectProperty is already in `result`, so
    // reaching it as a child of exo:Property would not enqueue it — its own
    // subtree (exo:BooleanProperty ⊑ exo:ObjectProperty in exoas-exo) is only
    // visited when it is a root of the walk too (review #4271 MEDIUM).
    const queue = [...result];
    while (queue.length > 0) {
      const parent = queue.shift() as string;
      for (const child of children.get(parent) ?? []) {
        if (result.has(child)) continue;
        result.add(child);
        queue.push(child);
      }
    }
    return result;
  }

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
    uidToClassIRI?: ReadonlyMap<string, string>,
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

    // Issue #3523: the exact-IRI label lookup above misses for a synthesized
    // UUID-only file IRI (the labelled subject lives under a full-path IRI in
    // another vault). Fall back to the UID-keyed index so the range/domain
    // canonicalizes to the same symbolic class IRI the merged single-vault
    // converter would have produced — letting the class-membership
    // (`isSubClassOf`) check unify across the vault boundary.
    if (uidToClassIRI) {
      const uid = ShapeLoader.extractUidFromFileIRI(iri);
      if (uid) {
        const byUid = uidToClassIRI.get(uid);
        if (byUid) return byUid;
      }
    }

    // Unresolvable — return original file IRI; validator will not match
    // against canonical rdf:type values, but at least domain[] is non-empty
    // so the shape still registers and other constraints (cardinality,
    // minCount) still apply.
    return iri;
  }

  /** exo__Property class UID (`exoas-exo`, `exo__Property`). */
  private static readonly EXO_PROPERTY_UID = "38277bfa-d7f9-4a75-b856-b23276ab0db3";
  /** exo__ObjectProperty class UID (`exoas-exo`, `exo__ObjectProperty`). */
  private static readonly EXO_OBJECT_PROPERTY_UID = "9a1cf31c-9d41-4ef3-9023-584a8d087d16";

  /**
   * Ticket 84bb4d08 (FS twin of {@link collectPropertyClassIRIs}): the set of
   * class KEYS — label (`exo__DatatypeProperty`), UID, and filename stem —
   * under which a property definition's `exo__Instance_class` wikilink may
   * name a class that IS-A `exo__Property`. Seeded with the two classes the
   * loader always accepted (`exo__Property`, `exo__ObjectProperty`, label and
   * UID form), then walked DOWNWARD over the collected `exo__Class_superClass`
   * edges (BFS; a class already in the set is not re-queued, so a cycle
   * terminates — same shape as the graph walk).
   */
  private static propertyClassKeysFromEdges(edges: readonly FsClassEdge[]): Set<string> {
    const seeds = [
      "exo__Property",
      ShapeLoader.EXO_PROPERTY_UID,
      "exo__ObjectProperty",
      ShapeLoader.EXO_OBJECT_PROPERTY_UID,
    ];
    const keys = new Set<string>(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
      const parent = queue.shift() as string;
      for (const edge of edges) {
        if (!edge.parentKeys.includes(parent)) continue;
        if (edge.childKeys.some((k) => keys.has(k))) continue;
        for (const k of edge.childKeys) {
          keys.add(k);
          queue.push(k);
        }
      }
    }
    return keys;
  }

  /** All key forms a wikilink value can name a class by: `ref`, and both halves of `uid|alias`. */
  private static wikilinkClassKeys(value: string): string[] {
    const ref = ShapeLoader.extractWikilinkRef(value);
    if (!ref) return [];
    const out = [ref.trim()];
    for (const part of ref.split("|")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
    return out;
  }

  private static async scanDir(
    dir: string,
    scan: FsScan,
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
    // readdir order is filesystem-dependent (sorted on APFS, hashed on ext4);
    // scan in name order so the collected candidate sequence — and therefore
    // which of two defs sharing a propertyIRI registers last — is the same on
    // every platform.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = io.path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await ShapeLoader.scanDir(full, scan, io);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // Fail-soft: one malformed asset should not abort the scan.
        try {
          await ShapeLoader.collectFile(full, scan, io.readFile, io.path);
        } catch {
          // Skip the offending file silently
        }
      }
    }
  }

  /**
   * Reads one file's frontmatter and records what the post-scan phase needs:
   * its `exo__Class_superClass` edge (any asset declaring one — the TBox
   * class files) and/or itself as a property-definition candidate (any
   * asset with an `exo__Property_domain`). Everything else is dropped here,
   * so the pass keeps only the ~hundreds of TBox files in memory.
   */
  private static async collectFile(
    filePath: string,
    scan: FsScan,
    readFile: (p: string, enc: "utf-8") => Promise<string>,
    path: typeof import("path"),
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return;
    }

    const fm = ShapeLoader.parseFrontmatter(content);
    if (!fm) return;

    const superClasses = ShapeLoader.asArray(fm["exo__Class_superClass"]);
    if (superClasses.length > 0) {
      const childKeys = [path.basename(filePath, ".md")];
      const uidRaw = fm["exo__Asset_uid"];
      if (typeof uidRaw === "string" && uidRaw.trim().length > 0) {
        childKeys.push(uidRaw.trim().replace(/^["']|["']$/g, ""));
      }
      const labelRaw = fm["exo__Asset_label"];
      if (typeof labelRaw === "string" && labelRaw.trim().length > 0) {
        childKeys.push(labelRaw.trim().replace(/^["']|["']$/g, ""));
      }
      scan.classEdges.push({
        childKeys,
        parentKeys: superClasses.flatMap((v) => ShapeLoader.wikilinkClassKeys(v)),
      });
    }

    if (ShapeLoader.asArray(fm["exo__Property_domain"]).length > 0) {
      scan.candidates.push({ filePath, fm });
    }
  }

  private static registerCandidate(
    candidate: FsCandidate,
    registry: ShapeRegistry,
    propertyClassKeys: ReadonlySet<string>,
    path: typeof import("path"),
  ): void {
    const { filePath, fm } = candidate;

    // Must be a property definition: some `exo__Instance_class` value names a
    // class that IS-A `exo__Property` (see propertyClassKeysFromEdges).
    // After RFC-004 UUID-canonicalization (2026-05-16), TBox class IRIs in
    // exo__Instance_class are written as pure UID wikilinks (no alias suffix),
    // so every form is accepted:
    //   - label-form `[[exo__Property]]` / `[[exo__DatatypeProperty]]` (legacy)
    //   - UID+alias form `[[<uid>|exo__Property]]` (intermediate canon)
    //   - pure UID form `[[<uid>]]` (current strip-canon)
    const classes = ShapeLoader.asArray(fm["exo__Instance_class"]);
    const isProperty = classes.some((c) =>
      ShapeLoader.wikilinkClassKeys(c).some((k) => propertyClassKeys.has(k)),
    );
    if (!isProperty) return;

    // Resolve label: prefer explicit `exo__Asset_label`, fall back to filename
    // basename for property assets that omit the label field (issue #3099).
    let label: string | null = null;
    const labelRaw = fm["exo__Asset_label"];
    if (typeof labelRaw === "string" && labelRaw.trim().length > 0) {
      label = labelRaw.trim();
    } else {
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

    registry.register({
      propertyIRI,
      domain,
      range: range.length > 0 ? range : undefined,
      cardinality,
      severity,
      minCount,
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

    // Full http(s) IRI or CURIE `xsd:<local>` — shared with loadFromRDFGraph
    const datatypeIRI = ShapeLoader.datatypeRangeToIRI(ref);
    if (datatypeIRI) return datatypeIRI;
    // Try SHACL prefix
    if (ref.startsWith("sh:")) return SH_NS + ref.substring(3);

    return null;
  }

  /**
   * Resolves a range value written as a plain string (no wikilink) to an IRI:
   * a full `http://` / `https://` IRI is returned as-is, the CURIE `xsd:<local>`
   * (the form `create --class DatatypeProperty` writes and 100 % of live
   * datatype ranges use) expands to the W3C XSD namespace via the shared
   * {@link xsdDatatypeIRI} (local name kept verbatim — `xsd:dateTime` →
   * `…#dateTime`, the tag the converter emits; the resolver's lower-casing is
   * its own policy, not the helper's). Anything else is not a datatype range
   * → null. One implementation for BOTH loaders (loadFromRDFGraph literal
   * branch + loadFromVaultFS via wikilinkToIRI) so they cannot drift apart
   * again (ticket a9b55ead).
   */
  static datatypeRangeToIRI(raw: string): string | null {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return xsdDatatypeIRI(raw);
  }

  private static asArray(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") return [v];
    return [];
  }

  // Known cardinality enum UIDs. Property files post-UID-canon (RFC-004)
  // reference these via pure-UID wikilinks like
  // `exo__Property_cardinality: "[[c93c4b2f-...]]"`, so suffix-matching on
  // the `PropertyCardinalitySingle` label alone misses them (issue #3179).
  private static readonly CARDINALITY_SINGLE_UID =
    "c93c4b2f-b43d-4cc9-8dd0-31514d608da2";
  private static readonly CARDINALITY_MULTIPLE_UID =
    "59a37aa7-ffbe-4e0d-ba60-06ae370d880f";

  private static cardinalityFromIRI(iri: string | undefined): "Single" | "Multiple" | undefined {
    if (!iri) return undefined;
    if (iri.endsWith("PropertyCardinalitySingle")) return "Single";
    if (iri.endsWith("PropertyCardinalityMultiple")) return "Multiple";
    if (iri.includes(ShapeLoader.CARDINALITY_SINGLE_UID)) return "Single";
    if (iri.includes(ShapeLoader.CARDINALITY_MULTIPLE_UID)) return "Multiple";
    return undefined;
  }

  private static cardinalityFromLabel(raw: string | undefined): "Single" | "Multiple" | undefined {
    if (!raw) return undefined;
    const ref = ShapeLoader.extractWikilinkRef(raw) ?? raw;
    // ref may be either a label like `exo__PropertyCardinalitySingle`
    // or an alias form `<uid>|exo__PropertyCardinalitySingle`
    // or a pure UID `c93c4b2f-...` (post-UID-canon, RFC-004).
    const label = ref.split("|").pop() ?? ref;
    if (label.includes("Single")) return "Single";
    if (label.includes("Multiple")) return "Multiple";
    // Pure UID form: also check both halves of `ref` (covers `<uid>` alone
    // and `<uid>|<alias>` where the alias didn't match the suffix above).
    if (ref.includes(ShapeLoader.CARDINALITY_SINGLE_UID)) return "Single";
    if (ref.includes(ShapeLoader.CARDINALITY_MULTIPLE_UID)) return "Multiple";
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

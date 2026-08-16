import { IRI } from "./IRI";

export class Namespace {
  private readonly _prefix: string;
  private readonly _iri: IRI;

  constructor(prefix: string, iri: string) {
    if (prefix.trim().length === 0) {
      throw new Error("Namespace prefix cannot be empty");
    }

    this._prefix = prefix;
    this._iri = new IRI(iri);
  }

  get prefix(): string {
    return this._prefix;
  }

  get iri(): IRI {
    return this._iri;
  }

  term(localName: string): IRI {
    return new IRI(`${this._iri.value}${localName}`);
  }

  expand(prefixedName: string): IRI | null {
    const parts = prefixedName.split(":");
    if (parts.length !== 2) {
      return null;
    }

    const [prefix, localName] = parts;
    if (prefix !== this._prefix) {
      return null;
    }

    return this.term(localName);
  }

  static readonly RDF = new Namespace(
    "rdf",
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  );

  static readonly RDFS = new Namespace(
    "rdfs",
    "http://www.w3.org/2000/01/rdf-schema#"
  );

  static readonly OWL = new Namespace("owl", "http://www.w3.org/2002/07/owl#");

  static readonly XSD = new Namespace(
    "xsd",
    "http://www.w3.org/2001/XMLSchema#"
  );

  static readonly SHACL = new Namespace("sh", "http://www.w3.org/ns/shacl#");

  static readonly EXO = new Namespace("exo", "https://exocortex.my/ontology/exo#");

  static readonly EMS = new Namespace("ems", "https://exocortex.my/ontology/ems#");

  static readonly EXOCMD = new Namespace("exocmd", "https://exocortex.my/ontology/exocmd#");

  static readonly IMS = new Namespace("ims", "https://exocortex.my/ontology/ims#");

  static readonly ZTLK = new Namespace("ztlk", "https://exocortex.my/ontology/ztlk#");

  static readonly PTMS = new Namespace("ptms", "https://exocortex.my/ontology/ptms#");

  static readonly LIT = new Namespace("lit", "https://exocortex.my/ontology/lit#");

  static readonly INBOX = new Namespace("inbox", "https://exocortex.my/ontology/inbox#");

  static readonly PMBOK = new Namespace("pmbok", "https://exocortex.my/ontology/pmbok#");

  /**
   * Base IRI used to derive ad-hoc namespaces for property prefixes that are
   * not in the static whitelist (e.g. `aiKnow__`, `aiTask__`, `inbox__`-derived).
   *
   * Mirrors the standard Exocortex convention `https://exocortex.my/ontology/<prefix>#`,
   * so a frontmatter key `aiKnow__Memory_aboutConcept` resolves to
   * `<https://exocortex.my/ontology/aiKnow#Memory_aboutConcept>` without
   * requiring a code change every time the user introduces a new namespace.
   */
  static readonly EXOCORTEX_ONTOLOGY_BASE = "https://exocortex.my/ontology/";

  /**
   * Static whitelist of well-known prefixes. Lookup tries this first to keep
   * the canonical {@link Namespace} singletons (so reference equality and
   * prefix display remain stable), falling back to a derived namespace for
   * any other lowercase-leading prefix.
   *
   * The list has two groups:
   *
   * 1. **Exocortex namespaces** — resolve to `EXOCORTEX_ONTOLOGY_BASE` anyway;
   *    listed so that the canonical singleton (not a fresh equal-valued object)
   *    is returned.
   * 2. **External W3C vocabularies** (`rdf`, `rdfs`, `owl`, `xsd`, `sh`) — these
   *    MUST be listed, because their canonical IRIs are NOT derivable from
   *    `EXOCORTEX_ONTOLOGY_BASE`. Without them a vault asset labelled
   *    `rdfs__subClassOf` would emit `https://exocortex.my/ontology/rdfs#subClassOf`,
   *    while {@link RDFVocabularyMapper} already emits the very same term as a
   *    PREDICATE under `http://www.w3.org/2000/01/rdf-schema#subClassOf` — so the
   *    asset DEFINING a term and the usages OF that term would sit under two
   *    different IRIs and never join. See req `aceaa2cc-15b6-4e1c-bf63-72c7c209de51`.
   */
  private static readonly KNOWN_NAMESPACES: ReadonlyArray<Namespace> = [
    Namespace.EXO,
    Namespace.EMS,
    Namespace.EXOCMD,
    Namespace.IMS,
    Namespace.ZTLK,
    Namespace.PTMS,
    Namespace.LIT,
    Namespace.INBOX,
    Namespace.PMBOK,
    // External W3C vocabularies — canonical IRIs, not exocortex.my-derivable.
    Namespace.RDF,
    Namespace.RDFS,
    Namespace.OWL,
    Namespace.XSD,
    Namespace.SHACL,
  ];

  /**
   * Resolve a prefix string to a {@link Namespace}, returning the canonical
   * static singleton when the prefix is well-known, otherwise constructing an
   * ad-hoc namespace under {@link EXOCORTEX_ONTOLOGY_BASE}. Returns null for
   * invalid prefix shape (must start with lowercase letter, then alphanumerics).
   */
  static forPrefix(prefix: string): Namespace | null {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(prefix)) {
      return null;
    }
    const known = Namespace.KNOWN_NAMESPACES.find((n) => n.prefix === prefix);
    if (known) return known;
    return new Namespace(prefix, `${Namespace.EXOCORTEX_ONTOLOGY_BASE}${prefix}#`);
  }

  /**
   * Parse a frontmatter property key of the form `<prefix>__<localName>` into
   * a Namespace + local-name pair. Auto-extends to ad-hoc namespaces for
   * any well-formed lowercase-prefixed key, removing the historical hardcoded
   * whitelist constraint that swallowed `aiKnow__`, `aiTask__`, etc.
   */
  static fromPropertyKey(
    key: string,
  ): { namespace: Namespace; localName: string } | null {
    const match = /^([a-z][a-zA-Z0-9]*)__(.+)$/.exec(key);
    if (!match) return null;
    const namespace = Namespace.forPrefix(match[1]);
    if (!namespace) return null;
    return { namespace, localName: match[2] };
  }

  /**
   * INVERSE of {@link fromPropertyKey} + {@link Namespace.term}: recover the
   * namespace + local name from a term IRI.
   *
   * Resolution order mirrors {@link forPrefix} exactly — the whitelist first
   * (so an external W3C IRI such as `http://www.w3.org/2000/01/rdf-schema#subClassOf`
   * resolves to {@link RDFS}), then the ad-hoc `EXOCORTEX_ONTOLOGY_BASE` convention
   * (so `https://exocortex.my/ontology/aiKnow#Memory` still resolves).
   *
   * ⛔ Both directions MUST be derived from the SAME `KNOWN_NAMESPACES` array.
   * A second literal list of bases is how the two drift apart: registering a
   * vocabulary forward-only makes the emitter produce IRIs its own inverse
   * cannot read, which silently breaks every consumer that maps a term IRI back
   * to a frontmatter key (reified-predicate de-reification, wikilink naming).
   * See req `aceaa2cc-15b6-4e1c-bf63-72c7c209de51`.
   *
   * Returns `null` when the IRI belongs to no known/derivable namespace, or when
   * the local name is empty or itself contains `#`/`/` (not a clean `ns#Local`
   * term — a path-form `obsidian://…/<uid>.md` ref lands here).
   */
  static fromTermIRI(
    iri: string,
  ): { namespace: Namespace; localName: string } | null {
    if (typeof iri !== "string" || iri.length === 0) return null;

    const cleanLocal = (localName: string): string | null =>
      localName.length > 0 &&
      !localName.includes("#") &&
      !localName.includes("/")
        ? localName
        : null;

    // 1. Registered namespaces (both exocortex.my and external W3C vocabularies).
    for (const ns of Namespace.KNOWN_NAMESPACES) {
      const base = ns.iri.value;
      if (iri.startsWith(base)) {
        const localName = cleanLocal(iri.slice(base.length));
        if (localName === null) return null;
        return { namespace: ns, localName };
      }
    }

    // 2. Ad-hoc `EXOCORTEX_ONTOLOGY_BASE<prefix>#<LocalName>` convention.
    if (!iri.startsWith(Namespace.EXOCORTEX_ONTOLOGY_BASE)) return null;
    const rest = iri.slice(Namespace.EXOCORTEX_ONTOLOGY_BASE.length);
    const hash = rest.indexOf("#");
    if (hash <= 0) return null;
    const prefix = rest.slice(0, hash);
    if (!/^[a-z][a-zA-Z0-9]*$/.test(prefix)) return null;
    const localName = cleanLocal(rest.slice(hash + 1));
    if (localName === null) return null;
    const namespace = Namespace.forPrefix(prefix);
    if (!namespace) return null;
    return { namespace, localName };
  }

  /**
   * The registered namespaces, for consumers that must enumerate them (e.g. a
   * round-trip invariant test). Exposed read-only so the single source of truth
   * stays {@link KNOWN_NAMESPACES}.
   */
  static knownNamespaces(): ReadonlyArray<Namespace> {
    return Namespace.KNOWN_NAMESPACES;
  }
}

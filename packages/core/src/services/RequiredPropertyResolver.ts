import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { iriToObsidianName } from "../utilities/iriToObsidianName";
import { parseMinCount } from "../utilities/minCount";
import { xsdDatatypeLocalName } from "../utilities/xsdDatatype";

/**
 * T3 «Create Instance» (project bbe40f8c) — SHACL-shape-driven resolution of a
 * class's **required** properties, so the create-instance form can prompt for
 * them and produce a SHACL-valid instance.
 *
 * "Required" follows the SHACL-lite engine exactly (see {@link ShaclLiteValidator}):
 * a property is required iff it declares `exo__Property_minCount > 0` and its
 * `exo__Property_domain` is the class — or an ancestor of it via transitive
 * `exo__Class_superClass` (subclass closure). These are precisely the properties
 * whose absence yields a `sh:minCount` violation.
 *
 * Resolution runs entirely over the {@link ITripleStore} (available on desktop,
 * mobile, and CLI), keyed by **bare UID** so it is robust to the dual file-IRI
 * forms NoteToRDFConverter can emit (full-path `obsidian://vault/dir/<uid>.md`
 * vs synthesized `obsidian://vault/<uid>.md`). No canonical-IRI machinery.
 */

export type RequiredPropertyFieldType =
  | "text"
  | "date"
  | "number"
  | "boolean"
  | "assetRef";

export interface RequiredPropertyField {
  /** Frontmatter key written to the new instance, e.g. `exo__Setting_value`. */
  readonly propertyKey: string;
  /** Human label for the form field (defaults to the property key). */
  readonly label: string;
  /** Field renderer the form should use, derived from the property range. */
  readonly fieldType: RequiredPropertyFieldType;
  /**
   * For object ranges (`fieldType === "assetRef"`) — the key of the range class
   * whose instances populate the reusable reference-picker: the bare class UID
   * for a path-form range (`obsidian://…/<uid>.md`) or the class LABEL
   * (`<prefix>__<LocalName>`) for a symbolic ontology-term range
   * (`https://exocortex.my/ontology/<ns>#<Local>` — the form the converter
   * emits for every class with a `prefix__LocalName` label; ticket dc04eded).
   * `findAssetRefCandidates` accepts either key (req 15f48fa1). Absent for
   * datatype ranges or when the range IRI matches neither form.
   */
  readonly targetClassUid?: string;
}

/**
 * Resolve the SHACL-required properties of `hostClassUid`. Returns `[]` when the
 * class has no required (`minCount > 0`) properties — the common case, so the
 * create-instance form is unchanged for classes that don't need them.
 */
export type RequiredPropertyResolver = (
  hostClassUid: string,
) => Promise<RequiredPropertyField[]>;

/** `obsidian://vault/[<dirs>/]<uuid>.md` → captures the bare UUID. */
const FILE_IRI_UID_RE =
  /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;
const BARE_UID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extract a lowercase bare UID from a file IRI or a bare-UID string, or null. */
function uidFrom(value: string): string | null {
  const m = FILE_IRI_UID_RE.exec(value);
  if (m) return m[1].toLowerCase();
  if (BARE_UID_RE.test(value.trim())) return value.trim().toLowerCase();
  return null;
}

/**
 * Lower-cased XSD local name of a datatype range value, or `null` when the
 * value does not start with an XSD prefix at all. Parsing (full namespace IRI
 * `http://www.w3.org/2001/XMLSchema#dateTime` OR the CURIE literal
 * `xsd:dateTime`; a foreign prefix such as `ex:date` is NOT a datatype) is the
 * shared {@link xsdDatatypeLocalName}; the lower-casing is THIS resolver's
 * policy (the field-type table below is keyed by lower-case names), applied
 * here so the shared helper stays case-neutral for ShapeLoader, which keeps
 * the local name verbatim. A bare prefix (`xsd:` / the namespace alone) yields
 * an empty local name, which the caller maps to `text`.
 */
function xsdLocalName(value: string): string | null {
  const local = xsdDatatypeLocalName(value);
  return local === null ? null : local.toLowerCase();
}

/** Map an `exo__Property_range` value to a form field type (+ picker class). */
function fieldTypeFromRange(
  rangeValues: ReadonlyArray<{ iri: boolean; value: string }>,
): {
  fieldType: RequiredPropertyFieldType;
  targetClassUid?: string;
} {
  for (const r of rangeValues) {
    const value = r.value;
    // Datatype range: full W3C IRI (`http://www.w3.org/2001/XMLSchema#date`,
    // as IRI or literal) OR the CURIE literal `xsd:<local>` — the form the
    // live vaults actually carry (ticket 5380e7fd; measured in PR body).
    const local = xsdLocalName(value);
    if (local !== null) {
      if (local === "date" || local === "datetime")
        return { fieldType: "date" };
      if (local === "boolean") return { fieldType: "boolean" };
      if (
        [
          "integer",
          "int",
          "long",
          "short",
          "decimal",
          "float",
          "double",
          "nonnegativeinteger",
          "positiveinteger",
        ].includes(local)
      ) {
        return { fieldType: "number" };
      }
      return { fieldType: "text" };
    }
    // Non-xsd IRI range → an object (class) property → reference-picker.
    if (r.iri) {
      // Path-form / bare UID → the class UID (as before). Otherwise the shared
      // inverse (`Namespace.fromTermIRI` — registered, ad-hoc AND W3C
      // namespaces; it is now the ONLY inverse — the static nine-namespace map
      // this warned against was retired by ticket 6572f3f3 / req 38e3f174) turns a symbolic range into the
      // class LABEL `<prefix>__<LocalName>`, which the picker's candidate
      // resolver matches by label. On the live vaults nearly every class range
      // is symbolic, so `uidFrom` alone left the required-property picker empty
      // (ticket dc04eded; measured 2026-09-17, see PR #4254).
      const key = uidFrom(value) ?? iriToObsidianName(value);
      return key
        ? { fieldType: "assetRef", targetClassUid: key }
        : { fieldType: "assetRef" };
    }
  }
  return { fieldType: "text" };
}

/**
 * The match key of a class reference, from EITHER live IRI form.
 *
 * `exo__Property_domain` and the PARENT side of `exo__Class_superClass` are
 * emitted SYMBOLICALLY (`https://exocortex.my/ontology/<ns>#<Local>`) whenever
 * the target class carries a `<prefix>__<Local>` label — which every class does
 * (measured 2026-09-22: the domain of a required property is symbolic on 95 of
 * 95 live definitions across the three vaults; the parent of a superClass edge
 * on 400 of 408 on vault-exodev). `uidFrom` understands only the path/bare-UID
 * form, so keying on it alone silently dropped EVERY live class reference and
 * the required-property form fields this resolver feeds were empty for 100 % of
 * classes that declare one (0 of 23 / 17 / 20 on the three vaults).
 *
 * Returns the bare UID for a path-form ref and the lower-cased class LABEL for a
 * symbolic one; the twin lookup in the resolver unifies the two spellings of one
 * class, so a UID-keyed host still matches a label-keyed domain.
 */
function classKeyOf(value: string): string | null {
  const uid = uidFrom(value);
  if (uid) return uid;
  const name = iriToObsidianName(value);
  return name ? name.trim().toLowerCase() : null;
}

/**
 * The lower-cased label key of an `exo__Asset_label` / `rdfs:label` object.
 *
 * ⚠ A TBox class label parses as `prefix__Name`, so NoteToRDFConverter emits
 * `exo__Asset_label` as an **IRI**, not a Literal (`sparql-iri-form-pre-verify`
 * §A29) — a Literal-only reader is vacuous on exactly the TBox assets this
 * needs. The `rdfs:label` twin stays a Literal, so both shapes are accepted.
 */
function labelKeyOf(object: unknown): string | null {
  const raw =
    object instanceof Literal
      ? object.value
      : object instanceof IRI
        ? (iriToObsidianName(object.value) ?? "")
        : "";
  const key = raw.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

/**
 * The class-key closure of `hostClassUid`: the host itself, its transitive
 * `exo__Class_superClass` ancestors, and — for every key on that path — the
 * OTHER spelling of the same class (bare uid ⇄ lower-cased label), resolved
 * lazily and point-wise through the store.
 *
 * ⛤ ONE walk for BOTH resolvers (ticket abd22b00). It was introduced by req
 * 07509cf9 as a VERBATIM copy of steps 0+1 of
 * {@link createTripleStoreRequiredPropertyResolver} — deliberately, because that
 * change had to keep the existing resolver and its three production call-sites
 * byte-identical — and the copy carried an explicit note that converging it was
 * a follow-up. This IS that follow-up: the inline copy is gone and the required
 * resolver (`@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0`) now calls this one.
 *
 * Both resolvers' axes are therefore load-bearing for it, which is why the
 * convergence ran them together — and why the cycle guard below (`classUids` as
 * the visited set) finally has a mutant of its own: while the walk existed
 * twice, "cycle-safe" was held by reading the code in two places, not by a
 * measurement in either (review of PR #4325, LOW).
 */
async function resolveClassKeyClosure(
  store: ITripleStore,
  hostClassUid: string,
): Promise<Set<string>> {
  const EXO = Namespace.EXO;
  const RDFS = Namespace.RDFS;

  const host = classKeyOf(hostClassUid) ?? hostClassUid.trim().toLowerCase();
  if (!host) return new Set<string>();

  // 0. A class reference arrives in TWO IRI forms and both name ONE node —
  //    see `classKeyOf`. Twins are resolved LAZILY and POINT-WISE (the store
  //    indexes every position, so each lookup is O(1)): scanning all label
  //    triples up front measured ~128 ms per call on a 609k-triple vault
  //    against a 0.3 ms baseline, and this walk sits on the button/layout
  //    RENDER path (ButtonGroupsBuilder, LayoutCodeBlockProcessor). Point-wise
  //    it is 0.9 ms median. ⛔ Keep this rationale with the code: it is the
  //    reason the lazy form is not "premature optimisation" to be simplified
  //    away, and the convergence must not lose it along with the copy.
  const keyToIRIs = new Map<string, Set<string>>();
  const rememberIRI = (key: string, iri: string): void => {
    let set = keyToIRIs.get(key);
    if (!set) {
      set = new Set<string>();
      keyToIRIs.set(key, set);
    }
    set.add(iri);
  };
  const twinCache = new Map<string, string[]>();
  /** The OTHER spelling(s) of `key`: uid ⇄ label, resolved through the store. */
  const twinsOf = async (key: string): Promise<string[]> => {
    const cached = twinCache.get(key);
    if (cached) return cached;
    const twins = new Set<string>();
    for (const iri of keyToIRIs.get(key) ?? []) {
      if (uidFrom(iri)) {
        // path form → the label twin lives on the SAME subject
        for (const pred of [EXO.term("Asset_label"), RDFS.term("label")]) {
          for (const t of await store.match(new IRI(iri), pred, undefined)) {
            const label = labelKeyOf(t.object);
            if (label && label !== key) twins.add(label);
          }
        }
      } else {
        // symbolic form → the asset whose exo__Asset_label IS this very IRI
        for (const t of await store.match(
          undefined,
          EXO.term("Asset_label"),
          new IRI(iri),
        )) {
          const uid =
            t.subject instanceof IRI ? uidFrom(t.subject.value) : null;
          if (uid && uid !== key) twins.add(uid);
        }
      }
    }
    if (key === host) {
      // the host arrives as a bare uid, with no IRI of its own to key on
      for (const t of await store.match(
        undefined,
        EXO.term("Asset_uid"),
        new Literal(host),
      )) {
        if (!(t.subject instanceof IRI)) continue;
        for (const pred of [EXO.term("Asset_label"), RDFS.term("label")]) {
          for (const lt of await store.match(t.subject, pred, undefined)) {
            const label = labelKeyOf(lt.object);
            if (label && label !== key) twins.add(label);
          }
        }
      }
    }
    const out = [...twins];
    twinCache.set(key, out);
    return out;
  };

  // 1. host + transitive ancestors via exo:Class_superClass (cycle-safe).
  const superEdges = await store.match(
    undefined,
    EXO.term("Class_superClass"),
    undefined,
  );
  const childToParents = new Map<string, Set<string>>();
  for (const t of superEdges) {
    const child = t.subject instanceof IRI ? classKeyOf(t.subject.value) : null;
    const parent = t.object instanceof IRI ? classKeyOf(t.object.value) : null;
    if (!child || !parent) continue;
    if (t.subject instanceof IRI) rememberIRI(child, t.subject.value);
    if (t.object instanceof IRI) rememberIRI(parent, t.object.value);
    let set = childToParents.get(child);
    if (!set) {
      set = new Set<string>();
      childToParents.set(child, set);
    }
    set.add(parent);
  }
  const classUids = new Set<string>([host]);
  const queue: string[] = [host];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    // parents of the current key first, then that key's OTHER spelling
    const next = [...(childToParents.get(cur) ?? []), ...(await twinsOf(cur))];
    for (const key of next) {
      if (!classUids.has(key)) {
        classUids.add(key);
        queue.push(key);
      }
    }
  }
  return classUids;
}

/**
 * Build a {@link RequiredPropertyResolver} backed by an {@link ITripleStore}.
 * Used by the plugin's create-instance form (desktop + mobile) — both share the
 * same in-memory store, so this is a single implementation, not per-surface
 * (avoids the parser-drift class of bug).
 */
export function createTripleStoreRequiredPropertyResolver(
  store: ITripleStore,
): RequiredPropertyResolver {
  const EXO = Namespace.EXO;
  const RDFS = Namespace.RDFS;

  return async (hostClassUid: string): Promise<RequiredPropertyField[]> => {
    // 0+1. host + transitive ancestors, with the two IRI spellings of one class
    //      unified — {@link resolveClassKeyClosure}, the SAME walk the declared-
    //      property sibling uses. It used to be inlined here and copied verbatim
    //      there; ticket abd22b00 converged the two copies into this one call.
    const classUids = await resolveClassKeyClosure(store, hostClassUid);
    if (classUids.size === 0) return [];

    // 2. required (minCount > 0) properties whose domain ∈ {host + ancestors}.
    const minCountTriples = await store.match(
      undefined,
      EXO.term("Property_minCount"),
      undefined,
    );
    const fields: RequiredPropertyField[] = [];
    const seen = new Set<string>();

    for (const t of minCountTriples) {
      // ONE reader for the predicate (ticket abd22b00) — `undefined` here is
      // what `NaN` was before: a value that does not parse declares no
      // obligation, so the property is not required.
      const mc = parseMinCount(t.object);
      if (mc === undefined || mc <= 0) continue;
      const prop = t.subject;
      if (!(prop instanceof IRI)) continue;

      const domainTriples = await store.match(
        prop,
        EXO.term("Property_domain"),
        undefined,
      );
      const domainKeys = domainTriples
        .map((d) => (d.object instanceof IRI ? classKeyOf(d.object.value) : null))
        .filter((u): u is string => u !== null);
      if (!domainKeys.some((u) => classUids.has(u))) continue;

      // The property's label IS its frontmatter key (e.g. "exo__Setting_value").
      let propertyKey: string | null = null;
      for (const pred of [EXO.term("Asset_label"), RDFS.term("label")]) {
        const labelTriples = await store.match(prop, pred, undefined);
        for (const lt of labelTriples) {
          if (
            lt.object instanceof Literal &&
            lt.object.value.trim().length > 0
          ) {
            propertyKey = lt.object.value.trim();
            break;
          }
        }
        if (propertyKey) break;
      }
      if (!propertyKey || seen.has(propertyKey)) continue;
      seen.add(propertyKey);

      const rangeTriples = await store.match(
        prop,
        EXO.term("Property_range"),
        undefined,
      );
      const rangeValues = rangeTriples
        .map((rt) =>
          rt.object instanceof IRI
            ? { iri: true, value: rt.object.value }
            : rt.object instanceof Literal
              ? { iri: false, value: rt.object.value }
              : null,
        )
        .filter((v): v is { iri: boolean; value: string } => v !== null);

      const { fieldType, targetClassUid } = fieldTypeFromRange(rangeValues);
      fields.push({
        propertyKey,
        label: propertyKey,
        fieldType,
        targetClassUid,
      });
    }

    fields.sort((a, b) => a.propertyKey.localeCompare(b.propertyKey));
    return fields;
  };
}

/* ------------------------------------------------------------------------- *
 * Sibling resolver — the properties a class DECLARES (req 07509cf9)
 *
 * The resolver above answers "which properties of this class are REQUIRED",
 * anchored on `exo__Property_minCount`. That is a strictly narrower question
 * than "which properties does this class DECLARE": measured on vault-exodev
 * (2026-09-22, --no-cache) 735 properties carry `exo__Property_domain` and 44
 * carry `exo__Property_minCount` — 6 %. For `ems__Task` (72 properties across
 * Task + Effort + Asset) the minCount count is 0, so the minCount anchor sees
 * nothing at all there. The two anchors therefore cannot be unified by relaxing
 * a filter; a second factory is the only honest answer.
 *
 * Everything below reuses the machinery above unchanged — `classKeyOf` (both
 * IRI spellings), `labelKeyOf` (the `rdfs:label` twin, because a `prefix__Name`
 * label is emitted as an IRI, not a Literal), `fieldTypeFromRange`, and the
 * ancestor walk. `minCount > 0` survives as the `required` FLAG rather than as
 * a filter, so a consumer can tell a mandatory field from an optional one
 * without a second pass.
 * ------------------------------------------------------------------------- */

/**
 * A property DECLARED on a class (or on one of its ancestors), with everything
 * {@link RequiredPropertyField} carries plus whether it is mandatory.
 */
export interface ClassPropertyField extends RequiredPropertyField {
  /**
   * `true` iff the property declares `exo__Property_minCount > 0` — i.e. iff it
   * is one of the fields {@link createTripleStoreRequiredPropertyResolver}
   * would have returned. A property with no `minCount` at all is `false`.
   */
  readonly required: boolean;
}

/**
 * Resolve every property DECLARED for `hostClassUid`. Returns `[]` when no
 * `exo__Property_domain` points at the class or any of its ancestors.
 */
export type ClassPropertyResolver = (
  hostClassUid: string,
) => Promise<ClassPropertyField[]>;


/**
 * Build a {@link ClassPropertyResolver} backed by an {@link ITripleStore} — the
 * sibling of {@link createTripleStoreRequiredPropertyResolver}, anchored on
 * `exo__Property_domain` instead of `exo__Property_minCount`.
 *
 * Runs entirely over the store (desktop, mobile and CLI share it), so this is a
 * single implementation rather than one per surface.
 */
export function createTripleStoreClassPropertyResolver(
  store: ITripleStore,
): ClassPropertyResolver {
  const EXO = Namespace.EXO;
  const RDFS = Namespace.RDFS;

  return async (hostClassUid: string): Promise<ClassPropertyField[]> => {
    const classUids = await resolveClassKeyClosure(store, hostClassUid);
    if (classUids.size === 0) return [];

    // 2. every property whose DOMAIN ∈ {host + ancestors} — no minCount filter.
    const domainTriples = await store.match(
      undefined,
      EXO.term("Property_domain"),
      undefined,
    );
    const fields: ClassPropertyField[] = [];
    const seen = new Set<string>();

    for (const t of domainTriples) {
      const domainKey =
        t.object instanceof IRI ? classKeyOf(t.object.value) : null;
      if (!domainKey || !classUids.has(domainKey)) continue;
      const prop = t.subject;
      if (!(prop instanceof IRI)) continue;

      // The property's label IS its frontmatter key (e.g. "exo__Setting_value");
      // the `rdfs:label` twin is what makes it readable at all, because a
      // `prefix__Name` label is emitted as an IRI, not a Literal (§A29).
      let propertyKey: string | null = null;
      for (const pred of [EXO.term("Asset_label"), RDFS.term("label")]) {
        const labelTriples = await store.match(prop, pred, undefined);
        for (const lt of labelTriples) {
          if (
            lt.object instanceof Literal &&
            lt.object.value.trim().length > 0
          ) {
            propertyKey = lt.object.value.trim();
            break;
          }
        }
        if (propertyKey) break;
      }
      if (!propertyKey) continue;
      // One property may declare SEVERAL domains, and more than one of them can
      // sit on the host's ancestor chain — then the same frontmatter key would
      // come back twice. Keyed on the frontmatter key, because that is what a
      // consumer renders.
      if (seen.has(propertyKey)) continue;
      seen.add(propertyKey);

      // `minCount > 0` is the REQUIRED FLAG here, not a filter — but the READING
      // of the predicate is the shared one (ticket abd22b00). The helper answers
      // with the MAXIMUM of the declared values, and `max > 0` holds exactly when
      // "any declared value > 0" held before, so this flag is unchanged.
      const minCount = parseMinCount(
        (await store.match(prop, EXO.term("Property_minCount"), undefined)).map(
          (mt) => mt.object,
        ),
      );
      const required = minCount !== undefined && minCount > 0;

      const rangeTriples = await store.match(
        prop,
        EXO.term("Property_range"),
        undefined,
      );
      const rangeValues = rangeTriples
        .map((rt) =>
          rt.object instanceof IRI
            ? { iri: true, value: rt.object.value }
            : rt.object instanceof Literal
              ? { iri: false, value: rt.object.value }
              : null,
        )
        .filter((v): v is { iri: boolean; value: string } => v !== null);

      const { fieldType, targetClassUid } = fieldTypeFromRange(rangeValues);
      fields.push({
        propertyKey,
        label: propertyKey,
        fieldType,
        targetClassUid,
        required,
      });
    }

    // Deterministic order: the store yields domain triples in file order, which
    // is an accident of the vault rather than anything a consumer should render.
    fields.sort((a, b) => a.propertyKey.localeCompare(b.propertyKey));
    return fields;
  };
}

import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";

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

const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

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
   * For object ranges (`fieldType === "assetRef"`) — the UID of the range class
   * whose instances populate the reusable reference-picker. Absent for datatype
   * ranges or when the range class UID is unresolvable.
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

/** Map an `exo__Property_range` value to a form field type (+ picker class). */
function fieldTypeFromRange(
  rangeValues: ReadonlyArray<{ iri: boolean; value: string }>,
): {
  fieldType: RequiredPropertyFieldType;
  targetClassUid?: string;
} {
  for (const r of rangeValues) {
    const value = r.value;
    if (value.startsWith(XSD_NS)) {
      const local = value.slice(XSD_NS.length).toLowerCase();
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
      const uid = uidFrom(value);
      return uid
        ? { fieldType: "assetRef", targetClassUid: uid }
        : { fieldType: "assetRef" };
    }
  }
  return { fieldType: "text" };
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
    const host = uidFrom(hostClassUid) ?? hostClassUid.trim().toLowerCase();
    if (!host) return [];

    // 1. host + transitive ancestors via exo:Class_superClass (cycle-safe).
    const superEdges = await store.match(
      undefined,
      EXO.term("Class_superClass"),
      undefined,
    );
    const childToParents = new Map<string, Set<string>>();
    for (const t of superEdges) {
      const child = t.subject instanceof IRI ? uidFrom(t.subject.value) : null;
      const parent = t.object instanceof IRI ? uidFrom(t.object.value) : null;
      if (!child || !parent) continue;
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
      for (const parent of childToParents.get(cur) ?? []) {
        if (!classUids.has(parent)) {
          classUids.add(parent);
          queue.push(parent);
        }
      }
    }

    // 2. required (minCount > 0) properties whose domain ∈ {host + ancestors}.
    const minCountTriples = await store.match(
      undefined,
      EXO.term("Property_minCount"),
      undefined,
    );
    const fields: RequiredPropertyField[] = [];
    const seen = new Set<string>();

    for (const t of minCountTriples) {
      const mc =
        t.object instanceof Literal ? parseInt(t.object.value, 10) : NaN;
      if (!(mc > 0)) continue;
      const prop = t.subject;
      if (!(prop instanceof IRI)) continue;

      const domainTriples = await store.match(
        prop,
        EXO.term("Property_domain"),
        undefined,
      );
      const domainUids = domainTriples
        .map((d) => (d.object instanceof IRI ? uidFrom(d.object.value) : null))
        .filter((u): u is string => u !== null);
      if (!domainUids.some((u) => classUids.has(u))) continue;

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

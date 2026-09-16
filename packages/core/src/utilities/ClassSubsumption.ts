/**
 * Class subsumption over frontmatter-declared `exo__Class_superClass` edges
 * (req 15f48fa1, ticket 8df9e6eb).
 *
 * The reference-picker candidate resolver (plugin `findAssetRefCandidates`)
 * asks "which classes are the target class OR a transitive subclass of it?",
 * so that an `assetRef` field whose `targetClassUid` is an abstract / parent
 * class (`ems__Effort`, which has no direct instances) offers the instances
 * of `ems__Task`, `ems__Project`, `ems__Action`, … — every class whose
 * `exo__Class_superClass` chain reaches the target.
 *
 * Pure and store-free on purpose: the plugin feeds it the class definitions it
 * sees in the metadata cache, the CLI can feed it parsed frontmatter — the
 * closure is the same. The SPARQL-side walkers (`ClassHierarchyResolvingStore`,
 * `RequiredPropertyResolver`) key on triple-store IRIs and cannot serve a
 * metadata-cache consumer; the upward walkers (`GroundingExecutor`
 * prototype check, CLI `EffortStatusResolver`) answer the inverse question.
 *
 * Dual-IRI tolerance: a `superClass` / `Instance_class` ref may be
 * `[[<uid>]]`, `[[<uid>|<alias>]]`, `[[<label>]]` (quoted or not); the ref is
 * matched by its target (the part before `|`), which is either the class UID
 * or — legacy symbolic form — the class `exo__Asset_label`. Keys are
 * lower-cased so the match is case-insensitive.
 */

/** A class definition as seen in frontmatter (one per `exo__Class` file). */
export interface ClassDefinitionLike {
  /** `exo__Asset_uid` (or the file basename under UID-canon). */
  readonly uid: string;
  /** `exo__Asset_label` (the symbolic class name, e.g. `ems__Task`). */
  readonly label?: string | null;
  /** Raw `exo__Class_superClass` value(s) — wikilinks in any accepted form. */
  readonly superClassRefs: ReadonlyArray<unknown>;
}

/** Strip quotes / `[[ ]]` / `|alias` from a frontmatter ref → bare target. */
export function extractClassRefTarget(value: unknown): string {
  if (typeof value !== "string") return "";
  let ref = value.trim().replace(/^["']|["']$/g, "").trim();
  ref = ref.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const pipeIdx = ref.indexOf("|");
  if (pipeIdx >= 0) ref = ref.slice(0, pipeIdx);
  return ref.trim();
}

/**
 * Resolve the match keys (lower-cased UID + label) of `targetClass` and of
 * every class whose `exo__Class_superClass` chain reaches it — transitive,
 * multi-parent, cycle-safe (fixpoint over the declared edges, so a cycle
 * outside the target never loops and a cycle through it is simply subsumed).
 *
 * `targetClass` may be the class UID or its label; when no definition
 * declares it, the result is just `{ targetClass }` — exact-class matching
 * is preserved for an undeclared / subclass-less target.
 */
export function resolveSubsumedClassKeys(
  targetClass: string,
  classDefs: Iterable<ClassDefinitionLike>,
): Set<string> {
  const target = targetClass.trim().toLowerCase();
  const keys = new Set<string>();
  if (!target) return keys;
  keys.add(target);

  // Snapshot the definitions once: [own keys, parent-ref targets].
  const defs: Array<{ own: string[]; parents: string[] }> = [];
  for (const def of classDefs) {
    const own: string[] = [];
    const uid = typeof def.uid === "string" ? def.uid.trim().toLowerCase() : "";
    if (uid) own.push(uid);
    const label =
      typeof def.label === "string" ? def.label.trim().toLowerCase() : "";
    if (label) own.push(label);
    if (own.length === 0) continue;
    const parents: string[] = [];
    for (const ref of def.superClassRefs) {
      const t = extractClassRefTarget(ref).toLowerCase();
      if (t) parents.push(t);
    }
    // The target's own definition contributes its second key (label ↔ uid)
    // even without parents; a definition with no parents cannot be subsumed.
    if (own.includes(target)) for (const k of own) keys.add(k);
    if (parents.length > 0) defs.push({ own, parents });
  }

  // Fixpoint: include a class as soon as ANY of its parents is included.
  let changed = true;
  while (changed) {
    changed = false;
    for (const def of defs) {
      if (def.own.every((k) => keys.has(k))) continue;
      if (def.parents.some((p) => keys.has(p))) {
        for (const k of def.own) keys.add(k);
        changed = true;
      }
    }
  }
  return keys;
}

/**
 * `true` when any entry of a raw `exo__Instance_class` value (string or
 * list, any accepted wikilink form) targets one of `keys`.
 */
export function instanceClassMatches(
  instanceClass: unknown,
  keys: ReadonlySet<string>,
): boolean {
  if (instanceClass === undefined || instanceClass === null) return false;
  const entries = Array.isArray(instanceClass)
    ? instanceClass
    : [instanceClass];
  for (const entry of entries) {
    const target = extractClassRefTarget(entry).toLowerCase();
    if (target && keys.has(target)) return true;
  }
  return false;
}

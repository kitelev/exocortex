import { UnknownPropertyError } from "../utils/errors/UnknownPropertyError.js";

/**
 * The set of known property NAMES + their namespace prefixes, collected once
 * per process from the MOUNTED vault (RFC 430e84f1 must-have #1).
 */
interface PropertyNameSet {
  /** Known property names in `prefix__Name` label form (e.g. `ems__Effort_parent`). */
  names: Set<string>;
  /** Namespace prefixes seen among the known names (e.g. `ems`, `exo`). */
  prefixes: Set<string>;
}

/**
 * A class definition captured during the walk, feeding the property-metaclass
 * closure (#3955). `superRefs` are the wikilink ref-halves of its
 * `exo__Class_superClass` (UID and/or label).
 */
interface ClassDefRecord {
  uid: string | null;
  label: string | null;
  superRefs: string[];
}

/**
 * A `prefix__Name`-labelled instance — a property-def iff its class is (a
 * subclass of) a property metaclass, decided against the closure (#3955).
 */
interface PropertyDefCandidate {
  /** `exo__Instance_class` wikilink ref-halves (UID and/or label). */
  classRefs: string[];
  /** The `prefix__Name` property label. */
  name: string;
}

/**
 * Validates that `--property KEY=value` KEYS name a property that exists in the
 * MOUNTED TBox (RFC 430e84f1, P1). `create` already rejects a dangling wikilink
 * VALUE (`WikilinkValidator`); this closes the twin fail-silent hole on the KEY
 * — an LLM agent's typo (`ems__Effort_parentEffort` for `ems__Effort_parent`)
 * used to land a DEAD property no query/layout/graph-relation reads.
 *
 * Design (verify-before-assert, 2026-07-27):
 *  - The set is collected over the mounted vault, matching the three base
 *    property metaclasses — `exo__Property`, `exo__ObjectProperty`,
 *    `exo__DatatypeProperty` — AND every class that (transitively) subclasses
 *    one of them (`exo__TimestampProperty`, `exo__DateProperty`,
 *    `exo__StringProperty`, `exo__NonInheritableProperty`, …). Recognising only
 *    the 3 base metaclasses (the #3949 regression) dropped 108 of 369 real
 *    property-defs on vault-my — including `ems__Effort_plannedStartTimestamp`,
 *    whose `exo__Instance_class` is `exo__TimestampProperty` (⊂
 *    `exo__DatatypeProperty`), not a base metaclass (#3955, subClass-closure —
 *    the class-membership pattern from verify-before-assert). `ShapeLoader` is
 *    NOT reused because it is domain-filtered (`if domain.length===0 return`)
 *    and never matches `exo__DatatypeProperty`, so it would false-reject valid
 *    domainless / datatype properties.
 *  - The NAME is read from `exo__Asset_label` (the `prefix__Name` label form),
 *    and the `--property` KEY is also `prefix__Name`, so matching is direct
 *    string equality on the label. The symbolic↔UID dual-IRI налог
 *    (sparql-iri-form-pre-verify) applies only to STORE-IRI collection, which
 *    this does NOT use.
 *
 * Rules (must-haves #2-#7):
 *  - Non-`prefix__Name`-shaped keys (`aliases`, `tags`, `title`) are SKIPPED (#2/#3).
 *  - Empty mounted set (degenerate / no property TBox mounted) → SKIP all,
 *    fail-open — never brick a partial/degenerate profile (#7).
 *  - Name in set → PASS (#3 no false-positive).
 *  - Known prefix, unknown name → REJECT + fuzzy-suggest closest same-prefix
 *    name (#4).
 *  - Unknown prefix → REJECT (no near suggestion) (#4).
 *  - There is NO skip flag — property-name validation always runs (#6).
 */
export class PropertyNameValidator {
  /** `prefix__Local` shape; group 1 = prefix. Bare YAML keys never match. */
  private static readonly KEY_SHAPE = /^([A-Za-z][A-Za-z0-9]*)__.+$/;

  /**
   * Property metaclass identifiers, in every wikilink form the collector may
   * encounter (bare UID `[[<uid>]]`, alias `[[<uid>|label]]`, label `[[label]]`).
   */
  private static readonly PROPERTY_METACLASS_UIDS: ReadonlyArray<string> = [
    "38277bfa-d7f9-4a75-b856-b23276ab0db3", // exo__Property
    "9a1cf31c-9d41-4ef3-9023-584a8d087d16", // exo__ObjectProperty
    "ae56ca4c-b610-42a4-a25d-058c23673296", // exo__DatatypeProperty
  ];
  private static readonly PROPERTY_METACLASS_LABELS: ReadonlyArray<string> = [
    "exo__Property",
    "exo__ObjectProperty",
    "exo__DatatypeProperty",
  ];

  /** The `exo__Class` metaclass — identifies a class-def among mounted assets. */
  private static readonly CLASS_METACLASS_UID =
    "8619c4fc-64f1-4869-b17e-e34186cacca9";
  private static readonly CLASS_METACLASS_LABEL = "exo__Class";

  private cache: PropertyNameSet | null = null;

  constructor(private readonly vaultPath: string) {}

  /**
   * Validate the given `--property` KEYS against the mounted TBox.
   *
   * @throws UnknownPropertyError on the first key that is `prefix__Name`-shaped
   *   yet not a known mounted property name (only when the mounted set is
   *   non-empty).
   */
  async validate(propertyKeys: string[]): Promise<void> {
    const { names, prefixes } = await this.collect();

    // Fail-open: no property definitions mounted at all (degenerate / unmounted
    // TBox) → cannot judge, so skip rather than reject everything (must-have #7).
    if (names.size === 0) return;

    for (const key of propertyKeys) {
      const shape = PropertyNameValidator.KEY_SHAPE.exec(key);
      if (!shape) continue; // bare YAML key (aliases/tags/title) → skip (#2/#3)
      if (names.has(key)) continue; // known property name → pass (#3)

      const prefix = shape[1];
      const scopeToPrefix = prefixes.has(prefix) ? prefix : undefined;
      const suggestions = PropertyNameValidator.suggest(key, names, scopeToPrefix);
      throw new UnknownPropertyError(key, suggestions);
    }
  }

  /**
   * Collect the known property-name set from the mounted vault (cached).
   *
   * subClass-closure (#3955): a property-def's `exo__Instance_class` may point
   * not at a BASE metaclass but at a SUBCLASS of one (`exo__TimestampProperty`,
   * `exo__DateProperty`, `exo__NonInheritableProperty`, …). Recognising only the
   * 3 base metaclasses dropped 108/369 real property-defs on vault-my. So we
   * walk once, gathering (a) class-defs with their `exo__Class_superClass` refs
   * and (b) property-def candidates, then compute the transitive property-
   * metaclass closure and harvest every candidate whose class is in it.
   */
  async collect(): Promise<PropertyNameSet> {
    if (this.cache) return this.cache;

    // eslint-disable-next-line import/no-nodejs-modules
    const { readdir, readFile } = await import("fs/promises");

    const classDefs: ClassDefRecord[] = [];
    const candidates: PropertyDefCandidate[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: import("fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          let content: string;
          try {
            content = await readFile(full, "utf-8");
          } catch {
            continue;
          }
          PropertyNameValidator.scan(content, classDefs, candidates);
        }
      }
    };

    await walk(this.vaultPath);

    const metaKeys =
      PropertyNameValidator.buildPropertyMetaclassClosure(classDefs);

    const names = new Set<string>();
    const prefixes = new Set<string>();
    for (const cand of candidates) {
      if (!cand.classRefs.some((r) => metaKeys.has(r))) continue;
      names.add(cand.name);
      const m = PropertyNameValidator.KEY_SHAPE.exec(cand.name);
      if (m) prefixes.add(m[1]);
    }

    this.cache = { names, prefixes };
    return this.cache;
  }

  /**
   * Classify one file during the walk: record a class-def (feeding the metaclass
   * closure) or a `prefix__Name` property-def candidate. A class-def is an asset
   * whose `exo__Instance_class` references the `exo__Class` metaclass; whether a
   * candidate is actually a property is decided against the closure later
   * (#3955 subClass-closure).
   */
  private static scan(
    content: string,
    classDefs: ClassDefRecord[],
    candidates: PropertyDefCandidate[],
  ): void {
    const fm = PropertyNameValidator.parseFrontmatter(content);
    if (!fm) return;

    const instanceClassRefs = PropertyNameValidator.asArray(
      fm["exo__Instance_class"],
    ).flatMap((v) => PropertyNameValidator.refHalves(v));
    if (instanceClassRefs.length === 0) return;

    const label = PropertyNameValidator.cleanLabel(fm["exo__Asset_label"]);

    // Class-def → feed the metaclass closure (NOT a property-def candidate).
    if (
      instanceClassRefs.some((r) => PropertyNameValidator.isClassMetaclass(r))
    ) {
      const uidRaw = fm["exo__Asset_uid"];
      const uid = typeof uidRaw === "string" ? uidRaw.trim() : null;
      const superRefs = PropertyNameValidator.asArray(
        fm["exo__Class_superClass"],
      ).flatMap((v) => PropertyNameValidator.refHalves(v));
      classDefs.push({ uid, label, superRefs });
      return;
    }

    // Property-def candidate: a `prefix__Name`-labelled instance.
    if (label === null || !PropertyNameValidator.KEY_SHAPE.test(label)) return;
    candidates.push({ classRefs: instanceClassRefs, name: label });
  }

  /**
   * Transitive property-metaclass identifier set: the 3 base metaclasses plus
   * every class whose `exo__Class_superClass` chain reaches one of them
   * (`exo__TimestampProperty` ⊂ `exo__DatatypeProperty`, …). Returned as a set
   * of BOTH UID and label keys, so a candidate's `exo__Instance_class` ref (in
   * any wikilink form) matches by direct membership. Fixpoint over the class-
   * defs — a few hundred entries, converges in a handful of passes.
   */
  private static buildPropertyMetaclassClosure(
    classDefs: ReadonlyArray<ClassDefRecord>,
  ): Set<string> {
    const meta = new Set<string>([
      ...PropertyNameValidator.PROPERTY_METACLASS_UIDS,
      ...PropertyNameValidator.PROPERTY_METACLASS_LABELS,
    ]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const cd of classDefs) {
        const alreadyIn =
          (cd.uid !== null && meta.has(cd.uid)) ||
          (cd.label !== null && meta.has(cd.label));
        if (alreadyIn) continue;
        if (cd.superRefs.some((r) => meta.has(r))) {
          if (cd.uid !== null) meta.add(cd.uid);
          if (cd.label !== null) meta.add(cd.label);
          changed = true;
        }
      }
    }
    return meta;
  }

  /** True when a wikilink ref-half names the `exo__Class` metaclass. */
  private static isClassMetaclass(ref: string): boolean {
    return (
      ref === PropertyNameValidator.CLASS_METACLASS_UID ||
      ref === PropertyNameValidator.CLASS_METACLASS_LABEL
    );
  }

  /**
   * Every identifier half of a wikilink value: `[[uid]]` → `[uid]`,
   * `[[uid|label]]` → `[uid, label]`, bare `label` → `[label]`. Quotes stripped.
   */
  private static refHalves(value: string): string[] {
    const clean = String(value)
      .replace(/^["']|["']$/g, "")
      .trim();
    const m = /\[\[([^\]]+)\]\]/.exec(clean);
    const inner = m ? m[1] : clean;
    return inner
      .split("|")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
  }

  /** Frontmatter label as a trimmed, unquoted non-empty string, or null. */
  private static cleanLabel(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const label = raw.replace(/^["']|["']$/g, "").trim();
    return label.length > 0 ? label : null;
  }

  private static asArray(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") return [v];
    return [];
  }

  /**
   * Minimal YAML frontmatter parser (mirrors ShapeLoader): `key: value` and
   * `key:\n  - item` arrays. Sufficient for the fields harvested here.
   */
  private static parseFrontmatter(
    content: string,
  ): Record<string, string | string[]> | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match) return null;

    const result: Record<string, string | string[]> = {};
    const lines = match[1].split(/\r?\n/);
    let currentKey: string | null = null;
    let currentArray: string[] | null = null;

    for (const line of lines) {
      const arrayItem = /^ {2}- (.*)$/.exec(line);
      if (arrayItem) {
        if (currentKey && currentArray) currentArray.push(arrayItem[1].trim());
        continue;
      }
      if (currentKey && currentArray) {
        result[currentKey] = currentArray;
        currentKey = null;
        currentArray = null;
      }
      const kv = /^([^:]+):\s*(.*)$/.exec(line);
      if (!kv) continue;
      const key = kv[1].trim();
      const value = kv[2].trim();
      if (value === "") {
        currentKey = key;
        currentArray = [];
      } else {
        result[key] = value;
      }
    }
    if (currentKey && currentArray) result[currentKey] = currentArray;
    return result;
  }

  /**
   * Closest known names to `key` by Levenshtein distance, best-first (≤3).
   * Restricted to the same prefix when the prefix is known (so a typo in
   * `ems__` suggests `ems__` names, not cross-namespace noise); otherwise all
   * names are candidates (an unknown prefix rarely has a near match, so this
   * usually yields no suggestion — a plain reject).
   */
  private static suggest(
    key: string,
    names: Set<string>,
    samePrefix: string | undefined,
  ): string[] {
    const candidates = samePrefix
      ? [...names].filter((n) => n.startsWith(`${samePrefix}__`))
      : [...names];
    const threshold = Math.max(3, Math.floor(key.length * 0.4));

    return candidates
      .map((name) => ({
        name,
        distance: PropertyNameValidator.levenshtein(key, name),
      }))
      .filter((c) => c.distance <= threshold)
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((c) => c.name);
  }

  /** Standard iterative Levenshtein edit distance. */
  private static levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    let curr = new Array<number>(n + 1);
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  }
}

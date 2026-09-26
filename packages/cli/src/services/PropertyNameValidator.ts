import { UnknownPropertyError } from "../utils/errors/UnknownPropertyError.js";
import { PREFIX_PATTERN_SOURCE } from "../utils/namespacePrefix.js";

/**
 * The set of known property NAMES + their namespace prefixes, collected once
 * per process from the MOUNTED vault (RFC 430e84f1 must-have #1).
 */
interface PropertyNameSet {
  /** Known property names in `prefix__Name` label form (e.g. `ems__Effort_parent`). */
  names: Set<string>;
  /** Namespace prefixes seen among the known names (e.g. `ems`, `exo`). */
  prefixes: Set<string>;
  /**
   * Declared `exo__Property_range` values by property name, as the TBox
   * writes them (`xsd:integer`, `[[<class-uid>]]`, …; surrounding quotes
   * stripped, empty values dropped) — ticket 2227d660. Only defs that pass
   * the metaclass closure contribute; a def without a range is absent.
   */
  ranges: Map<string, readonly string[]>;
  /**
   * Conflicting duplicates found during the walk, keyed by property name:
   * a name declared by two or more defs with DIFFERENT ranges maps to the
   * ready-to-emit diagnostic naming the winner and the FIRST conflicting twin
   * in path order (ticket 3fc34b92). Recorded here rather than reported from
   * the walk, because the walk is cached and does not know which property the
   * caller is addressing — the accessors do, and they emit.
   */
  conflicts: Map<string, string>;
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
  /** `exo__Property_range` values as written (quotes stripped), possibly empty. */
  range: string[];
}

/** Same declared range, value for value (order-sensitive: a range is written as a list). */
function sameRange(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
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
  /**
   * `prefix__Local` shape; group 1 = prefix. Bare YAML keys never match.
   *
   * ⛔ #4353: this was a local `[A-Za-z][A-Za-z0-9]*`, narrower than the shared
   * grammar in BOTH directions — it rejected a hyphen (`tbank-nessy__Deal`) and
   * accepted a leading capital the rest of the system never emits. A key that
   * does not match is SKIPPED, so the hyphen case was a fail-open hole: a typo
   * in a hyphenated key sailed past `--property` validation entirely.
   *
   * Reading `PREFIX_PATTERN_SOURCE` closes it and, by construction, keeps this
   * validator from drifting from the emitter again.
   *
   * ⛤ The behaviour delta was MEASURED before the change, not assumed: across
   * all three live vaults (766 / 506 / 470 property assets) exactly ONE key
   * starts being validated — `my-tbox__Norm_recordedIn` — and it is itself a
   * declared property, so it passes. ZERO keys stop being validated. The
   * tightening the issue warned about therefore only reaches typos in
   * hyphenated keys, which is the point of the check.
   */
  private static readonly KEY_SHAPE = new RegExp(
    `^(${PREFIX_PATTERN_SOURCE})__.+$`,
  );

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

  /**
   * Property names whose duplicate-range diagnostic has already been delivered
   * on THIS instance (ticket 3fc34b92). `collect()` is cached, so the walk runs
   * once and cannot dedupe repeated ADDRESSING of the same name; this latch
   * does, keeping the guarantee "exactly one line per addressed name".
   *
   * ⚠ The unit of that guarantee is the INSTANCE, and every call site today
   * builds a fresh one per command invocation (`create.ts`, `set-property.ts`,
   * `remove-property.ts`). A future batch caller that REUSES one instance across
   * several writes would therefore report each conflicting name once for the
   * batch, not once per write — which is the right reading of "exactly one line
   * per addressed name", but it must be a deliberate choice rather than a
   * surprise, so the invariant is stated here rather than left to convention.
   */
  private readonly reported = new Set<string>();

  /** Injectable warn-level diagnostics channel (defaults to no-op, as `CliProfileResolver`). */
  private readonly warn: (msg: string) => void;

  /**
   * Read one file's text by ABSOLUTE path. Default: `fs/promises` — the walk
   * below reads every markdown file in the vault, and so does every other
   * collaborator of one `create`, each through its own walk (#4291: five
   * passes, 84 618 reads over 16 923 files). An injected reader lets them
   * share one read per file. It supplies TEXT only: which names this validator
   * harvests from that text is unchanged.
   */
  private readonly readFileImpl?: (
    filePath: string,
    encoding: "utf-8",
  ) => Promise<string>;

  constructor(
    private readonly vaultPath: string,
    options: {
      warn?: (msg: string) => void;
      readFile?: (filePath: string, encoding: "utf-8") => Promise<string>;
    } = {},
  ) {
    this.warn = options.warn ?? (() => undefined);
    this.readFileImpl = options.readFile;
  }

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
   * NON-BLOCKING counterpart of {@link validate}: is this KEY `prefix__Name`-shaped
   * yet ABSENT from the mounted TBox?
   *
   * The DELETE side (`remove-property`) deliberately ACCEPTS an undeclared
   * property — a property outside the TBox has no consumers and is not
   * SHACL-validated, i.e. it is garbage by construction and precisely the class
   * that command exists to remove (req 59220c17). But a typo there is then
   * indistinguishable from a legitimate idempotent no-op, so the caller uses
   * this to emit a HINT (never a refusal) when nothing was removed.
   *
   * Same rules as {@link validate}, minus the throw: a bare YAML key
   * (aliases/tags/title) is not judged, and an empty mounted set fails OPEN.
   */
  async isUnknownName(key: string): Promise<boolean> {
    const { names } = await this.collect();
    if (names.size === 0) return false; // fail-open (must-have #7)
    if (!PropertyNameValidator.KEY_SHAPE.test(key)) return false;
    return !names.has(key);
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
    const { readdir, readFile: readFileFs } = await import("fs/promises");
    const readFile = this.readFileImpl ?? readFileFs;

    const classDefs: ClassDefRecord[] = [];
    const candidates: PropertyDefCandidate[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: import("fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      // readdir order is not guaranteed sorted on any filesystem; byte-order
      // like `ShapeLoader.scanDir`, so which def a duplicate label resolves
      // to below is the same on every platform (ticket 8185c9dd, review
      // #4282 NIT-2).
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
    const ranges = new Map<string, readonly string[]>();
    const conflicts = new Map<string, string>();
    for (const cand of candidates) {
      if (!cand.classRefs.some((r) => metaKeys.has(r))) continue;
      names.add(cand.name);
      const m = PropertyNameValidator.KEY_SHAPE.exec(cand.name);
      if (m) prefixes.add(m[1]);
      // Ticket 2227d660: the declared range rides along on the same pass so the
      // writers (`create` / `set-property`) can type a scalar by it at no extra
      // IO. Two defs sharing a name (a deprecated twin, a re-declaration in
      // another mounted assetspace): a def with an EMPTY range is skipped
      // FIRST, before any of the rules below, so a rangeless twin neither wins
      // nor conflicts; among the RANGED defs the first one in byte-ordered walk
      // order wins (ticket 8185c9dd, NIT-2 — deterministic on every platform),
      // and a twin declaring a DIFFERENT range is recorded once per name — the
      // writer will type by the first def and the author should know which.
      //
      // Ticket 3fc34b92: the conflict is only RECORDED here, never reported.
      // This walk runs once per instance (the cache above) and does not know
      // which property the caller is addressing, so reporting from it named
      // every conflicting duplicate in the mounted TBox on every write. The
      // accessors below know the addressed name and emit there.
      if (cand.range.length === 0) continue;
      const first = ranges.get(cand.name);
      if (first === undefined) {
        ranges.set(cand.name, cand.range);
      } else if (!sameRange(first, cand.range) && !conflicts.has(cand.name)) {
        conflicts.set(
          cand.name,
          `[PropertyNameValidator] property ${cand.name} is declared more than once with different exo__Property_range (${first.join(", ")} vs ${cand.range.join(", ")}) — the first def in path order wins`,
        );
      }
    }

    this.cache = { names, prefixes, ranges, conflicts };
    return this.cache;
  }

  /**
   * Emit the duplicate-range diagnostic for ONE addressed property name, at
   * most once per instance (ticket 3fc34b92). A name with no recorded conflict
   * — the overwhelming majority — costs one Map lookup and stays silent.
   */
  private report(conflicts: ReadonlyMap<string, string>, name: string): void {
    if (this.reported.has(name)) return;
    const message = conflicts.get(name);
    if (message === undefined) return;
    this.reported.add(name);
    this.warn(message);
  }

  /**
   * Declared `exo__Property_range` values of a mounted property def, by its
   * `prefix__Name` label (ticket 2227d660), or `undefined` when no mounted def
   * declares one — the writers then fall back to shape-based typing.
   *
   * This is the per-name ACCESS point, so it is where a duplicate-range
   * conflict on THAT name is reported (ticket 3fc34b92) — a conflict on any
   * other name stays silent here.
   */
  async declaredRange(name: string): Promise<readonly string[] | undefined> {
    const { ranges, conflicts } = await this.collect();
    this.report(conflicts, name);
    return ranges.get(name);
  }

  /**
   * Every declared range collected on the mounted vault, keyed by property
   * name — handed to `GenericAssetCreationService` by `cli create` so the
   * frontmatter it assembles is typed by the same TBox the key check reads.
   *
   * A bulk hand-off addresses no name by itself (the service resolves per
   * supplied key inside), so it reports nothing unless the caller says which
   * properties it is writing: pass `addressed` — `cli create` passes the very
   * same key set it hands to {@link validate} — and each of those names gets
   * its conflict reported exactly once (ticket 3fc34b92).
   */
  async declaredRanges(
    addressed?: Iterable<string>,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const { ranges, conflicts } = await this.collect();
    if (addressed !== undefined) {
      for (const name of addressed) this.report(conflicts, name);
    }
    return ranges;
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
    const range = PropertyNameValidator.asArray(fm["exo__Property_range"])
      .map((v) => v.replace(/^["']|["']$/g, "").trim())
      .filter((v) => v.length > 0);
    candidates.push({ classRefs: instanceClassRefs, name: label, range });
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

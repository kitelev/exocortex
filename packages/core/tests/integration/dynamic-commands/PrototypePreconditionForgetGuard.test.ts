/**
 * Forget-leak guard (req @req:5579ffa1-a829-4fcf-b93d-4fb664b02d62).
 *
 * Walks the REAL `packages/exoas-exocmd` submodule, classifies every
 * `exocmd__Command` by the targetClass of its `exocmd__CommandBinding`s, and
 * asserts that EVERY instance-lifecycle command (bindings target
 * ems__Task/Project/Area/Meeting/Session — NOT exo__Asset, NOT a prototype
 * class, NOT a class metaclass) carries a command-level
 * `exocmd__Command_precondition` whose precondition tree ENFORCES the canonical
 * not-a-prototype clause
 * (`FILTER NOT EXISTS { … exo:Instance_class … STRENDS(…, "Prototype") … }`).
 *
 * The clause may live on the direct precondition's flat `exocmd__Precondition_sparqlAsk`
 * OR nested inside a `exocmd__AllPrecondition_preconditions` / `exocmd__AnyPrecondition_preconditions`
 * composite (the preconditions were restructured flat → nested composites on
 * 2026-07-07, reqs 127763f8 / f6c2b98c). `enforcesNotPrototype` walks the tree
 * with AND/OR semantics — an AND-conjunct carrying the clause hides the command on
 * prototypes; an OR needs the clause in EVERY branch. A flat-only read returns null
 * on a composite → both a false failure AND blindness to a genuine forget-leak.
 *
 * If a future lifecycle command (or a binding retargeted onto a lifecycle class)
 * ships without the clause anywhere in its precondition tree, this fails — the
 * silent-leak the precondition-primary design is otherwise vulnerable to
 * (design node f853eadd, §forget-leak guard).
 *
 * Conversely, asserts universal-maintenance commands (targetClass exo__Asset) do
 * NOT carry the clause (they must keep working on prototype-template assets).
 *
 * @req:5579ffa1-a829-4fcf-b93d-4fb664b02d62
 */
import * as fs from "fs";
import * as path from "path";

const SUBMODULE_EXOCMD = path.resolve(__dirname, "../../../../exoas-exocmd/exocmd");

const COMMAND_BINDING_CLASS_UID = "3677039a-a5a8-4402-9a07-f8f18fe384ad";
const STANDALONE_PRECONDITION_UID = "847c37e0-9812-4dc7-9a92-923dac7cda56";

// Lifecycle target classes (label form) — bindings on these make a command an
// instance-lifecycle command that MUST carry the not-a-prototype clause.
const LIFECYCLE_TARGET_CLASSES = new Set([
  "ems__Task",
  "ems__Project",
  "ems__Area",
  "ems__Effort",
  "ems__Meeting",
  "ems__Session",
]);
const UNIVERSAL_TARGET_CLASSES = new Set(["exo__Asset"]);

// STRENDS not-a-prototype clause (suffix check on the symbolic instance_class IRI).
const NOT_A_PROTOTYPE_CLAUSE_RE =
  /FILTER\s+NOT\s+EXISTS\s*\{[^}]*Instance_class[^}]*STRENDS\s*\(\s*STR\s*\(\s*\?\w+\s*\)\s*,\s*["']Prototype["']\s*\)[^}]*\}/i;

interface Asset {
  uid: string;
  label: string;
  file: string;
  fm: Record<string, string | string[]>;
  raw: string;
}

function parseFrontmatter(content: string): Record<string, string | string[]> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, string | string[]> = {};
  let key: string | null = null;
  let list: string[] | null = null;
  for (const line of m[1].split("\n")) {
    const li = line.match(/^\s*-\s*(.+)$/);
    if (li && list) {
      list.push(li[1].trim().replace(/^"|"$/g, ""));
      continue;
    }
    const kv = line.match(/^([a-zA-Z_][\w]*?):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      if (v === "") {
        list = [];
        fm[key] = list;
      } else {
        fm[key] = v.replace(/^"|"$/g, "");
        list = null;
      }
    }
  }
  return fm;
}

function wikilinkUid(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.match(/\[\[([0-9a-f-]{36})/i);
  return m ? m[1].toLowerCase() : null;
}

function loadAssets(): Asset[] {
  if (!fs.existsSync(SUBMODULE_EXOCMD)) {
    throw new Error(
      `exoas-exocmd submodule not found at ${SUBMODULE_EXOCMD}. Run \`git submodule update --init packages/exoas-exocmd\``,
    );
  }
  const out: Asset[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const raw = fs.readFileSync(full, "utf8");
      const fm = parseFrontmatter(raw);
      out.push({
        uid: (fm["exo__Asset_uid"] as string) ?? "",
        label: (fm["exo__Asset_label"] as string) ?? "",
        file: full,
        fm,
        raw,
      });
    }
  };
  walk(SUBMODULE_EXOCMD);
  return out;
}

function instanceClassUids(fm: Record<string, string | string[]>): string[] {
  const ic = fm["exo__Instance_class"];
  const refs = Array.isArray(ic) ? ic : typeof ic === "string" ? [ic] : [];
  return refs.map(wikilinkUid).filter((u): u is string => u !== null);
}

// ---------------------------------------------------------------------------
// Composite-aware not-a-prototype enforcement.
// The preconditions were restructured flat → nested AllPrecondition /
// AnyPrecondition composites on 2026-07-07 (reqs 127763f8 / f6c2b98c). The
// canonical clause now lives on a LEAF of the transitive precondition tree, not
// necessarily on the direct command precondition. A flat `sparqlAsk` read returns
// null on a composite → a false failure AND blindness to a genuine forget-leak.
// These pure helpers walk the tree with AND/OR semantics; `resolve` maps a UID to
// its asset (real `byUid` in the data tests, a synthetic map in the unit tests).
// ---------------------------------------------------------------------------

const ALL_PRECONDITION_FIELD = "exocmd__AllPrecondition_preconditions";
const ANY_PRECONDITION_FIELD = "exocmd__AnyPrecondition_preconditions";
const NOT_PRECONDITION_FIELD = "exocmd__NotPrecondition_precondition";

// Positive "is a prototype" check — the STRENDS suffix on the instance_class IRI
// WITHOUT the `FILTER NOT EXISTS` wrapper (the extracted atomic `Is prototype`,
// 011eb4d6, that `NotPrecondition` composites negate). Used to recognise the
// composable not-a-prototype form `NotPrecondition(IsPrototype)`.
const IS_PROTOTYPE_STRENDS_RE =
  /Instance_class[\s\S]*?STRENDS\s*\(\s*STR\s*\(\s*\?\w+\s*\)\s*,\s*["']Prototype["']\s*\)/i;

/**
 * True iff the ask is the positive "target IS a prototype" check (STRENDS suffix,
 * no `NOT EXISTS` wrapper, no `UNION` branch that could admit a non-prototype).
 * NOTE (deferred hardening): this is a shape heuristic, not identity — a *narrowed*
 * positive check (`… STRENDS "Prototype" … FILTER(?extra)`) whose child is a strict
 * subset of prototypes would still classify here, and `¬child` would then NOT
 * guarantee not-a-prototype. Unreachable in current data (the only composable form
 * is `NotPrecondition(011eb4d6 pure IsPrototype)`); a fully sound alternative is
 * UID-identity to the canonical atomics — tracked as a follow-up.
 */
function askIsPositivePrototypeCheck(ask: string): boolean {
  return (
    IS_PROTOTYPE_STRENDS_RE.test(ask) &&
    !/NOT\s+EXISTS/i.test(ask) &&
    !/\bUNION\b/i.test(ask)
  );
}

/**
 * True iff a flat ask ENFORCES not-a-prototype: it carries the canonical
 * `FILTER NOT EXISTS { … STRENDS "Prototype" … }` clause AND is not defeated by a
 * sibling `UNION` branch a prototype could satisfy.
 */
function askEnforcesNotPrototypeFlat(ask: string): boolean {
  return NOT_A_PROTOTYPE_CLAUSE_RE.test(ask) && !/\bUNION\b/i.test(ask);
}

/** wikilinkUid of a field that may be authored as a scalar OR a single-element list. */
function firstWikilinkUid(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v.length > 0 ? wikilinkUid(v[0]) : null;
  return wikilinkUid(v);
}

/** Read a precondition's flat sparqlAsk (multi-line block scalar or inline), or null. */
function sparqlAskOf(pre: Asset): string | null {
  const m = pre.raw.match(
    /exocmd__Precondition_sparqlAsk:\s*[>|][-]?\n((?:  .*\n?)+)/,
  );
  if (m) return m[1];
  const v = pre.fm["exocmd__Precondition_sparqlAsk"];
  return typeof v === "string" ? v : null;
}

/** Child precondition UIDs referenced by a composite field. */
function compositeChildren(pre: Asset, field: string): string[] {
  const raw = pre.fm[field];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return list
    .map((v) => wikilinkUid(v))
    .filter((u): u is string => u !== null);
}

/**
 * True iff the precondition rooted at `uid` ENFORCES the not-a-prototype clause,
 * respecting composite semantics:
 *   - leaf: its sparqlAsk matches the canonical clause;
 *   - AllPrecondition (AND): at least ONE child enforces it (an AND-conjunct
 *     carrying the clause hides the command on prototypes);
 *   - AnyPrecondition (OR): ALL children enforce it (a single clause-less
 *     OR-branch would let the command render on a prototype);
 *   - NotPrecondition (¬child): enforces iff `child` is the positive "is a
 *     prototype" check (`NotPrecondition(IsPrototype)` is the composable
 *     not-a-prototype form, 5b49ef19 → 011eb4d6, RFC df602adc Phase 6).
 */
function enforcesNotPrototype(
  uid: string,
  resolve: (u: string) => Asset | undefined,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (seen.has(uid)) return false; // cycle-guard
  const pre = resolve(uid);
  if (!pre) return false;
  const ask = sparqlAskOf(pre);
  if (ask && askEnforcesNotPrototypeFlat(ask)) return true;
  const seen2 = new Set(seen).add(uid);
  // NotPrecondition(child): ¬child enforces not-a-prototype iff child is TRUE on
  // all prototypes — i.e. child is the positive "is a prototype" check.
  const notChildUid = firstWikilinkUid(pre.fm[NOT_PRECONDITION_FIELD]);
  if (notChildUid) {
    const wrapped = resolve(notChildUid);
    const wAsk = wrapped ? sparqlAskOf(wrapped) : null;
    if (wAsk && askIsPositivePrototypeCheck(wAsk)) return true;
  }
  const andKids = compositeChildren(pre, ALL_PRECONDITION_FIELD);
  if (
    andKids.length > 0 &&
    andKids.some((k) => enforcesNotPrototype(k, resolve, seen2))
  ) {
    return true;
  }
  const orKids = compositeChildren(pre, ANY_PRECONDITION_FIELD);
  if (
    orKids.length > 0 &&
    orKids.every((k) => enforcesNotPrototype(k, resolve, seen2))
  ) {
    return true;
  }
  return false;
}

describe("prototype precondition — forget-leak guard (exoas-exocmd submodule) (@req:5579ffa1-a829-4fcf-b93d-4fb664b02d62)", () => {
  const assets = loadAssets();
  const byUid = new Map(assets.map((a) => [a.uid, a]));

  // command uid -> set of binding targetClass labels
  const commandTargets = new Map<string, Set<string>>();
  for (const a of assets) {
    if (!instanceClassUids(a.fm).includes(COMMAND_BINDING_CLASS_UID)) continue;
    const tc = a.fm["exocmd__CommandBinding_targetClass"];
    const cmdUid = wikilinkUid(a.fm["exocmd__CommandBinding_command"] as string | undefined);
    if (typeof tc !== "string" || !cmdUid) continue;
    if (!commandTargets.has(cmdUid)) commandTargets.set(cmdUid, new Set());
    commandTargets.get(cmdUid)!.add(tc);
  }

  const resolve = (u: string): Asset | undefined => byUid.get(u);

  /**
   * True iff the command's precondition tree enforces the not-a-prototype clause
   * (flat sparqlAsk OR nested in an AllPrecondition/AnyPrecondition composite).
   */
  function commandEnforcesNotPrototype(cmdUid: string): boolean {
    const cmd = byUid.get(cmdUid);
    if (!cmd) return false;
    const preUid = firstWikilinkUid(cmd.fm["exocmd__Command_precondition"]);
    if (!preUid) return false;
    return enforcesNotPrototype(preUid, resolve);
  }

  const lifecycleCommands = [...commandTargets.entries()].filter(
    ([, tcs]) =>
      [...tcs].some((t) => LIFECYCLE_TARGET_CLASSES.has(t)) &&
      ![...tcs].some((t) => UNIVERSAL_TARGET_CLASSES.has(t)),
  );

  it("finds the instance-lifecycle command set (non-trivial)", () => {
    expect(lifecycleCommands.length).toBeGreaterThanOrEqual(20);
  });

  it.each(
    // present a readable [uid, label] tuple per lifecycle command
    [...commandTargets.keys()]
      .filter((u) =>
        commandTargets.get(u)!.size > 0 &&
        [...commandTargets.get(u)!].some((t) => LIFECYCLE_TARGET_CLASSES.has(t)) &&
        ![...commandTargets.get(u)!].some((t) => UNIVERSAL_TARGET_CLASSES.has(t)),
      )
      .map((u) => [u, byUid.get(u)?.label ?? "?"] as [string, string]),
  )(
    "lifecycle command %s (%s) enforces the not-a-prototype clause (flat or nested in a composite)",
    (cmdUid) => {
      expect(commandEnforcesNotPrototype(cmdUid)).toBe(true);
    },
  );

  it("the standalone 'Target is not a prototype' precondition exists and carries the clause", () => {
    const pre = byUid.get(STANDALONE_PRECONDITION_UID);
    expect(pre).toBeTruthy();
    expect(pre!.raw).toMatch(NOT_A_PROTOTYPE_CLAUSE_RE);
  });

  it("universal-maintenance commands (targetClass exo__Asset) do NOT enforce the clause", () => {
    const universal = [...commandTargets.entries()].filter(
      ([, tcs]) => [...tcs].every((t) => UNIVERSAL_TARGET_CLASSES.has(t)),
    );
    expect(universal.length).toBeGreaterThanOrEqual(1);
    for (const [cmdUid] of universal) {
      expect(commandEnforcesNotPrototype(cmdUid)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Detection-power unit tests for `enforcesNotPrototype` (synthetic map — no
// submodule). These are the revert-verify: they prove the composite-aware
// predicate returns FALSE when the clause is absent (a genuine forget-leak is
// still caught) and TRUE only when the clause is actually enforced, across
// leaf / AND / OR shapes. Without them, "traverse composites" could degrade into
// "clause appears anywhere" and silently lose the OR-branch detection.
// ---------------------------------------------------------------------------
describe("enforcesNotPrototype — AND/OR composite detection semantics", () => {
  const CLAUSE =
    'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { FILTER NOT EXISTS { $target exo:Instance_class ?p . FILTER(STRENDS(STR(?p), "Prototype")) } }';
  const PLAIN =
    "PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { $target exo:Instance_class ?c . FILTER(?c != <x>) }";

  const leaf = (uid: string, ask: string): Asset => ({
    uid,
    label: uid,
    file: "",
    fm: { exocmd__Precondition_sparqlAsk: ask },
    raw: "",
  });
  const composite = (uid: string, field: string, kids: string[]): Asset => ({
    uid,
    label: uid,
    file: "",
    fm: { [field]: kids.map((k) => `[[${k}]]`) },
    raw: "",
  });
  const resolveOf =
    (assets: Asset[]) =>
    (u: string): Asset | undefined =>
      assets.find((a) => a.uid === u);

  const A = "aaaaaaaa-0000-4000-8000-000000000001";
  const B = "aaaaaaaa-0000-4000-8000-000000000002";
  const ROOT = "aaaaaaaa-0000-4000-8000-0000000000ff";

  it("leaf WITH clause → enforced", () => {
    expect(enforcesNotPrototype(A, resolveOf([leaf(A, CLAUSE)]))).toBe(true);
  });

  it("leaf WITHOUT clause → NOT enforced (leak detected)", () => {
    expect(enforcesNotPrototype(A, resolveOf([leaf(A, PLAIN)]))).toBe(false);
  });

  it("AllPrecondition (AND): one clause-bearing conjunct → enforced", () => {
    const assets = [
      composite(ROOT, ALL_PRECONDITION_FIELD, [A, B]),
      leaf(A, PLAIN),
      leaf(B, CLAUSE),
    ];
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(true);
  });

  it("AllPrecondition (AND): NO conjunct has the clause → NOT enforced (forget-leak detected)", () => {
    const assets = [
      composite(ROOT, ALL_PRECONDITION_FIELD, [A, B]),
      leaf(A, PLAIN),
      leaf(B, PLAIN),
    ];
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(false);
  });

  it("AnyPrecondition (OR): only one branch has the clause → NOT enforced (weakening detected)", () => {
    const assets = [
      composite(ROOT, ANY_PRECONDITION_FIELD, [A, B]),
      leaf(A, CLAUSE),
      leaf(B, PLAIN),
    ];
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(false);
  });

  it("AnyPrecondition (OR): every branch has the clause → enforced", () => {
    const assets = [
      composite(ROOT, ANY_PRECONDITION_FIELD, [A, B]),
      leaf(A, CLAUSE),
      leaf(B, CLAUSE),
    ];
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(true);
  });

  it("nested AND-under-OR mirroring the real Convert-to-Project shape → enforced", () => {
    // OR[ AND[leaf-with-clause, plain], plain ] — enforced iff every OR-branch enforces.
    const AND = "aaaaaaaa-0000-4000-8000-0000000000a0";
    const assets = [
      composite(ROOT, ALL_PRECONDITION_FIELD, [AND]),
      composite(AND, ALL_PRECONDITION_FIELD, [A, B]),
      leaf(A, CLAUSE),
      leaf(B, PLAIN),
    ];
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(true);
  });

  it("missing (dangling) child precondition → NOT enforced", () => {
    const assets = [composite(ROOT, ALL_PRECONDITION_FIELD, [A])]; // A not resolvable
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(false);
  });

  // NotPrecondition(IsPrototype) — the composable not-a-prototype form (5b49ef19 → 011eb4d6).
  const IS_PROTO =
    'ASK { $target <https://exocortex.my/ontology/exo#Instance_class> ?p . FILTER(STRENDS(STR(?p), "Prototype")) }';
  const notWrap = (uid: string, child: string): Asset => ({
    uid,
    label: uid,
    file: "",
    fm: { [NOT_PRECONDITION_FIELD]: `[[${child}]]` },
    raw: "",
  });

  it("NotPrecondition(IsPrototype positive check) → enforced", () => {
    const assets = [notWrap(ROOT, A), leaf(A, IS_PROTO)];
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(true);
  });

  it("NotPrecondition(non-prototype leaf) → NOT enforced (¬X of a non-proto check does not guarantee not-a-prototype)", () => {
    const assets = [notWrap(ROOT, A), leaf(A, PLAIN)];
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(false);
  });

  it("AllPrecondition[…, NotPrecondition(IsPrototype), …] mirroring Vote-on-Effort → enforced", () => {
    const NOT = "aaaaaaaa-0000-4000-8000-0000000000b0";
    const assets = [
      composite(ROOT, ALL_PRECONDITION_FIELD, [A, NOT, B]),
      leaf(A, PLAIN), // Visible-until-terminal
      notWrap(NOT, "aaaaaaaa-0000-4000-8000-0000000000b1"),
      leaf("aaaaaaaa-0000-4000-8000-0000000000b1", IS_PROTO),
      leaf(B, PLAIN), // Not-archived
    ];
    expect(enforcesNotPrototype(ROOT, resolveOf(assets))).toBe(true);
  });

  // Hardening (LOW#1): a clause defeated by a sibling UNION branch a prototype
  // could satisfy must NOT read as enforcing.
  const CLAUSE_UNION =
    'ASK { { FILTER NOT EXISTS { $target exo:Instance_class ?p . FILTER(STRENDS(STR(?p), "Prototype")) } } UNION { $target exo:Instance_class ?anything } }';
  const IS_PROTO_UNION =
    'ASK { { $target exo:Instance_class ?p . FILTER(STRENDS(STR(?p), "Prototype")) } UNION { $target exo:Instance_class ?q } }';

  it("flat clause defeated by a sibling UNION → NOT enforced", () => {
    expect(enforcesNotPrototype(A, resolveOf([leaf(A, CLAUSE_UNION)]))).toBe(
      false,
    );
  });

  it("NotPrecondition(IsPrototype-with-UNION) → NOT enforced (¬child not guaranteed on prototypes)", () => {
    const NOT = "aaaaaaaa-0000-4000-8000-0000000000c0";
    const assets = [
      notWrap(NOT, A),
      leaf(A, IS_PROTO_UNION),
    ];
    expect(enforcesNotPrototype(NOT, resolveOf(assets))).toBe(false);
  });
});

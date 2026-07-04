/**
 * Phase 4 (onto-RFC df602adc — Composable homoiconic preconditions, способ A):
 * PRODUCTION-SHAPE coverage for the composite-precondition ENGINE — the full
 * `CommandResolver.loadCommand` recursive LOADER *and* the
 * `PreconditionEvaluator.evaluate` recursive EVALUATOR, driven from a real
 * `InMemoryTripleStore` (seed markdown-shaped triples → loadCommand → evaluate),
 * NOT a hand-injected `PreconditionDefinition` tree.
 *
 * Why production-shape (test-fixture-realism): a hand-injected composite tree
 * would exercise only the evaluator and MASK the 4.2 loader — the property-
 * presence combinator detection (`AllPrecondition_preconditions` /
 * `AnyPrecondition_preconditions` / `NotPrecondition_precondition`), the
 * ALL-refs iteration (not `[0]`), the recursive wikilink resolution, the
 * extended guard (composites don't have sparqlAsk/query/hostFunction and would
 * be silently dropped by the old `return null` guard), the visited-set cycle
 * guard, and the broken-child sentinel. These tests load the tree FROM the store
 * so a loader regression is caught.
 *
 * Revert-verify ([[integration-test-revert-verify]]) — run out-of-band and
 * documented in the PR:
 *   - remove `if (precondition.broken) return false` in evaluateNode → the
 *     broken-child + cycle cases go RED (broken falls through to `return true`);
 *   - remove the loader combinator detection (revert to atomic-only) → every
 *     composite case that expects a specific boolean goes RED (composites load
 *     as null → evaluate → true);
 *   - top-level `return null` fail-open boundary → broken node → the
 *     top-level-unresolvable case goes RED (true → false);
 *   - drop the render memo → the reuse "executed once" assertion goes RED (2).
 *
 * @req:4370db77-3df2-48d3-bf20-f439d49fc12e
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { PreconditionDefinition } from "../../../src/domain/models/CommandDefinition";

// create_instance grounding type UID (same as CommandResolver.waitingCheckLoader
// production-shape test — a minimal valid grounding so loadCommand returns).
const CREATE_INSTANCE_TYPE_UID = "4367e2d6-6c92-450a-becb-abce1fb07682";

const COMMAND_UID = "0c0mmand-0000-0000-0000-000000000001";
const GROUNDING_UID = "09r0und-0000-0000-0000-000000000001";
const TARGET_UID = "07a89e70-0000-0000-0000-000000000001";
const TARGET_IRI = `obsidian://vault/${TARGET_UID}.md`;

function iri(uid: string): IRI {
  return new IRI(`obsidian://vault/${uid}.md`);
}

/** An ASK that is TRUE iff the target carries `ems:<predLocal>`. */
function askFor(predLocal: string): string {
  return `PREFIX ems: <https://exocortex.my/ontology/ems#>
    ASK { $target ems:${predLocal} ?x }`;
}

async function addLabelled(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<void> {
  await store.addAll([
    new Triple(iri(uid), Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(iri(uid), Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
}

/** Atomic precondition asset carrying a `Precondition_sparqlAsk`. */
async function addAtomic(
  store: InMemoryTripleStore,
  uid: string,
  sparqlAsk: string,
): Promise<void> {
  await addLabelled(store, uid, `atomic:${uid}`);
  await store.add(
    new Triple(
      iri(uid),
      Namespace.EXOCMD.term("Precondition_sparqlAsk"),
      new Literal(sparqlAsk),
    ),
  );
}

/** All/Any combinator asset — children as `"[[<uid>]]"` wikilink literals. */
async function addComposite(
  store: InMemoryTripleStore,
  uid: string,
  op: "all" | "any",
  childUids: string[],
): Promise<void> {
  await addLabelled(store, uid, `${op}:${uid}`);
  const predicate =
    op === "all"
      ? Namespace.EXOCMD.term("AllPrecondition_preconditions")
      : Namespace.EXOCMD.term("AnyPrecondition_preconditions");
  for (const c of childUids) {
    await store.add(new Triple(iri(uid), predicate, new Literal(`[[${c}]]`)));
  }
}

/** Not combinator asset — single `NotPrecondition_precondition` child. */
async function addNot(
  store: InMemoryTripleStore,
  uid: string,
  childRef: string,
): Promise<void> {
  await addLabelled(store, uid, `not:${uid}`);
  await store.add(
    new Triple(
      iri(uid),
      Namespace.EXOCMD.term("NotPrecondition_precondition"),
      new Literal(`[[${childRef}]]`),
    ),
  );
}

/**
 * Command referencing `precondRef` via `Command_precondition`
 * (wikilink-literal form) + a minimal create_instance grounding so
 * `loadCommand` returns non-null. `precondRef === null` → no precondition.
 */
async function addCommand(
  store: InMemoryTripleStore,
  precondRef: string | null,
): Promise<void> {
  await addLabelled(store, COMMAND_UID, "Test command");
  await store.add(
    new Triple(
      iri(COMMAND_UID),
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    ),
  );
  if (precondRef !== null) {
    await store.add(
      new Triple(
        iri(COMMAND_UID),
        Namespace.EXOCMD.term("Command_precondition"),
        new Literal(`[[${precondRef}]]`),
      ),
    );
  }
  await store.add(
    new Triple(
      iri(COMMAND_UID),
      Namespace.EXOCMD.term("Command_grounding"),
      iri(GROUNDING_UID),
    ),
  );
  await store.addAll([
    new Triple(
      iri(GROUNDING_UID),
      Namespace.EXO.term("Asset_uid"),
      new Literal(GROUNDING_UID),
    ),
    new Triple(
      iri(GROUNDING_UID),
      Namespace.EXO.term("Asset_label"),
      new Literal("g"),
    ),
    new Triple(
      iri(GROUNDING_UID),
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal(`[[${CREATE_INSTANCE_TYPE_UID}]]`),
    ),
    new Triple(
      iri(GROUNDING_UID),
      Namespace.EXOCMD.term("Grounding_targetClass"),
      new Literal("ems__Task"),
    ),
  ]);
}

describe("CommandResolver + PreconditionEvaluator — composite preconditions (onto-RFC df602adc, Phase 4)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;
  let evaluator: PreconditionEvaluator;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
    evaluator = new PreconditionEvaluator(store);
    // Target markers so `askFor("Effort_status")` is TRUE and
    // `askFor("Effort_startTimestamp")` is FALSE (marker absent).
    await store.addAll([
      new Triple(
        iri(TARGET_UID),
        Namespace.EXO.term("Asset_uid"),
        new Literal(TARGET_UID),
      ),
      new Triple(
        iri(TARGET_UID),
        Namespace.EMS.term("Effort_status"),
        new Literal("Doing"),
      ),
      new Triple(
        iri(TARGET_UID),
        Namespace.EMS.term("Effort_area"),
        new Literal("A"),
      ),
      new Triple(
        iri(TARGET_UID),
        Namespace.EMS.term("Effort_parent"),
        new Literal("P"),
      ),
    ]);
  });

  /** loadCommand → evaluate against TARGET_IRI (the full production path). */
  async function loadAndEvaluate(): Promise<boolean> {
    const cmd = await resolver.loadCommand(COMMAND_UID);
    expect(cmd).not.toBeNull();
    return evaluator.evaluate(cmd!.precondition, TARGET_IRI);
  }

  async function loadPrecondition(): Promise<
    PreconditionDefinition | undefined
  > {
    const cmd = await resolver.loadCommand(COMMAND_UID);
    expect(cmd).not.toBeNull();
    return cmd!.precondition;
  }

  // ---- AND (all) ----
  it("all: every child true → available (true)", async () => {
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    await addAtomic(store, "t2", askFor("Effort_area")); // true
    await addComposite(store, "cAll", "all", ["t1", "t2"]);
    await addCommand(store, "cAll");

    const def = await loadPrecondition();
    expect(def?.composite?.op).toBe("all");
    expect(def?.composite?.children).toHaveLength(2);
    expect(await loadAndEvaluate()).toBe(true);
  });

  it("all: one child false → hidden (false)", async () => {
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    await addAtomic(store, "f1", askFor("Effort_startTimestamp")); // false
    await addComposite(store, "cAll", "all", ["t1", "f1"]);
    await addCommand(store, "cAll");

    expect(await loadAndEvaluate()).toBe(false);
  });

  // ---- OR (any) ----
  it("any: one child true (rest false) → available (true)", async () => {
    await addAtomic(store, "f1", askFor("Effort_startTimestamp")); // false
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    await addComposite(store, "cAny", "any", ["f1", "t1"]);
    await addCommand(store, "cAny");

    const def = await loadPrecondition();
    expect(def?.composite?.op).toBe("any");
    expect(await loadAndEvaluate()).toBe(true);
  });

  it("any: all children false → hidden (false)", async () => {
    await addAtomic(store, "f1", askFor("Effort_startTimestamp")); // false
    await addAtomic(store, "f2", askFor("Effort_endTimestamp")); // false
    await addComposite(store, "cAny", "any", ["f1", "f2"]);
    await addCommand(store, "cAny");

    expect(await loadAndEvaluate()).toBe(false);
  });

  // ---- NOT ----
  it("not(false child) → available (true)", async () => {
    await addAtomic(store, "f1", askFor("Effort_startTimestamp")); // false
    await addNot(store, "cNot", "f1");
    await addCommand(store, "cNot");

    const def = await loadPrecondition();
    expect(def?.not).toBeDefined();
    expect(await loadAndEvaluate()).toBe(true);
  });

  it("not(true child) → hidden (false)", async () => {
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    await addNot(store, "cNot", "t1");
    await addCommand(store, "cNot");

    expect(await loadAndEvaluate()).toBe(false);
  });

  // ---- Nesting ----
  it("nested: all[ any[false, true], not[false] ] → true", async () => {
    await addAtomic(store, "f1", askFor("Effort_startTimestamp")); // false
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    await addAtomic(store, "f2", askFor("Effort_endTimestamp")); // false
    await addComposite(store, "inner-any", "any", ["f1", "t1"]); // → true
    await addNot(store, "inner-not", "f2"); // → true
    await addComposite(store, "root", "all", ["inner-any", "inner-not"]);
    await addCommand(store, "root");

    const def = await loadPrecondition();
    expect(def?.composite?.op).toBe("all");
    // Structural: the loader built a nested tree, not a flat atomic.
    expect(def?.composite?.children[0].composite?.op).toBe("any");
    expect(def?.composite?.children[1].not).toBeDefined();
    expect(await loadAndEvaluate()).toBe(true);
  });

  it("nested: all[ any[false, true], not[true] ] → false", async () => {
    await addAtomic(store, "f1", askFor("Effort_startTimestamp")); // false
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    await addComposite(store, "inner-any", "any", ["f1", "t1"]); // → true
    await addNot(store, "inner-not", "t1"); // not(true) → false
    await addComposite(store, "root", "all", ["inner-any", "inner-not"]);
    await addCommand(store, "root");

    expect(await loadAndEvaluate()).toBe(false); // all(true, false) → false
  });

  // ---- Reuse (CQ3) + render-memo (SPARQL-M) ----
  it("reuse: a leaf referenced in two sub-branches evaluates its ASK ONCE (render memo) and stays correct", async () => {
    // shared "true" leaf reused by both the `all` root AND the nested `not`.
    const sharedAsk = askFor("Effort_status"); // true
    await addAtomic(store, "shared", sharedAsk);
    await addAtomic(store, "t2", askFor("Effort_area")); // true
    await addNot(store, "not-shared", "shared"); // not(true) → false
    // all[ shared(true), t2(true), not[shared](false) ] → false, but `shared`
    // appears TWICE (direct child + inside the not).
    await addComposite(store, "root", "all", ["shared", "t2", "not-shared"]);
    await addCommand(store, "root");

    const spy = jest.spyOn(
      evaluator as unknown as {
        evaluateSparqlAsk: (a: string, b: string) => Promise<boolean>;
      },
      "evaluateSparqlAsk",
    );

    // all(true, true, not(true)=false) → false
    expect(await loadAndEvaluate()).toBe(false);

    // The shared leaf's ASK ran exactly once despite two occurrences (memo).
    const sharedCalls = spy.mock.calls.filter((c) => c[0] === sharedAsk);
    expect(sharedCalls).toHaveLength(1);
    spy.mockRestore();
  });

  // ---- Cycle → false (fail-closed, no hang) ----
  it("cycle A→all[B], B→all[A] → hidden (false), loader terminates with a broken node", async () => {
    await addComposite(store, "A", "all", ["B"]);
    await addComposite(store, "B", "all", ["A"]);
    await addCommand(store, "A");

    const def = await loadPrecondition();
    // The recursion terminated (no hang) with a broken sentinel deep inside.
    const bBranch = def?.composite?.children[0]; // B
    const aAgain = bBranch?.composite?.children[0]; // A revisited → broken
    expect(aAgain?.broken).toBe(true);
    expect(await loadAndEvaluate()).toBe(false);
  });

  // ---- Broken child → false (Impl-HIGH regress-lock) ----
  it("broken child (unresolvable wikilink) → hidden (false); loader marks it broken @req:4370db77-3df2-48d3-bf20-f439d49fc12e", async () => {
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    // "ghost" is NOT added to the store → unresolvable wikilink → broken node.
    await addComposite(store, "cAll", "all", ["t1", "ghost-uid-not-in-store"]);
    await addCommand(store, "cAll");

    const def = await loadPrecondition();
    expect(def?.composite?.children).toHaveLength(2); // child NOT dropped
    expect(def?.composite?.children[1].broken).toBe(true); // marked broken
    // all(true, broken) → false (fail-closed).
    expect(await loadAndEvaluate()).toBe(false);
  });

  it("malformed atomic child (no sparqlAsk/query/hostFunction) → broken → all hidden (false)", async () => {
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    await addLabelled(store, "malformed", "no eval source"); // atomic w/o source
    await addComposite(store, "cAll", "all", ["t1", "malformed"]);
    await addCommand(store, "cAll");

    const def = await loadPrecondition();
    expect(def?.composite?.children[1].broken).toBe(true);
    expect(await loadAndEvaluate()).toBe(false);
  });

  // ---- Fail-open boundary (top-level) ----
  it("no precondition at all → available (true, fail-open)", async () => {
    await addCommand(store, null);
    const def = await loadPrecondition();
    expect(def).toBeUndefined();
    expect(await loadAndEvaluate()).toBe(true);
  });

  it("top-level precondition ref UNRESOLVABLE → null → available (true, fail-open — NOT fail-closed like a child)", async () => {
    await addCommand(store, "ghost-top-level-not-in-store");
    const def = await loadPrecondition();
    // Top-level unresolvable is fail-OPEN (null → command shown), unlike a
    // broken CHILD which is fail-closed.
    expect(def).toBeUndefined();
    expect(await loadAndEvaluate()).toBe(true);
  });

  it("top-level malformed atomic (no eval source) → null → available (true, backward-compat fail-open)", async () => {
    await addLabelled(store, "malformed-top", "no eval source");
    await addCommand(store, "malformed-top");
    const def = await loadPrecondition();
    expect(def).toBeUndefined();
    expect(await loadAndEvaluate()).toBe(true);
  });

  // ---- Atomic still works through the recursive loader (backward-compat) ----
  it("plain atomic precondition still loads + evaluates (true when ASK matches)", async () => {
    await addAtomic(store, "t1", askFor("Effort_status")); // true
    await addCommand(store, "t1");
    const def = await loadPrecondition();
    expect(def?.sparqlAsk).toContain("Effort_status");
    expect(def?.composite).toBeUndefined();
    expect(def?.not).toBeUndefined();
    expect(await loadAndEvaluate()).toBe(true);
  });
});

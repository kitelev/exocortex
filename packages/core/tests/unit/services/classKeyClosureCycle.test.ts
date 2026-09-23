import {
  createTripleStoreClassPropertyResolver,
  createTripleStoreRequiredPropertyResolver,
} from "../../../src/services/RequiredPropertyResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { Triple } from "../../../src/domain/models/rdf/Triple";

/**
 * Ticket abd22b00 — the `exo__Class_superClass` walk is CYCLE-SAFE, measured.
 *
 * Both resolvers walk the ancestor chain with `classUids` doubling as the
 * visited set. Until this change that walk existed TWICE (inline in the required
 * resolver, copied verbatim into `resolveClassKeyClosure` for the declared one),
 * and the review of PR #4325 flagged the consequence as a LOW: neither copy had
 * a mutant on the guard, so "cycle-safe" was held by READING the code in two
 * places rather than by a measurement in either. Converging the copies is the
 * natural moment to write that measurement once instead of twice.
 *
 * ⚠ A cycle is not hypothetical data hygiene: `exo__Class_superClass` is
 * author-written vault frontmatter, so `A → B → A` is one typo away, and the
 * failure mode without the guard is a HANG, not a wrong answer.
 *
 * Tagged `@req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978` together with the minCount
 * axes: both are the same converged reader/walk pair and the same Step-0
 * conformance verdict (no new requirement is minted for a convergence).
 *
 * ⛔ The per-test timeouts below do NOT make a missing guard read as RED, and
 * saying otherwise would be a comment that measurement disproves: without the
 * visited set the walk spins in MICROTASKS, so jest's timer never gets a turn and
 * the run simply never comes back (probed 2026-09-22 — it had to be killed from
 * outside). What turns the hang into a verdict is the mutant harness, which runs
 * every jest invocation under `timeout` and prints these two axis names on
 * rc=124 (integration-test-revert-verify §A70). In CI a `visited` regression
 * would therefore surface as a HUNG job, not as a red axis — worth knowing before
 * anyone reads a stuck shard as an infrastructure flake.
 */

const EXO = Namespace.EXO;
const RDFS = Namespace.RDFS;

const CLASS_A = "aaaaaaaa-1111-4222-8333-444444444444";
const CLASS_B = "bbbbbbbb-1111-4222-8333-444444444444";
const PROP = "cccccccc-1111-4222-8333-444444444444";

const fileIRI = (uid: string): string => `obsidian://vault/assetspaces/x/${uid}.md`;

/** `A → B → A`: a superClass cycle, plus one required property declared on B. */
async function cyclicStore(): Promise<InMemoryTripleStore> {
  const store = new InMemoryTripleStore();
  const a = new IRI(fileIRI(CLASS_A));
  const b = new IRI(fileIRI(CLASS_B));
  const prop = new IRI(fileIRI(PROP));
  await store.addAll([
    new Triple(a, EXO.term("Asset_uid"), new Literal(CLASS_A)),
    new Triple(b, EXO.term("Asset_uid"), new Literal(CLASS_B)),
    new Triple(a, RDFS.term("label"), new Literal("flow__ClassA")),
    new Triple(b, RDFS.term("label"), new Literal("flow__ClassB")),
    new Triple(a, EXO.term("Class_superClass"), b),
    new Triple(b, EXO.term("Class_superClass"), a),
    new Triple(prop, EXO.term("Asset_label"), new Literal("flow__Cycle_prop")),
    new Triple(prop, EXO.term("Property_domain"), b),
    new Triple(prop, EXO.term("Property_minCount"), new Literal("1")),
    new Triple(prop, EXO.term("Property_range"), new Literal("xsd:integer")),
  ]);
  return store;
}

describe("exo__Class_superClass walk is cycle-safe (ticket abd22b00)", () => {
  it(
    "C8 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 the REQUIRED-property resolver terminates on a superClass cycle A → B → A and still reaches the property declared on the ancestor — the visited set is what bounds the walk, and this is its first measurement",
    async () => {
      const store = await cyclicStore();
      const fields = await createTripleStoreRequiredPropertyResolver(store)(CLASS_A);
      expect(fields.map((f) => f.propertyKey)).toEqual(["flow__Cycle_prop"]);
    },
    5000,
  );

  it(
    "C9 @req:bcdd64d8-abc1-48f4-af50-42c8aa3f1978 the DECLARED-property resolver terminates on the SAME cycle through the SAME walk — one guard now, so one axis covers both consumers instead of neither covering either",
    async () => {
      const store = await cyclicStore();
      const fields = await createTripleStoreClassPropertyResolver(store)(CLASS_A);
      expect(fields.map((f) => f.propertyKey)).toEqual(["flow__Cycle_prop"]);
    },
    5000,
  );
});

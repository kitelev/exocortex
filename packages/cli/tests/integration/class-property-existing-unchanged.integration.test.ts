import {
  InMemoryTripleStore,
  createTripleStoreRequiredPropertyResolver,
  type RequiredPropertyField,
  type Triple,
} from "@kitelev/exocortex-core";
import { loadVaultTriples } from "../../src/cache/loadVaultTriples.js";
import {
  withClassPropertyVault,
  CLS_BASE,
  CLS_LEAF,
  CLS_LONE,
  CLS_MID,
  CLS_OTHER,
  CLS_PLAIN,
} from "./helpers/class-property-fixture.js";

/**
 * Req `07509cf9`, scenario 8 — "the existing required-property resolver does NOT
 * change". This is the one scenario that cannot be an ordinary axis: an axis
 * comparing the new resolver to itself is a tautology, green under any
 * implementation. What it CAN be is a pin on the OLD resolver's output
 * COMPOSITION over the same graph, checked across TWO REVISIONS of
 * `packages/core/src/services/RequiredPropertyResolver.ts`
 * (`integration-test-revert-verify` §A42 / §A56 — judge a flip by composition,
 * not by a return code).
 *
 * Why this file is SEPARATE from `class-property-live-loader.integration.test.ts`:
 * it imports only exports that exist in BOTH revisions, so it compiles and runs
 * under `origin/main`'s version of that file too. The sibling file does not —
 * `createTripleStoreClassPropertyResolver` does not exist there — and that
 * asymmetry is the flip's canary: it proves the two revisions genuinely differ,
 * so a green D8 on both sides is a measurement rather than a vacuous pass
 * (`self-satisfying-metric-weak-verifier` §A27).
 *
 * The flip is recorded in the PR body:
 *   revision A = `git show origin/main:…/RequiredPropertyResolver.ts` → D8 GREEN,
 *                the sibling file fails to compile (export missing)
 *   revision B = this branch                                          → D8 GREEN,
 *                the sibling file GREEN
 * Same composition on both ⇒ the existing resolver's behaviour is unchanged.
 * The diff says the same thing structurally (265 insertions, 0 deletions), but a
 * structural claim and a behavioural one are different claims.
 *
 * Mutant M9 (in the driver) reddens THIS axis alone by re-anchoring the OLD
 * resolver on `exo__Property_domain`; without it the pin below would be
 * indistinguishable from a tautology.
 */

const REQ = "@req:07509cf9-6a4e-45ef-a420-03f5fb9baef9";

function printable(fields: readonly RequiredPropertyField[]): string[] {
  return fields.map(
    (f) => `${f.propertyKey}|${f.fieldType}|${f.targetClassUid ?? "-"}`,
  );
}

describe("the existing required-property resolver over the same graph (req 07509cf9, scenario 8)", () => {
  it(`D8 ${REQ} its output composition on every host of the fixture is what it was before this change — pinned per host, so a shift in ANY of them reddens here and nowhere else`, async () => {
    await withClassPropertyVault(async (dir) => {
      const loaded = await loadVaultTriples(dir, { useCache: false });
      const store = new InMemoryTripleStore();
      await store.addAll(loaded.triples as Triple[]);
      const resolve = createTripleStoreRequiredPropertyResolver(store);

      const composition: string[] = [];
      for (const [name, uid] of [
        ["Base", CLS_BASE],
        ["Mid", CLS_MID],
        ["Leaf", CLS_LEAF],
        ["Lone", CLS_LONE],
        ["Other", CLS_OTHER],
        ["Plain", CLS_PLAIN],
      ] as ReadonlyArray<readonly [string, string]>) {
        composition.push(`${name} => [${printable(await resolve(uid)).join(", ")}]`);
      }

      expect(composition).toEqual([
        "Base => [tst__Base_required|text|-]",
        "Mid => [tst__Base_required|text|-]",
        "Leaf => [tst__Base_required|text|-]",
        "Lone => []",
        "Other => [tst__Other_noise|text|-]",
        "Plain => []",
      ]);
    });
  }, 120000);
});

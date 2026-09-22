import * as fs from "fs";
import * as path from "path";
import {
  InMemoryTripleStore,
  createTripleStoreClassPropertyResolver,
  type ClassPropertyField,
  type Triple,
} from "@kitelev/exocortex-core";
import { loadVaultTriples } from "../../src/cache/loadVaultTriples.js";

/**
 * Ticket 2bfefcaa — a FIXTURE guard, not a product axis.
 *
 * The product axis for req `9e19f141` lives in
 * `packages/obsidian-plugin/tests/e2e/specs/vault-commands-smoke.spec.ts`: it
 * drives the real `exocortex:edit-properties` command in a real Obsidian and
 * reads the modal's DOM. That axis can only run in Docker, so a seed that stops
 * resolving (a file deleted, a label typo, a range form the converter emits
 * differently) would surface a whole CI cycle later — and would look like an
 * e2e flake rather than a broken fixture.
 *
 * This test closes that gap locally: it runs the PRODUCTION loader
 * (`loadVaultTriples`, the same call `validate-schema` makes) over the real e2e
 * test-vault and asserts the composition the declared-property resolver answers
 * for `ems__Task`. It is deliberately about the SEED, not about the editor —
 * the editor's mapping of these fields onto form widgets is the e2e spec's job.
 *
 * ⛤ The seed's domains are flattened onto `ems__Task` (the live TBox spreads
 * them across Task → Effort → Asset): the e2e vault carries no class assets for
 * that chain, and seeding one would widen the blast radius for every spec
 * sharing that vault. `classKeyOf` keys on the class LABEL, so a
 * `[[ems__Task]]` domain resolves without the class asset existing.
 */

const REQ = "@req:9e19f141-13f5-451c-abb8-34e24ff0e9d3";

/** Walk up from the working directory until the monorepo root is recognised. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "packages", "obsidian-plugin"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fail loud: a skip here would be a vacuous green (the guard would stop
  // guarding the moment the layout moved, and nothing would say so).
  throw new Error(
    `monorepo root not found walking up from ${process.cwd()} — ` +
      "this guard resolves the e2e test-vault relative to it",
  );
}

const E2E_VAULT = path.join(
  repoRoot(),
  "packages/obsidian-plugin/tests/e2e/test-vault",
);

/** `key|fieldType|targetClassUid|required` — one printable line per field. */
function printable(fields: readonly ClassPropertyField[]): string[] {
  return fields.map(
    (f) =>
      `${f.propertyKey}|${f.fieldType}|${f.targetClassUid ?? "-"}|${
        f.required ? "required" : "optional"
      }`,
  );
}

describe("e2e test-vault TBox seed resolves for ems__Task (ticket 2bfefcaa)", () => {
  it(`S1 ${REQ} the seeded exo__Property definitions resolve for ems__Task with the field types their ranges declare`, async () => {
    const loaded = await loadVaultTriples(E2E_VAULT, { useCache: false });
    const store = new InMemoryTripleStore();
    await store.addAll(loaded.triples as Triple[]);

    const fields = await createTripleStoreClassPropertyResolver(store)(
      "ems__Task",
    );

    // The full composition, not a subset: a seed that grows silently is as much
    // a fixture drift as one that shrinks, and the e2e spec asserts against
    // these same keys.
    expect(printable(fields)).toEqual([
      "ems__Effort_area|assetRef|ems__Area|optional",
      "ems__Effort_plannedStartTimestamp|date|-|optional",
      "ems__Effort_status|assetRef|ems__EffortStatus|optional",
      "ems__Effort_votes|number|-|optional",
      "ems__Task_size|assetRef|ems__TaskSize|optional",
      "exo__Asset_label|text|-|optional",
    ]);
  }, 300000);

  it(`S2 ${REQ} a class outside the seed's domain resolves to an EMPTY list — "every declared property" has not degraded into "every property"`, async () => {
    const loaded = await loadVaultTriples(E2E_VAULT, { useCache: false });
    const store = new InMemoryTripleStore();
    await store.addAll(loaded.triples as Triple[]);
    const resolve = createTripleStoreClassPropertyResolver(store);

    expect(await resolve("ems__Area")).toEqual([]);
    // Canary in the SAME run: the resolver is alive, so the empty answer above
    // is a fact about `ems__Area`, not about a dead query.
    expect((await resolve("ems__Task")).length).toBeGreaterThan(0);
  }, 300000);
});

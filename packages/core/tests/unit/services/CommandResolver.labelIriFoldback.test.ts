/**
 * Issue #4007 — an InheritanceRule wrote the raw IRI as a frontmatter KEY.
 *
 * `exocmd__InheritanceRule_targetProperty` points at the UID of a property
 * DEFINITION, so the executor derives the key name by resolving that UID's
 * `exo__Asset_label`. Every property definition's label parses as
 * `prefix__LocalName` (`ems__Effort_area`), and the converter emits such a
 * label as a term IRI rather than a Literal — so `resolveLabelByUID` handed
 * back `https://exocortex.my/ontology/ems#Effort_area`, which then became the
 * key on disk.
 *
 * ⛤ The damage was not cosmetic. A task created that way carried
 * `…ems#Effort_status: "[[Draft]]"`; three seconds later `apply start-effort`
 * looked for `ems__Effort_status`, did not find it, and appended a SECOND
 * status. The asset held two statuses at once.
 *
 * ⛔ Why no existing test caught it: every fixture in the neighbouring suites
 * adds labels as `new Literal(label)`, which is NOT what the converter
 * produces for a parseable label. Measured on the real converter before
 * writing this: `exo__Asset_label: ems__Effort_area` is emitted as
 * `IRI(https://exocortex.my/ontology/ems#Effort_area)`. These fixtures use the
 * IRI form deliberately — production shape, not the convenient one.
 *
 * Revert-verify: dropping the fold-back in `resolveLabelByUID` turns the two
 * IRI-form axes RED; the Literal-form and the ordinary-label axes stay GREEN
 * in both states.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { ILogger } from "../../../src/interfaces/ILogger";

const silentLogger: ILogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const PROP_UID = "9be36e9d-1111-4111-8111-111111111111";

/** Adds an asset whose `exo__Asset_label` is emitted the way the CONVERTER emits it. */
async function addAsset(
  store: InMemoryTripleStore,
  uid: string,
  label: IRI | Literal,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), label),
  ]);
}

describe("Issue #4007: resolveLabelByUID folds a term-IRI label back to its key form", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store, silentLogger);
  });

  it("folds a term IRI back to prefix__LocalName", async () => {
    // Exactly what the converter emits for `exo__Asset_label: ems__Effort_area`.
    await addAsset(
      store,
      PROP_UID,
      new IRI("https://exocortex.my/ontology/ems#Effort_area"),
    );
    expect(await resolver.resolveLabelByUID(PROP_UID)).toBe("ems__Effort_area");
  });

  it("folds an ad-hoc namespace too, not just the well-known ones", async () => {
    // A hardcoded prefix list is what silently dropped ad-hoc namespaces before
    // (#3274); the shared inverse of the emission path covers them by shape.
    await addAsset(
      store,
      PROP_UID,
      new IRI("https://exocortex.my/ontology/aiKnow#Memory_decay"),
    );
    expect(await resolver.resolveLabelByUID(PROP_UID)).toBe(
      "aiKnow__Memory_decay",
    );
  });

  it("leaves a Literal label untouched", async () => {
    // Canary — green in BOTH states. Non-parseable labels are still Literals.
    await addAsset(store, PROP_UID, new Literal("Some Human Label"));
    expect(await resolver.resolveLabelByUID(PROP_UID)).toBe("Some Human Label");
  });

  it("leaves a plain label that ends in .md untouched", async () => {
    // Canary — green in BOTH states. `iriToObsidianName`'s second shape strips
    // a trailing `.md` off a vault URL; unguarded, it would eat this label.
    await addAsset(store, PROP_UID, new Literal("Notes about foo.md"));
    expect(await resolver.resolveLabelByUID(PROP_UID)).toBe(
      "Notes about foo.md",
    );
  });

  it("returns null for an unknown UID", async () => {
    // Canary — green in BOTH states.
    expect(
      await resolver.resolveLabelByUID("00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });
});

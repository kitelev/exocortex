/**
 * Issue #3274 — `iriToObsidianName` previously had a hardcoded whitelist of
 * 8 known namespaces (EMS, EXO, EXOCMD, IMS, ZTLK, PTMS, LIT, INBOX). Any IRI
 * under `EXOCORTEX_ONTOLOGY_BASE` with a prefix outside that list returned
 * `null`, making `getLinkedValue` fall back to the raw IRI string. Bindings
 * whose `CommandBinding_targetClass` triple was stored as IRI (the production
 * case after #2782 namespace substitution) under an ad-hoc namespace
 * (e.g. `kitelev__`, `aiKnow__`, partial-drift `pmbok__`) then failed to match
 * a label-form query through `matchesReference`.
 *
 * This test exercises the symmetric behaviour: any IRI under
 * `https://exocortex.my/ontology/<prefix>#<local>` should round-trip to
 * `<prefix>__<local>` regardless of whether the prefix was in the legacy
 * whitelist. Mirrors `Namespace.fromPropertyKey` forward path.
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

/**
 * Helper mirroring production binding shape: emits `CommandBinding_targetClass`
 * as an IRI (post-#2782 substitution), NOT as a Literal. Existing
 * `addBindingAsset` helper in CommandResolver.test.ts uses Literal — that path
 * never exercised `iriToObsidianName` at all, which is why this regression
 * shipped undetected.
 */
async function addBindingWithIriTargetClass(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    commandRef: string;
    targetClassIri: string;
  },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);

  await store.addAll([
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("CommandBinding"),
    ),
    new Triple(
      subject,
      Namespace.EXO.term("Asset_uid"),
      new Literal(opts.uid),
    ),
    new Triple(
      subject,
      Namespace.EXO.term("Asset_label"),
      new Literal(`binding-${opts.uid}`),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("CommandBinding_command"),
      new IRI(`obsidian://vault/${opts.commandRef}.md`),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("CommandBinding_targetClass"),
      new IRI(opts.targetClassIri),
    ),
  ]);

  return subject;
}

describe("CommandResolver.findBindings — ad-hoc namespace IRI → label round-trip (#3274)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
  });

  it("resolves known namespace (ems) IRI to label — regression guard", async () => {
    await addBindingWithIriTargetClass(store, {
      uid: "binding-ems-known",
      commandRef: "cmd-known",
      targetClassIri:
        "https://exocortex.my/ontology/ems#SessionPrototype",
    });

    const bindings = await resolver.findBindings("ems__SessionPrototype");

    expect(bindings).toHaveLength(1);
    expect(bindings[0].id).toBe("binding-ems-known");
  });

  it("resolves ad-hoc namespace (kitelev) IRI to label — bug fix", async () => {
    await addBindingWithIriTargetClass(store, {
      uid: "binding-kitelev-adhoc",
      commandRef: "cmd-adhoc",
      targetClassIri:
        "https://exocortex.my/ontology/kitelev#SelfObservationPrototype",
    });

    const bindings = await resolver.findBindings(
      "kitelev__SelfObservationPrototype",
    );

    expect(bindings).toHaveLength(1);
    expect(bindings[0].id).toBe("binding-kitelev-adhoc");
  });

  it("resolves ad-hoc namespace (aiKnow with camelCase prefix) IRI to label", async () => {
    await addBindingWithIriTargetClass(store, {
      uid: "binding-aiKnow-camel",
      commandRef: "cmd-aiKnow",
      targetClassIri:
        "https://exocortex.my/ontology/aiKnow#MemoryFeedback",
    });

    const bindings = await resolver.findBindings("aiKnow__MemoryFeedback");

    expect(bindings).toHaveLength(1);
    expect(bindings[0].id).toBe("binding-aiKnow-camel");
  });

  it("resolves pmbok (in KNOWN_NAMESPACES but absent from legacy whitelist) — partial-drift fix", async () => {
    await addBindingWithIriTargetClass(store, {
      uid: "binding-pmbok-drift",
      commandRef: "cmd-pmbok",
      targetClassIri:
        "https://exocortex.my/ontology/pmbok#RiskStatus",
    });

    const bindings = await resolver.findBindings("pmbok__RiskStatus");

    expect(bindings).toHaveLength(1);
    expect(bindings[0].id).toBe("binding-pmbok-drift");
  });

  it("returns no bindings for non-Exocortex IRI (safety: regex constraint preserved)", async () => {
    // Asserts that the regex-based replacement keeps the fallback null behaviour
    // for IRIs outside `EXOCORTEX_ONTOLOGY_BASE`. The triple still exists, but
    // findBindings won't match a label-form query against an external IRI.
    await addBindingWithIriTargetClass(store, {
      uid: "binding-external-iri",
      commandRef: "cmd-external",
      targetClassIri: "https://example.com/foo#Bar",
    });

    const bindings = await resolver.findBindings("foo__Bar");

    expect(bindings).toHaveLength(0);
  });
});

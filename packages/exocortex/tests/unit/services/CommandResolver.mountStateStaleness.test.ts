/**
 * GUI-smoke D1 — mount-state cache staleness (production-shape regression).
 *
 * Reproduces the root cause of "inline create-buttons on `ems__Project` /
 * `ems__MeetingPrototype` render only after the full mount + reload":
 *
 * A profile apply / mount-state change rebuilds the triple store
 * (`rdfIndexer.refresh()` = clear + convertVault) so it gains the
 * CommandBindings / class definitions that the newly-materialised
 * AssetSpaces bring in. But the `CommandResolver` memoises its resolution
 * per (subjectIRI, classes, prototype). A button resolved BEFORE the
 * relevant binding was in the store caches an EMPTY result; without
 * `invalidateCache()` that empty stays — buttons never appear until a full
 * plugin reload re-fires `metadataCache.on("resolved")`.
 *
 * The D1 fix wires `CommandResolver.invalidateCache()` into the
 * profile-apply refresh hook (`createProfileApplyRefreshHook` →
 * `PluginRdfIndexerAdapter.onAfterRefresh`). This test exercises the
 * resolver-level mechanism that fix depends on, through the real
 * `CommandResolver` + `InMemoryTripleStore` with production-shape triples
 * (the "Create Task → Project" binding from `exoas-exocmd`).
 *
 * Revert-verify: drop the `resolver.invalidateCache()` call in the
 * "recovers" step and the recovery assertion FAILS (stale empty cache
 * persists) — proving the test exercises the regression, not a tautology.
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// Production UIDs from exoas-exocmd (floor) — the real D1 binding/command.
const BIND_UID = "0efec799-2bc4-42e5-a1db-2865f5a88ab5"; // Create Task → Project binding
const CMD_UID = "dec97198-a458-4273-b081-7b250e0a9031"; // Create Task command
const GND_UID = "a222094b-f499-4342-aec0-65c4ba99c657"; // Create task grounding
// 4367e2d6 = GroundingType.CREATE_INSTANCE (Create Task's real grounding type).
const GND_TYPE_REF = "[[4367e2d6-6c92-450a-becb-abce1fb07682]]";

const PROJECT_IRI = "obsidian://vault/my-project.md";
const PROJECT_CLASSES = ["ems__Project", "exo__Asset"];

/**
 * Add the "Create Task → Project" binding + command + grounding triples,
 * representing the moment the exocmd AssetSpace becomes mounted and the
 * store rebuild picks it up.
 */
async function mountCreateTaskBinding(store: InMemoryTripleStore): Promise<void> {
  const gndSub = new IRI(`obsidian://vault/${GND_UID}.md`);
  const cmdSub = new IRI(`obsidian://vault/${CMD_UID}.md`);
  const bindSub = new IRI(`obsidian://vault/${BIND_UID}.md`);

  await store.addAll([
    // Grounding
    new Triple(gndSub, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(gndSub, Namespace.EXO.term("Asset_uid"), new Literal(GND_UID)),
    new Triple(gndSub, Namespace.EXO.term("Asset_label"), new Literal("Create task")),
    new Triple(gndSub, Namespace.EXOCMD.term("Grounding_type"), new Literal(GND_TYPE_REF)),
    new Triple(gndSub, Namespace.EXOCMD.term("Grounding_targetClass"), new Literal("1b20a8f0-d745-4e93-91db-4531b3df120e|ems__Task")),

    // Command (no precondition — "always available")
    new Triple(cmdSub, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmdSub, Namespace.EXO.term("Asset_uid"), new Literal(CMD_UID)),
    new Triple(cmdSub, Namespace.EXO.term("Asset_label"), new Literal("Create Task")),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_icon"), new Literal("plus-circle")),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_category"), new Literal("creation")),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_grounding"), gndSub),

    // Binding → targetClass ems__Project
    new Triple(bindSub, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(bindSub, Namespace.EXO.term("Asset_uid"), new Literal(BIND_UID)),
    new Triple(bindSub, Namespace.EXO.term("Asset_label"), new Literal("Create Task → Project binding")),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_command"), cmdSub),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_targetClass"), new Literal("ems__Project")),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_position"), new Literal("inline")),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_order"), new Literal("231")),
  ]);
}

describe("CommandResolver — mount-state cache staleness (GUI-smoke D1)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
  });

  it("baseline: resolves the Create-Task button once the binding is in the store", async () => {
    await mountCreateTaskBinding(store);
    const commands = await resolver.resolveForAssetMulti(PROJECT_IRI, PROJECT_CLASSES);
    expect(commands).toHaveLength(1);
    expect(commands[0].command.name).toBe("Create Task");
  });

  it("regression: a button resolved before the mount stays STALE after the store rebuild — until invalidateCache()", async () => {
    // 1. Pre-mount: the exocmd binding AssetSpace is not yet materialised.
    //    Resolving the Project's inline commands yields nothing — and the
    //    empty result is cached by the resolver (multiCache).
    const preMount = await resolver.resolveForAssetMulti(PROJECT_IRI, PROJECT_CLASSES);
    expect(preMount).toHaveLength(0);

    // 2. Mount happens: the store rebuild (rdfIndexer.refresh) now contains
    //    the Create Task → Project binding + command + grounding.
    await mountCreateTaskBinding(store);

    // 3. Without cache invalidation, the resolver returns the STALE empty
    //    result — this is exactly the D1 symptom (buttons stay hidden after
    //    a partial→full mount, no reload).
    const staleRead = await resolver.resolveForAssetMulti(PROJECT_IRI, PROJECT_CLASSES);
    expect(staleRead).toHaveLength(0); // regression demonstrated

    // 4. The D1 fix: the profile-apply refresh hook calls invalidateCache()
    //    after the store rebuild. Now the binding resolves and the button
    //    appears — without a plugin reload.
    resolver.invalidateCache();
    const afterInvalidate = await resolver.resolveForAssetMulti(PROJECT_IRI, PROJECT_CLASSES);
    expect(afterInvalidate).toHaveLength(1);
    expect(afterInvalidate[0].command.name).toBe("Create Task");
  });
});

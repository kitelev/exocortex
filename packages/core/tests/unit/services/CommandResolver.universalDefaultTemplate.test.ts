/**
 * CommandResolver — RFC 727572d2 UniversalDefaultTemplate parse-time merge.
 *
 * Covers:
 * - Universal singleton present + Grounding has no PDs → executor receives
 *   Universal entries directly.
 * - Universal singleton present + Grounding overrides one PD → Grounding wins
 *   for that propertyName, Universal wins for others.
 * - Universal singleton ABSENT → resolved list = Grounding's own only.
 * - Universal IRs same merge semantics as PDs.
 * - TokenInvocation wrapper parsed: emits parameterised marker.
 *
 * Includes revert→fail/restore→pass discipline check per
 * ~/.claude/rules/integration-test-revert-verify.md: removing the Universal
 * singleton triple makes the merge test fail; adding it back restores pass.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { ILogger } from "../../../src/interfaces/ILogger";
import { clearUniversalDefaultLoader } from "../../../src/services/UniversalDefaultTemplateResolver";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";

interface RecordingLogger extends ILogger {
  readonly warnings: string[];
}

function makeRecordingLogger(): RecordingLogger {
  const warnings: string[] = [];
  return {
    debug() {},
    info() {},
    warn(msg: string) {
      warnings.push(msg);
    },
    error() {},
    warnings,
  };
}

// UUIDs — matching real vault UIDs created in Phase A
const TOKEN_INVOCATION_CLASS_UID = "3f28af98-c031-4718-8ba2-44ad0b012c52";
const UNIVERSAL_DEFAULT_TEMPLATE_CLASS_UID =
  "29e2c8f8-2d27-4e58-b467-2e85d46f8122";

// Property assets
const PROP_UID_LABEL = "12a6151b-801f-4be2-bd6e-a787eedd56ae"; // exo__Asset_label
const PROP_UID_UID   = "fada7446-b0a4-4100-88f4-6d4421c175fb"; // exo__Asset_uid
const PROP_UID_STATUS = "ddd11111-1111-4111-8111-111111111111";

// SubstitutionToken assets
const TOKEN_RANDUUID = "adcb38b3-beb3-4f26-9ea5-82832ea452c8";
const TOKEN_USERINPUTLABEL = "ecd68426-0e80-4d9e-87b0-17a10ac200ce";
const TOKEN_TARGETPROP = "d16d6eae-46c3-4c09-adbc-66df4fc12200";

// PropertyDefault assets (Universal)
const PD_UID_UNIVERSAL_UID = "97aba859-393c-4a73-ae77-403ef97ea156";
const PD_UID_UNIVERSAL_LABEL = "bb2b0443-7a9f-4028-b1a2-0f2eaba8a343";

// TokenInvocation wrapper
const TI_UID = "2c09a5d1-0463-4ebd-bb25-404e431e8807";
const PD_UID_UNIVERSAL_ISDEFINEDBY = "3cbf26be-11ba-4b79-a1b4-2fe769183ce2";
const PROP_UID_ISDEFINEDBY = "179d6b59-c7fc-4bdf-a32f-ace630884a8c";

// Universal singleton
const UNIVERSAL_SINGLETON_UID = "62907ff4-bf91-4c94-8e02-92b3ca2bc798";

// Grounding under test
const COMMAND_UID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUNDING_UID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// Grounding-specific override PD
const PD_UID_GROUNDING_LABEL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

async function addPropertyAsset(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<void> {
  const s = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(s, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(s, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
}

async function addSubstitutionTokenAsset(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
  resolverId: string,
): Promise<void> {
  const s = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(
      s,
      Namespace.EXO.term("Instance_class"),
      Namespace.EXOCMD.term("SubstitutionToken"),
    ),
    new Triple(s, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(s, Namespace.EXO.term("Asset_label"), new Literal(label)),
    new Triple(
      s,
      Namespace.EXOCMD.term("SubstitutionToken_resolver"),
      new Literal(resolverId),
    ),
  ]);
}

async function addTokenInvocationAsset(
  store: InMemoryTripleStore,
  uid: string,
  tokenRefUid: string,
  parameter: string,
): Promise<void> {
  const s = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(
      s,
      Namespace.EXO.term("Instance_class"),
      Namespace.EXOCMD.term("TokenInvocation"),
    ),
    new Triple(s, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(
      s,
      Namespace.EXOCMD.term("TokenInvocation_token"),
      new IRI(`obsidian://vault/${tokenRefUid}.md`),
    ),
    new Triple(
      s,
      Namespace.EXOCMD.term("TokenInvocation_parameter"),
      new Literal(parameter),
    ),
  ]);
}

async function addPropertyDefaultAsset(
  store: InMemoryTripleStore,
  opts: { uid: string; propertyRefUid: string; valueRefUid: string },
): Promise<void> {
  const s = new IRI(`obsidian://vault/${opts.uid}.md`);
  await store.addAll([
    new Triple(s, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      s,
      Namespace.EXOCMD.term("PropertyDefault_property"),
      new IRI(`obsidian://vault/${opts.propertyRefUid}.md`),
    ),
    new Triple(
      s,
      Namespace.EXOCMD.term("PropertyDefault_value"),
      new IRI(`obsidian://vault/${opts.valueRefUid}.md`),
    ),
  ]);
}

async function addUniversalDefaultTemplateSingleton(
  store: InMemoryTripleStore,
  pdRefs: string[],
): Promise<void> {
  const s = new IRI(`obsidian://vault/${UNIVERSAL_SINGLETON_UID}.md`);
  const triples: Triple[] = [
    new Triple(
      s,
      Namespace.EXO.term("Instance_class"),
      Namespace.EXOCMD.term("UniversalDefaultTemplate"),
    ),
    new Triple(s, Namespace.EXO.term("Asset_uid"), new Literal(UNIVERSAL_SINGLETON_UID)),
  ];
  for (const pd of pdRefs) {
    triples.push(
      new Triple(
        s,
        Namespace.EXOCMD.term("Template_propertyDefault"),
        new IRI(`obsidian://vault/${pd}.md`),
      ),
    );
  }
  await store.addAll(triples);
}

async function addGroundingWithPDRefs(
  store: InMemoryTripleStore,
  pdRefs: string[],
): Promise<void> {
  const s = new IRI(`obsidian://vault/${GROUNDING_UID}.md`);
  const triples: Triple[] = [
    new Triple(s, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(s, Namespace.EXO.term("Asset_uid"), new Literal(GROUNDING_UID)),
    new Triple(s, Namespace.EXO.term("Asset_label"), new Literal("Test Grounding")),
    new Triple(
      s,
      Namespace.EXOCMD.term("Grounding_type"),
      // RFC 9d20c91f Phase 3: wikilink-form UID ref into exocmd__GroundingType
      // catalog (create_instance → 4367e2d6), not a bare-string literal. Legacy
      // bare-string resolves to null → grounding inert → command dropped (#3506).
      new Literal("[[4367e2d6-6c92-450a-becb-abce1fb07682]]"),
    ),
    new Triple(
      s,
      Namespace.EXOCMD.term("Grounding_targetFolder"),
      new Literal("inbox"),
    ),
  ];
  for (const pd of pdRefs) {
    triples.push(
      new Triple(
        s,
        Namespace.EXOCMD.term("Grounding_propertyDefault"),
        new IRI(`obsidian://vault/${pd}.md`),
      ),
    );
  }
  await store.addAll(triples);

  const cmd = new IRI(`obsidian://vault/${COMMAND_UID}.md`);
  await store.addAll([
    new Triple(cmd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmd, Namespace.EXO.term("Asset_uid"), new Literal(COMMAND_UID)),
    new Triple(cmd, Namespace.EXO.term("Asset_label"), new Literal(COMMAND_UID)),
    new Triple(
      cmd,
      Namespace.EXOCMD.term("Command_grounding"),
      new IRI(`obsidian://vault/${GROUNDING_UID}.md`),
    ),
  ]);
}

async function setupCommonTBox(store: InMemoryTripleStore): Promise<void> {
  await addPropertyAsset(store, PROP_UID_UID, "exo__Asset_uid");
  await addPropertyAsset(store, PROP_UID_LABEL, "exo__Asset_label");
  await addPropertyAsset(store, PROP_UID_STATUS, "ems__Effort_status");
  await addPropertyAsset(store, PROP_UID_ISDEFINEDBY, "exo__Asset_isDefinedBy");
  await addSubstitutionTokenAsset(store, TOKEN_RANDUUID, "$randomUUIDv4", "randomUUIDv4");
  await addSubstitutionTokenAsset(store, TOKEN_USERINPUTLABEL, "$userInputLabel", "userInputLabel");
  await addSubstitutionTokenAsset(store, TOKEN_TARGETPROP, "$target.property", "targetProperty");
  await addTokenInvocationAsset(store, TI_UID, TOKEN_TARGETPROP, "exo__Asset_isDefinedBy");
  await addPropertyDefaultAsset(store, {
    uid: PD_UID_UNIVERSAL_UID,
    propertyRefUid: PROP_UID_UID,
    valueRefUid: TOKEN_RANDUUID,
  });
  await addPropertyDefaultAsset(store, {
    uid: PD_UID_UNIVERSAL_LABEL,
    propertyRefUid: PROP_UID_LABEL,
    valueRefUid: TOKEN_USERINPUTLABEL,
  });
  await addPropertyDefaultAsset(store, {
    uid: PD_UID_UNIVERSAL_ISDEFINEDBY,
    propertyRefUid: PROP_UID_ISDEFINEDBY,
    valueRefUid: TI_UID,
  });
}

describe("CommandResolver — RFC 727572d2 UniversalDefaultTemplate merge", () => {
  let store: InMemoryTripleStore;
  let logger: RecordingLogger;
  let resolver: CommandResolver;

  beforeEach(async () => {
    clearUniversalDefaultLoader();
    store = new InMemoryTripleStore();
    logger = makeRecordingLogger();
    resolver = new CommandResolver(store, logger);
    await setupCommonTBox(store);
  });

  it("Universal singleton present + Grounding has no PDs → executor sees 3 Universal PDs", async () => {
    await addUniversalDefaultTemplateSingleton(store, [
      PD_UID_UNIVERSAL_UID,
      PD_UID_UNIVERSAL_LABEL,
      PD_UID_UNIVERSAL_ISDEFINEDBY,
    ]);
    await addGroundingWithPDRefs(store, []);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toBeDefined();
    const pds = cmd!.grounding.propertyDefault!;
    expect(pds).toHaveLength(3);
    const byName = new Map(pds.map((p) => [p.propertyName, p.value]));
    expect(byName.get("exo__Asset_uid")).toMatch(
      /^__SUBSTITUTE__randomUUIDv4__/,
    );
    expect(byName.get("exo__Asset_label")).toMatch(
      /^__SUBSTITUTE__userInputLabel__/,
    );
    expect(byName.get("exo__Asset_isDefinedBy")).toMatch(
      /^__SUBSTITUTE_P__targetProperty__.*__$/,
    );
  });

  it("Grounding overrides Universal PD by propertyName key", async () => {
    await addUniversalDefaultTemplateSingleton(store, [
      PD_UID_UNIVERSAL_UID,
      PD_UID_UNIVERSAL_LABEL,
    ]);
    // Grounding-specific override for exo__Asset_label
    await addValueAssetForOverride(store);
    await addPropertyDefaultAsset(store, {
      uid: PD_UID_GROUNDING_LABEL,
      propertyRefUid: PROP_UID_LABEL,
      valueRefUid: OVERRIDE_VALUE_UID,
    });
    await addGroundingWithPDRefs(store, [PD_UID_GROUNDING_LABEL]);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toBeDefined();
    const pds = cmd!.grounding.propertyDefault!;
    expect(pds).toHaveLength(2);
    const byName = new Map(pds.map((p) => [p.propertyName, p.value]));
    // Grounding override wins for label
    expect(byName.get("exo__Asset_label")).toBe(`"[[${OVERRIDE_VALUE_UID}]]"`);
    // Universal still wins for uid
    expect(byName.get("exo__Asset_uid")).toMatch(/^__SUBSTITUTE__randomUUIDv4__/);
  });

  it("REVERT verification — Universal singleton absent → only Grounding entries", async () => {
    // NOT adding Universal Default Template singleton — simulates missing vault asset
    await addValueAssetForOverride(store);
    await addPropertyDefaultAsset(store, {
      uid: PD_UID_GROUNDING_LABEL,
      propertyRefUid: PROP_UID_LABEL,
      valueRefUid: OVERRIDE_VALUE_UID,
    });
    await addGroundingWithPDRefs(store, [PD_UID_GROUNDING_LABEL]);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toBeDefined();
    const pds = cmd!.grounding.propertyDefault!;
    // Only Grounding's own — no Universal merge applied
    expect(pds).toHaveLength(1);
    expect(pds[0].propertyName).toBe("exo__Asset_label");
  });

  it("TokenInvocation wrapper resolves to parameterised marker", async () => {
    await addUniversalDefaultTemplateSingleton(store, [
      PD_UID_UNIVERSAL_ISDEFINEDBY,
    ]);
    await addGroundingWithPDRefs(store, []);

    const cmd = await resolver.loadCommand(COMMAND_UID);
    const pds = cmd!.grounding.propertyDefault!;
    expect(pds).toHaveLength(1);
    expect(pds[0].propertyName).toBe("exo__Asset_isDefinedBy");
    // Marker shape: __SUBSTITUTE_P__targetProperty__<uid>__<base64>__
    expect(pds[0].value).toMatch(
      /^__SUBSTITUTE_P__targetProperty__d16d6eae-46c3-4c09-adbc-66df4fc12200__[A-Za-z0-9_-]+__$/,
    );
    // Base64 of "exo__Asset_isDefinedBy" should be decodable back
    const m = pds[0].value.match(
      /^__SUBSTITUTE_P__targetProperty__[0-9a-f-]+__([A-Za-z0-9_-]+)__$/,
    );
    expect(m).not.toBeNull();
    const encoded = m![1];
    const normalised = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalised.length % 4 === 0 ? "" : "=".repeat(4 - (normalised.length % 4));
    const decoded = Buffer.from(normalised + padding, "base64").toString("utf-8");
    expect(decoded).toBe("exo__Asset_isDefinedBy");
  });
});

// Override value asset for the "Grounding wins" test
const OVERRIDE_VALUE_UID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
async function addValueAssetForOverride(store: InMemoryTripleStore): Promise<void> {
  const s = new IRI(`obsidian://vault/${OVERRIDE_VALUE_UID}.md`);
  await store.addAll([
    new Triple(s, Namespace.EXO.term("Asset_uid"), new Literal(OVERRIDE_VALUE_UID)),
    new Triple(s, Namespace.EXO.term("Asset_label"), new Literal("Override")),
  ]);
}

/* ------------------------------------------------------------------------
 * req f3193399 — invalidation of the UniversalDefaultTemplate cache.
 *
 * Before this requirement `clearUniversalCache()` had ZERO production call
 * sites, so the template — and, worse, a `null` verdict latched against a
 * not-yet-warm store — survived until the plugin was restarted. The latch is
 * armed BEFORE the lookup (`_universalCacheReady = true` precedes
 * `findUniversalSingleton()`), which is why the `null` case latches too.
 *
 * The axes below are ISOLATING per GUARD, not per axis: the first two share
 * one guard (the `clearUniversalCache()` call) but assert different
 * behaviours — visibility of an edit vs. the latched `null`. No guard can be
 * removed without reddening at least one axis, and no axis reddens for a
 * guard it does not name.
 *
 *   - «правка шаблона действует…»  ← `this.clearUniversalCache()` in invalidateCache
 *   - «вердикт „шаблона нет“…»     ← the same call, exercised on the null branch
 *   - «отсутствие диагностируемо»  ← the `logger.debug` on the null branch
 *
 * ⛤ Why `invalidateCache()` and not a direct `clearUniversalCache()` call in
 * the test: the requirement is about the WIRING, not the primitive. The
 * primitive already had a green test («clearUniversalDefault invalidates
 * cache», UniversalDefaultTemplateResolver.test.ts) — and it stayed green for
 * the whole time the feature was broken, because nobody called it. Asserting
 * through the wiring is the only form that can go red here.
 * --------------------------------------------------------------------- */

interface FullRecordingLogger extends ILogger {
  readonly warnings: string[];
  readonly debugs: string[];
}

/**
 * The file-level `makeRecordingLogger` drops `debug` on the floor, so it is
 * structurally blind to the diagnosability axis. This one records both.
 */
function makeFullRecordingLogger(): FullRecordingLogger {
  const warnings: string[] = [];
  const debugs: string[] = [];
  return {
    debug(msg: string) {
      debugs.push(msg);
    },
    info() {},
    warn(msg: string) {
      warnings.push(msg);
    },
    error() {},
    warnings,
    debugs,
  };
}

/** Attach one more PropertyDefault ref to the already-present singleton. */
async function attachPdToSingleton(
  store: InMemoryTripleStore,
  pdUid: string,
): Promise<void> {
  await store.addAll([
    new Triple(
      new IRI(`obsidian://vault/${UNIVERSAL_SINGLETON_UID}.md`),
      Namespace.EXOCMD.term("Template_propertyDefault"),
      new IRI(`obsidian://vault/${pdUid}.md`),
    ),
  ]);
}

async function pdNamesOf(
  resolver: CommandResolver,
): Promise<string[]> {
  const cmd = await resolver.loadCommand(COMMAND_UID);
  return (cmd!.grounding.propertyDefault ?? []).map((p) => p.propertyName).sort();
}

describe("CommandResolver — req f3193399: UniversalDefaultTemplate cache invalidation", () => {
  let store: InMemoryTripleStore;
  let logger: FullRecordingLogger;
  let resolver: CommandResolver;

  beforeEach(async () => {
    clearUniversalDefaultLoader();
    store = new InMemoryTripleStore();
    logger = makeFullRecordingLogger();
    resolver = new CommandResolver(store, logger);
    await setupCommonTBox(store);
  });

  it("@req:f3193399-ae33-44cf-a20f-d0e59edf8b81 — правка шаблона действует после invalidateCache, без пересоздания резолвера", async () => {
    await addUniversalDefaultTemplateSingleton(store, [PD_UID_UNIVERSAL_UID]);
    await addGroundingWithPDRefs(store, []);

    expect(await pdNamesOf(resolver)).toEqual(["exo__Asset_uid"]);

    // The user edits the template: one more PropertyDefault is attached.
    await attachPdToSingleton(store, PD_UID_UNIVERSAL_LABEL);

    // The host reports the vault change the only way it knows how.
    resolver.invalidateCache();

    // ⛔ Without the wiring the command cache clears but the universal cache
    // does not, so the second PD stays invisible for the rest of the session.
    expect(await pdNamesOf(resolver)).toEqual([
      "exo__Asset_label",
      "exo__Asset_uid",
    ]);
  });

  it("@req:f3193399-ae33-44cf-a20f-d0e59edf8b81 — вердикт «шаблона нет» не латчится на сессию", async () => {
    // Cold store: the singleton's `exo__Instance_class` triple has not landed
    // yet. This is the shape that silently strips createdAt/updatedAt from
    // every asset created afterwards.
    await addGroundingWithPDRefs(store, []);
    expect(await pdNamesOf(resolver)).toEqual([]);

    // The store finishes warming up.
    await addUniversalDefaultTemplateSingleton(store, [PD_UID_UNIVERSAL_UID]);
    resolver.invalidateCache();

    expect(await pdNamesOf(resolver)).toEqual(["exo__Asset_uid"]);
  });

  it("@req:f3193399-ae33-44cf-a20f-d0e59edf8b81 — отсутствие шаблона диагностируемо: debug есть, warn нет", async () => {
    await addGroundingWithPDRefs(store, []);
    await resolver.loadCommand(COMMAND_UID);

    const hit = logger.debugs.filter((m) =>
      m.includes("No exocmd__UniversalDefaultTemplate instance found"),
    );
    expect(hit).toHaveLength(1);
    // The message must name the consequence, not merely the fact — otherwise
    // it does not answer the question a reader arrives with.
    expect(hit[0]).toMatch(/invalidateCache\(\)/);

    // Negative control: a vault without a template is a LEGITIMATE state, and
    // `warn` is routed to a user-facing toast by DEFAULT_LOG_CHANNELS. Raising
    // the severity here would toast every such user on every render.
    expect(logger.warnings).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------
 * req f3193399 — the indexed fast path in findUniversalSingleton.
 *
 * Two axes, because the fast path has two ways to be wrong and they fail in
 * OPPOSITE directions:
 *   - it is not taken       → the O(vault) scan runs on every save (the cost
 *                             the wiring would otherwise introduce);
 *   - it REPLACES the walk  → a singleton whose class object is NOT the
 *                             symbolic IRI (cold-cache file IRI, or an
 *                             unresolved-uid literal) stops resolving, silently.
 *                             ⛔ NOT "the label form": that spelling is emitted
 *                             symbolic and takes the fast path — see the
 *                             premise axes at the bottom of this file, which
 *                             observe the emission instead of assuming it.
 * A single axis cannot see both.
 * --------------------------------------------------------------------- */

/** Counts unbound-object `Instance_class` scans made through the store. */
class ScanCountingStore extends InMemoryTripleStore {
  public unboundClassScans = 0;
  override async match(
    s?: Parameters<InMemoryTripleStore["match"]>[0],
    p?: Parameters<InMemoryTripleStore["match"]>[1],
    o?: Parameters<InMemoryTripleStore["match"]>[2],
  ): ReturnType<InMemoryTripleStore["match"]> {
    if (
      s === undefined &&
      o === undefined &&
      p !== undefined &&
      p.value === Namespace.EXO.term("Instance_class").value
    ) {
      this.unboundClassScans += 1;
    }
    return super.match(s, p, o);
  }
}

/**
 * Singleton whose `Instance_class` object is one of the NON-symbolic forms the
 * converter actually emits — i.e. the ones only the fallback can catch.
 *
 * ⛔ Do NOT "simplify" this to `Literal("[[exocmd__UniversalDefaultTemplate]]")`.
 * That spelling never reaches the store: `NoteToRDFConverter.expandClassValue`
 * is a pure prefix parse, so the label form is emitted as a SYMBOLIC IRI and
 * takes the fast path. Guarding a form the converter cannot produce is a green
 * axis over a dead input — the premise axis below proves which form is real.
 */
async function addUniversalSingletonInFallbackForm(
  store: InMemoryTripleStore,
  form: "file-iri" | "unresolved-literal",
  pdRefs: string[],
): Promise<void> {
  const s = new IRI(`obsidian://vault/${UNIVERSAL_SINGLETON_UID}.md`);
  const classObject =
    form === "file-iri"
      ? // cold metadataCache (`getFrontmatter` → null) and the
        // `emitInstanceClassAsUid` stage-1 flag both emit the class FILE IRI
        new IRI(
          `obsidian://vault/exocmd/${UNIVERSAL_DEFAULT_TEMPLATE_CLASS_UID}.md`,
        )
      : // the class uid does not resolve to a file at all
        new Literal(`[[${UNIVERSAL_DEFAULT_TEMPLATE_CLASS_UID}]]`);
  const triples: Triple[] = [
    new Triple(s, Namespace.EXO.term("Instance_class"), classObject),
    new Triple(
      s,
      Namespace.EXO.term("Asset_uid"),
      new Literal(UNIVERSAL_SINGLETON_UID),
    ),
  ];
  for (const pd of pdRefs) {
    triples.push(
      new Triple(
        s,
        Namespace.EXOCMD.term("Template_propertyDefault"),
        new IRI(`obsidian://vault/${pd}.md`),
      ),
    );
  }
  await store.addAll(triples);
}

describe("CommandResolver — req f3193399: indexed singleton lookup", () => {
  beforeEach(() => {
    clearUniversalDefaultLoader();
  });

  it("@req:f3193399-ae33-44cf-a20f-d0e59edf8b81 — IRI-форма резолвится БЕЗ обхода всех Instance_class", async () => {
    const store = new ScanCountingStore();
    const resolver = new CommandResolver(store, makeFullRecordingLogger());
    await setupCommonTBox(store);
    await addUniversalDefaultTemplateSingleton(store, [PD_UID_UNIVERSAL_UID]);
    await addGroundingWithPDRefs(store, []);

    const before = store.unboundClassScans;
    const cmd = await resolver.loadCommand(COMMAND_UID);

    // Ловится сам эффект: дефолт применён…
    expect((cmd!.grounding.propertyDefault ?? []).map((p) => p.propertyName)).toEqual([
      "exo__Asset_uid",
    ]);
    // …и при этом ни одного обхода с несвязанным объектом не понадобилось.
    // ⛔ Именно этот счётчик, а не тайминг: тайминг флачет под нагрузкой
    // раннера, а число обходов детерминировано.
    expect(store.unboundClassScans).toBe(before);
  });

  it.each([
    ["file-iri" as const, "холодный metadataCache / emitInstanceClassAsUid"],
    ["unresolved-literal" as const, "class-uid не резолвится в файл"],
  ])(
    "@req:f3193399-ae33-44cf-a20f-d0e59edf8b81 — не-symbolic форма (%s: %s) резолвится через фолбэк",
    async (form, _why) => {
      const store = new ScanCountingStore();
      const resolver = new CommandResolver(store, makeFullRecordingLogger());
      await setupCommonTBox(store);
      await addUniversalSingletonInFallbackForm(store, form, [PD_UID_UNIVERSAL_UID]);
      await addGroundingWithPDRefs(store, []);

      const before = store.unboundClassScans;
      const cmd = await resolver.loadCommand(COMMAND_UID);

      // Фолбэк ОБЯЗАН оставаться живым: связать объект для этих форм нельзя.
      expect((cmd!.grounding.propertyDefault ?? []).map((p) => p.propertyName)).toEqual([
        "exo__Asset_uid",
      ]);
      // ⛤ Симметрично оси выше — от baseline, не от абсолютного нуля: «0 после
      // setup» сегодня верно (addAll не зовёт match), но это НЕзаписанный
      // инвариант, и в день, когда хелпер setup'а прочитает store, абсолютная
      // форма пройдёт вакуумно.
      expect(store.unboundClassScans).toBeGreaterThan(before);
    },
  );
});

describe("NoteToRDFConverter — посылка, на которой держится фолбэк выше", () => {
  // ⛔ НЕ переобъявлять литерал: ось-посылка обязана доказывать механизм для
  // ТОГО ЖЕ класса, который ловит фолбэк выше, иначе они разъедутся молча и
  // обе останутся зелёными (механизм класс-агностичен).
  const CLASS_UID = UNIVERSAL_DEFAULT_TEMPLATE_CLASS_UID;
  const singletonFile: IFile = {
    path: `exocmd/${UNIVERSAL_SINGLETON_UID}.md`,
    basename: UNIVERSAL_SINGLETON_UID,
    name: `${UNIVERSAL_SINGLETON_UID}.md`,
    parent: null,
  };
  const classFile: IFile = {
    path: `exocmd/${CLASS_UID}.md`,
    basename: CLASS_UID,
    name: `${CLASS_UID}.md`,
    parent: null,
  };

  function makeVault(classFrontmatter: IFrontmatter | null): IVaultAdapter {
    return {
      getFrontmatter: (f: IFile) =>
        f.path === singletonFile.path
          ? ({ exo__Instance_class: `[[${CLASS_UID}]]` } as IFrontmatter)
          : classFrontmatter,
      getFirstLinkpathDest: (linkpath: string) =>
        linkpath === CLASS_UID ? classFile : null,
      read: async () => "",
      getAllFiles: () => [],
      create: async () => singletonFile,
      modify: async () => {},
      delete: async () => {},
      exists: async () => true,
      getAbstractFileByPath: () => null,
      updateFrontmatter: async () => {},
      rename: async () => {},
      createFolder: async () => {},
      process: async () => "",
      updateLinks: async () => {},
      getDefaultNewFileParent: () => null,
    } as IVaultAdapter;
  }

  async function emittedClassObject(fm: IFrontmatter | null) {
    const triples = await new NoteToRDFConverter(makeVault(fm)).convertNote(
      singletonFile,
    );
    return triples.find((t) =>
      (t.predicate as IRI).value.endsWith("#Instance_class"),
    )?.object;
  }

  it("@req:f3193399-ae33-44cf-a20f-d0e59edf8b81 — при ХОЛОДНОМ metadataCache класс эмитится FILE-IRI, а не symbolic", async () => {
    // ⛤ Эта ось — не про CommandResolver. Она доказывает ПОСЫЛКУ, на которой
    // держится фолбэк: что форма, которую он ловит, вообще возникает. Первая
    // редакция этого PR утверждала другую форму («label-first»), и утверждение
    // было ЛОЖНЫМ — потому что форму предположили, а не наблюдали.
    const obj = await emittedClassObject(null); // getFrontmatter класса → null
    expect(obj).toBeInstanceOf(IRI);
    expect((obj as IRI).value).toContain(CLASS_UID);
    expect((obj as IRI).value).not.toContain("ontology/exocmd#");
  });

  it("@req:f3193399-ae33-44cf-a20f-d0e59edf8b81 — при ПРОГРЕТОМ metadataCache класс эмитится symbolic ⇒ идёт быстрым путём", async () => {
    const obj = await emittedClassObject({
      exo__Asset_label: "exocmd__UniversalDefaultTemplate",
    } as IFrontmatter);
    expect(obj).toBeInstanceOf(IRI);
    expect((obj as IRI).value).toContain("ontology/exocmd#UniversalDefaultTemplate");
  });
});

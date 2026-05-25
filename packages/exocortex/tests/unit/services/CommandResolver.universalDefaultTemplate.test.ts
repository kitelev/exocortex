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
      new Literal("create_instance"),
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

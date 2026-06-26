/**
 * Integration test — a wikilink DISPLAY ALIAS in `exo__Instance_class` must NOT
 * affect exocmd command/binding resolution.
 *
 * Bug (Andrey, on `ems__Meeting` assets): an `exo__Instance_class` written as
 * `"[[<uid>|ems__Meeting]]"` (a display alias) rendered ZERO command buttons,
 * while the alias-free `"[[<uid>]]"` rendered them. The alias is purely a
 * DISPLAY concern (how the wikilink is shown) and must never participate in
 * command resolution — the resolved command set has to be identical to the
 * alias-free form.
 *
 * Realism (test-fixture-realism): this wires the REAL resolution pipeline —
 * `InMemoryTripleStore` + `CommandResolver` (class-hierarchy expansion + UID→
 * label resolution + binding match) + `PreconditionEvaluator` + the REAL
 * `DynamicCommandButtonGroupBuilder.extractAssetClasses`. The only stub is
 * `CommandExecutionFlow`, which is invoked on a button CLICK and never during
 * resolution. Declared binding-class: Integration (RFC 0003 §3.6) — it exercises
 * real production beyond a mocked unit. Co-located under `tests/unit/integration/`
 * (the precedent for plugin integration suites, e.g. `sparql-critical-paths`)
 * because the obsidian-plugin jest `testMatch` only runs `tests/unit/**`.
 *
 * Empirical nuance (verify-before-assert): the resolver's own
 * `matchesReference` carries a legacy `UUID|alias` cross-match (Issue #2740) and
 * `normalizeWikilink` already strips a pipe to its TARGET. So a UID-form alias
 * that happens to EQUAL the symbolic class name (`[[uid|ems__Meeting]]`) and any
 * SYMBOLIC-form alias (`[[ems__Meeting|Display]]`) are coincidentally resolved
 * even WITHOUT the extractor fix. The genuinely-broken case — and the
 * revert-verify discriminator — is a UID-form ref with an ARBITRARY display
 * alias (a real meeting title, not the class name): `[[uid|Завтрак с командой]]`.
 * There `normalizeWikilink` yields the bare UID (≠ "ems__Meeting"), the alias is
 * not the class name (no #2740 cross-match), and the buggy extractor skips the
 * #3141 UUID→label expansion (`isUuidRef("uid|alias")` is false) — so 0 buttons.
 *
 * Revert-verify: removing the alias-strip in `extractAssetClasses.collect`
 * makes the ARBITRARY-alias case render 0 buttons while the alias-free form
 * renders 1 — the "ARBITRARY display alias" `toEqual` assertion goes RED.
 * Restoring the strip converges all forms → GREEN. Empirically verified
 * (FAILS pre-fix on the arbitrary-alias case / PASSES post-fix). The
 * class-name-alias and symbolic-form cases are regression coverage: the fix
 * must keep them working (they pass both ways).
 *
 * @req:9e84c833-2057-4343-9006-b2d05ec69159
 */

import {
  InMemoryTripleStore,
  CommandResolver,
  PreconditionEvaluator,
  CommandExecutionFlow,
  Triple,
  IRI,
  Literal,
  Namespace,
} from "@kitelev/exocortex-core";
import { DynamicCommandButtonGroupBuilder } from "../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import type { ButtonBuilderContext } from "../../../src/presentation/builders/button-groups/ButtonBuilderTypes";

// Real Meeting class UID (matches the production class `ems__Meeting`).
const MEETING_UID = "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca";
const CMD_UID = "aa11bb22-cc33-4d44-9e55-6f7788990011";
const GND_UID = "bb22cc33-dd44-4e55-9f66-778899001122";
const BIND_UID = "cc33dd44-ee55-4f66-8a77-889900112233";

// property_set grounding-type wikilink (mirror of GroundingTypeUIDs catalog).
const PROPERTY_SET_GND_TYPE = "[[cf3bb923-f1f1-40be-b728-782844402426]]";

/**
 * Seed the REAL store with: a `ems__Meeting` class definition (so the resolver
 * can resolve `MEETING_UID → "ems__Meeting"`), a property_set Command + its
 * Grounding, and a class-targeted CommandBinding (`targetClass: "ems__Meeting"`).
 * No precondition → the command renders unconditionally.
 */
async function seedMeetingClassAndBinding(
  store: InMemoryTripleStore,
): Promise<void> {
  // Class definition — UID-named subject; label is the symbolic class name.
  const classSubject = new IRI(`obsidian://vault/${MEETING_UID}.md`);
  await store.addAll([
    new Triple(
      classSubject,
      Namespace.RDF.term("type"),
      Namespace.EXO.term("Class"),
    ),
    new Triple(
      classSubject,
      Namespace.EXO.term("Asset_uid"),
      new Literal(MEETING_UID),
    ),
    new Triple(
      classSubject,
      Namespace.EXO.term("Asset_label"),
      new Literal("ems__Meeting"),
    ),
  ]);

  // Grounding (property_set).
  const gndSubject = new IRI(`obsidian://vault/${GND_UID}.md`);
  await store.addAll([
    new Triple(
      gndSubject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Grounding"),
    ),
    new Triple(
      gndSubject,
      Namespace.EXO.term("Asset_uid"),
      new Literal(GND_UID),
    ),
    new Triple(
      gndSubject,
      Namespace.EXO.term("Asset_label"),
      new Literal("Gnd: Mark meeting done"),
    ),
    new Triple(
      gndSubject,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal(PROPERTY_SET_GND_TYPE),
    ),
    new Triple(
      gndSubject,
      Namespace.EXOCMD.term("Grounding_targetProperty"),
      new Literal("ems__Effort_status"),
    ),
    new Triple(
      gndSubject,
      Namespace.EXOCMD.term("Grounding_targetValueLiteral"),
      new Literal("done"),
    ),
  ]);

  // Command.
  const cmdSubject = new IRI(`obsidian://vault/${CMD_UID}.md`);
  await store.addAll([
    new Triple(
      cmdSubject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    ),
    new Triple(
      cmdSubject,
      Namespace.EXO.term("Asset_uid"),
      new Literal(CMD_UID),
    ),
    new Triple(
      cmdSubject,
      Namespace.EXO.term("Asset_label"),
      new Literal("Mark meeting done"),
    ),
    new Triple(
      cmdSubject,
      Namespace.EXOCMD.term("Command_grounding"),
      gndSubject,
    ),
    new Triple(
      cmdSubject,
      Namespace.EXOCMD.term("Command_category"),
      new Literal("status"),
    ),
  ]);

  // Binding — class-targeted at `ems__Meeting`.
  const bindSubject = new IRI(`obsidian://vault/${BIND_UID}.md`);
  await store.addAll([
    new Triple(
      bindSubject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("CommandBinding"),
    ),
    new Triple(
      bindSubject,
      Namespace.EXO.term("Asset_uid"),
      new Literal(BIND_UID),
    ),
    new Triple(
      bindSubject,
      Namespace.EXO.term("Asset_label"),
      new Literal("Bind: Mark meeting done"),
    ),
    new Triple(
      bindSubject,
      Namespace.EXOCMD.term("CommandBinding_command"),
      cmdSubject,
    ),
    new Triple(
      bindSubject,
      Namespace.EXOCMD.term("CommandBinding_targetClass"),
      new Literal("ems__Meeting"),
    ),
  ]);
}

function createMeetingContext(
  instanceClassValue: string,
): ButtonBuilderContext {
  return {
    app: {} as ButtonBuilderContext["app"],
    settings: {} as ButtonBuilderContext["settings"],
    plugin: {} as ButtonBuilderContext["plugin"],
    file: {
      path: "meetings/standup-2026-06-26.md",
      basename: "standup-2026-06-26",
      parent: { path: "meetings" },
    } as ButtonBuilderContext["file"],
    metadata: {
      exo__Asset_uid: "obsidian://vault/meetings/standup-2026-06-26.md",
      exo__Instance_class: instanceClassValue,
    },
    instanceClass: instanceClassValue,
    visibilityContext: {
      instanceClass: instanceClassValue,
      currentStatus: null,
      metadata: {},
      isArchived: false,
      currentFolder: "meetings",
      expectedFolder: "meetings",
      classIsPrototype: false,
    },
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as ButtonBuilderContext["logger"],
    refresh: jest.fn().mockResolvedValue(undefined),
  };
}

describe("alias in exo__Instance_class does not affect exocmd resolution (#alias-exocmd)", () => {
  let builder: DynamicCommandButtonGroupBuilder;

  beforeEach(async () => {
    const store = new InMemoryTripleStore();
    await seedMeetingClassAndBinding(store);

    const commandResolver = new CommandResolver(store);
    const preconditionEvaluator = new PreconditionEvaluator(store);

    // Stub flow — never invoked during resolution (only on a button click).
    const commandExecutionFlow = {
      run: jest.fn(),
    } as unknown as CommandExecutionFlow;

    builder = new DynamicCommandButtonGroupBuilder({
      commandResolver,
      preconditionEvaluator,
      commandExecutionFlow,
    });
  });

  async function buttonLabelsFor(instanceClassValue: string): Promise<string[]> {
    const buttons = await builder.build(createMeetingContext(instanceClassValue));
    return buttons.map((b) => b.label).sort();
  }

  it("renders the same buttons for an alias-free UID-form instance class as the alias-free baseline (sanity)", async () => {
    const aliasFree = await buttonLabelsFor(`[[${MEETING_UID}]]`);
    expect(aliasFree).toContain("Mark meeting done");
  });

  it("UID-form alias [[uid|ems__Meeting]] resolves the IDENTICAL command set as the alias-free [[uid]] — the user's exact report", async () => {
    const aliasFree = await buttonLabelsFor(`[[${MEETING_UID}]]`);
    const aliased = await buttonLabelsFor(`[[${MEETING_UID}|ems__Meeting]]`);

    expect(aliasFree.length).toBeGreaterThan(0);
    expect(aliased).toEqual(aliasFree);
  });

  it("an ARBITRARY (non-class) display alias still renders the Meeting buttons — the alias is display-only", async () => {
    const aliasFree = await buttonLabelsFor(`[[${MEETING_UID}]]`);
    const arbitraryAlias = await buttonLabelsFor(
      `[[${MEETING_UID}|Завтрак с командой]]`,
    );

    expect(aliasFree.length).toBeGreaterThan(0);
    expect(arbitraryAlias).toEqual(aliasFree);
  });

  it("symbolic-form alias [[ems__Meeting|Display]] resolves the IDENTICAL set as the alias-free [[ems__Meeting]]", async () => {
    const aliasFree = await buttonLabelsFor("[[ems__Meeting]]");
    const aliased = await buttonLabelsFor("[[ems__Meeting|Weekly Sync]]");

    expect(aliasFree.length).toBeGreaterThan(0);
    expect(aliased).toEqual(aliasFree);
  });

  it("array-form instance class with aliased entry resolves the same as the alias-free array", async () => {
    const aliasFree = await builder.build(
      createMeetingContextArray([`[[${MEETING_UID}]]`]),
    );
    const aliased = await builder.build(
      createMeetingContextArray([`[[${MEETING_UID}|ems__Meeting]]`]),
    );

    const aliasFreeLabels = aliasFree.map((b) => b.label).sort();
    const aliasedLabels = aliased.map((b) => b.label).sort();
    expect(aliasFreeLabels.length).toBeGreaterThan(0);
    expect(aliasedLabels).toEqual(aliasFreeLabels);
  });
});

function createMeetingContextArray(
  instanceClassValue: string[],
): ButtonBuilderContext {
  const ctx = createMeetingContext(instanceClassValue[0]);
  return {
    ...ctx,
    metadata: { ...ctx.metadata, exo__Instance_class: instanceClassValue },
    instanceClass: instanceClassValue,
  };
}

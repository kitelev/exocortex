/**
 * `property_replace` — PRODUCTION-loader parity for the two new grounding
 * predicates (`exocmd__Grounding_replaceFromExpression` / `_replaceToExpression`).
 *
 * Requirement `02de55a4-0a07-4347-b434-bb4a48eb0163` (issue #4308).
 *
 * ⚠ Why this file exists separately from `GroundingExecutor.property_replace.test.ts`:
 * the executor tests hand the grounding definition to the engine directly, so
 * they stay GREEN even when NO loader reads the predicates — the feature would
 * be dead in production under a fully green suite. The grounding record is read
 * by TWO loaders:
 *
 *   - `CommandResolver.loadGroundingDefinition` — the PRODUCTION path (plugin
 *     button + CLI `apply`), reading from the triple store;
 *   - `parseGroundingDefinitionFromFrontmatter` — the raw-frontmatter path,
 *     reading the record directly.
 *
 * ⛔ An earlier revision of this comment called the second one "the BDD path".
 * That is stale: cucumber was removed in #3433 (0 `.feature` files remain), and
 * a sweep for importers of `parseGroundingDefinitionFromFrontmatter` across this
 * tree finds only its own unit test, this file, and the package's public
 * re-export — no functional consumer in-repo at all. ✅ What it actually is:
 * PUBLIC API SURFACE exported from `@kitelev/exocortex-core`, potentially
 * consumed by a repo not visible from here.
 *
 * The substance is unchanged by that correction: `CommandResolver` is the
 * PRODUCTION loader, and a predicate wired only into the other one resolves to
 * `undefined` at runtime (`multi-parser-predicate-migration`) — keeping an
 * exported function honest is right regardless of who consumes it. P1–P3 below
 * drive the production loader through a seeded triple store; P4 asserts both
 * loaders agree on the same source data.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { parseGroundingDefinitionFromFrontmatter } from "../../../src/domain/models/GroundingFrontmatterParser";
import type { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import type { ILogger } from "../../../src/interfaces/ILogger";

interface RecordingLogger extends ILogger {
  readonly warnings: string[];
}

function makeRecordingLogger(): RecordingLogger {
  const warnings: string[] = [];
  return {
    debug() {},
    info() {},
    warn(message: string) {
      warnings.push(message);
    },
    error() {},
    warnings,
  };
}

// Catalog UID of `exocmd__GroundingTypePropertyReplace` (exoas-exocmd asset
// created for this requirement). Mirrors GROUNDING_TYPE_UIDS — the fixture
// emits the wikilink-literal form the post-Phase-3 ABox actually carries.
const PROPERTY_REPLACE_TYPE_UID = "c8582746-6476-47f7-b0cc-e582c2754d84";

const GROUNDING_UID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMMAND_UID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const OBJECT_PROPERTY = "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16]]";
const DATATYPE_PROPERTY = "[[ae56ca4c-b610-42a4-a25d-058c23673296]]";

const FROM_EXPRESSION = `"${OBJECT_PROPERTY}"`;
const TO_EXPRESSION = `"${DATATYPE_PROPERTY}"`;

/** Seed a `property_replace` grounding plus the command that points at it. */
async function seedPropertyReplaceCommand(
  store: InMemoryTripleStore,
  overrides: { from?: string; to?: string } = {},
): Promise<void> {
  const grounding = new IRI(`obsidian://vault/${GROUNDING_UID}.md`);
  const triples: Triple[] = [
    new Triple(
      grounding,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Grounding"),
    ),
    new Triple(
      grounding,
      Namespace.EXO.term("Asset_uid"),
      new Literal(GROUNDING_UID),
    ),
    new Triple(
      grounding,
      Namespace.EXO.term("Asset_label"),
      new Literal("Swap one class"),
    ),
    new Triple(
      grounding,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal(`[[${PROPERTY_REPLACE_TYPE_UID}]]`),
    ),
    new Triple(
      grounding,
      Namespace.EXOCMD.term("Grounding_targetProperty"),
      new Literal("exo__Instance_class"),
    ),
  ];
  const from = overrides.from ?? FROM_EXPRESSION;
  const to = overrides.to ?? TO_EXPRESSION;
  if (from !== "") {
    triples.push(
      new Triple(
        grounding,
        Namespace.EXOCMD.term("Grounding_replaceFromExpression"),
        new Literal(from),
      ),
    );
  }
  if (to !== "") {
    triples.push(
      new Triple(
        grounding,
        Namespace.EXOCMD.term("Grounding_replaceToExpression"),
        new Literal(to),
      ),
    );
  }

  const command = new IRI(`obsidian://vault/${COMMAND_UID}.md`);
  triples.push(
    new Triple(
      command,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    ),
    new Triple(
      command,
      Namespace.EXO.term("Asset_uid"),
      new Literal(COMMAND_UID),
    ),
    new Triple(
      command,
      Namespace.EXO.term("Asset_label"),
      new Literal("Swap one class"),
    ),
    new Triple(
      command,
      Namespace.EXOCMD.term("Command_grounding"),
      new IRI(`obsidian://vault/${GROUNDING_UID}.md`),
    ),
  );

  await store.addAll(triples);
}

describe("CommandResolver — property_replace loader parity (@req:02de55a4-0a07-4347-b434-bb4a48eb0163)", () => {
  let store: InMemoryTripleStore;
  let logger: RecordingLogger;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    logger = makeRecordingLogger();
    resolver = new CommandResolver(store, logger);
  });

  it("P1 the PRODUCTION loader carries replaceFromExpression off the triple store", async () => {
    await seedPropertyReplaceCommand(store);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd).not.toBeNull();
    expect(cmd!.grounding.replaceFromExpression).toBe(FROM_EXPRESSION);
  });

  it("P2 the PRODUCTION loader carries replaceToExpression off the triple store", async () => {
    await seedPropertyReplaceCommand(store);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.replaceToExpression).toBe(TO_EXPRESSION);
  });

  it("P3 the catalog UID resolves to GroundingType.PROPERTY_REPLACE in production", async () => {
    // Without this the grounding is inert (type === null → command dropped),
    // so P1/P2 would pass on a definition the dispatcher never executes.
    await seedPropertyReplaceCommand(store);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.type).toBe(GroundingType.PROPERTY_REPLACE);
    expect(cmd!.grounding.targetProperty).toBe("exo__Instance_class");
    expect(logger.warnings).toHaveLength(0);
  });

  it("P4 BOTH loaders agree on the same source record — neither is left behind", async () => {
    await seedPropertyReplaceCommand(store);
    const production = (await resolver.loadCommand(COMMAND_UID))!.grounding;

    // Same record as raw frontmatter → the frontmatter loader.
    const bdd: GroundingDefinition = parseGroundingDefinitionFromFrontmatter(
      GROUNDING_UID,
      {
        exo__Asset_label: "Swap one class",
        exocmd__Grounding_type: `[[${PROPERTY_REPLACE_TYPE_UID}]]`,
        exocmd__Grounding_targetProperty: "exo__Instance_class",
        exocmd__Grounding_replaceFromExpression: FROM_EXPRESSION,
        exocmd__Grounding_replaceToExpression: TO_EXPRESSION,
      },
      () => {
        throw new Error("composite step resolution not expected here");
      },
    );

    expect(bdd.type).toBe(production.type);
    expect(bdd.targetProperty).toBe(production.targetProperty);
    expect(bdd.replaceFromExpression).toBe(production.replaceFromExpression);
    expect(bdd.replaceToExpression).toBe(production.replaceToExpression);
    // ⛔ Pin the VALUE too: two loaders that both return `undefined` also
    // "agree", and that is exactly the dead-in-production state this axis
    // exists to exclude.
    expect(production.replaceFromExpression).toBe(FROM_EXPRESSION);
    expect(production.replaceToExpression).toBe(TO_EXPRESSION);
  });

  it("P5 a missing predicate stays undefined rather than becoming an empty string", async () => {
    // The executor's guards key on `undefined`/falsy; a loader that manufactured
    // "" would slip past them and reach the list walk with an unmatchable value.
    await seedPropertyReplaceCommand(store, { to: "" });

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.replaceFromExpression).toBe(FROM_EXPRESSION);
    expect(cmd!.grounding.replaceToExpression).toBeUndefined();
  });
});

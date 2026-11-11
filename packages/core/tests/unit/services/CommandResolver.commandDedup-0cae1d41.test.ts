/**
 * vault-exodev ems__Bug 0cae1d41 — one command, one entry.
 *
 * An asset declaring two bound classes (`ems__Action` + `jedi2__Task`) matched
 * two bindings of the same command («Set blocker»), and
 * `resolveForAssetMulti` returned the command twice — so the plugin drew two
 * buttons with one React key and `resolve-buttons` listed it twice in
 * `visible`. Founder decision 2026-11-11: «one command — one button», fixed in
 * the engine. The resolver now keeps ONE entry per command: the best-ranked
 * binding by the same (priority, depth, order) key that already decides the
 * position, ties broken by the smaller `binding.id`; it runs after override
 * removal and keeps the position of the command's first entry.
 *
 * Axis names are the FIRST token after `›` (mutant-driver `red_re`).
 *
 * Fixture shape mirrors production (test-fixture-realism): file-IRI subjects,
 * `Class_superClass` objects as namespace IRIs, symbolic `targetClass`
 * literals, `order` as a string literal, `overrides` as `[[uid]]` literals.
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// TBox: exo__Asset ⊐ ems__Effort ⊐ ems__Task (real UIDs).
const ASSET_UID = "493c2ae2-de56-47ec-954d-2eb8cb49bff7";
const EFFORT_UID = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

const TARGET = "obsidian://vault/0cae/target.md";

async function seedClass(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
  superClassLabel?: string,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/assetspaces/ems/${uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ];
  if (superClassLabel) {
    const parsed = Namespace.fromPropertyKey(superClassLabel);
    if (parsed) {
      triples.push(
        new Triple(
          subject,
          Namespace.EXO.term("Class_superClass"),
          parsed.namespace.term(parsed.localName),
        ),
      );
    }
  }
  await store.addAll(triples);
}

async function addCommand(
  store: InMemoryTripleStore,
  uid: string,
  name: string,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  const gnd = new IRI(`obsidian://vault/gnd-${uid}.md`);
  await store.addAll([
    new Triple(gnd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(gnd, Namespace.EXO.term("Asset_uid"), new Literal(`gnd-${uid}`)),
    new Triple(gnd, Namespace.EXO.term("Asset_label"), new Literal(`G ${uid}`)),
    new Triple(
      gnd,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal("[[cf3bb923-f1f1-40be-b728-782844402426]]"),
    ),
    new Triple(gnd, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal("ems__Effort_status")),
    new Triple(gnd, Namespace.EXOCMD.term("Grounding_targetValue"), new Literal("done")),
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(name)),
    new Triple(subject, Namespace.EXOCMD.term("Command_grounding"), gnd),
  ]);
}

async function addBinding(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    commandRef: string;
    targetClass?: string;
    targetAsset?: string;
    order?: number;
    /** Raw `CommandBinding_order` literal (wins over `order`). */
    orderRaw?: string;
    overrides?: string[];
    /** Reference the command as a `[[uid]]` literal instead of a file IRI. */
    commandAsLiteral?: boolean;
    label?: string;
    /** UID of a binding-level precondition. */
    precondition?: string;
    /** Inline `CommandBinding_variant` shorthand. */
    variant?: string;
  },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label ?? `B ${opts.uid}`)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("CommandBinding_command"),
      opts.commandAsLiteral
        ? new Literal(`[[${opts.commandRef}]]`)
        : new IRI(`obsidian://vault/${opts.commandRef}.md`),
    ),
  ];
  if (opts.targetClass) {
    triples.push(
      new Triple(subject, Namespace.EXOCMD.term("CommandBinding_targetClass"), new Literal(opts.targetClass)),
    );
  }
  if (opts.targetAsset) {
    triples.push(
      new Triple(subject, Namespace.EXOCMD.term("CommandBinding_targetAsset"), new Literal(opts.targetAsset)),
    );
  }
  if (opts.orderRaw !== undefined || opts.order !== undefined) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("CommandBinding_order"),
        new Literal(opts.orderRaw ?? String(opts.order)),
      ),
    );
  }
  if (opts.variant) {
    triples.push(
      new Triple(subject, Namespace.EXOCMD.term("CommandBinding_variant"), new Literal(opts.variant)),
    );
  }
  if (opts.precondition) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("CommandBinding_precondition"),
        new IRI(`obsidian://vault/${opts.precondition}.md`),
      ),
    );
  }
  for (const ov of opts.overrides ?? []) {
    triples.push(
      new Triple(subject, Namespace.EXOCMD.term("CommandBinding_overrides"), new Literal(`[[${ov}]]`)),
    );
  }
  await store.addAll(triples);
}

/** A grounding of its own (optionally picked by `Grounding_targetPrototype`). */
async function addGrounding(
  store: InMemoryTripleStore,
  uid: string,
  targetPrototype?: string,
): Promise<IRI> {
  const g = new IRI(`obsidian://vault/${uid}.md`);
  const triples: Triple[] = [
    new Triple(g, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(g, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(g, Namespace.EXO.term("Asset_label"), new Literal(`G ${uid}`)),
    new Triple(
      g,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal("[[cf3bb923-f1f1-40be-b728-782844402426]]"),
    ),
    new Triple(g, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal("ems__Effort_status")),
    new Triple(g, Namespace.EXOCMD.term("Grounding_targetValue"), new Literal(uid)),
  ];
  if (targetPrototype) {
    triples.push(
      new Triple(g, Namespace.EXOCMD.term("Grounding_targetPrototype"), new Literal(targetPrototype)),
    );
  }
  await store.addAll(triples);
  return g;
}

/** A command with several groundings (the per-`targetClass` pattern). */
async function addMultiGroundingCommand(
  store: InMemoryTripleStore,
  uid: string,
  groundings: IRI[],
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(`N ${uid}`)),
  ];
  for (const g of groundings) {
    triples.push(new Triple(subject, Namespace.EXOCMD.term("Command_grounding"), g));
  }
  await store.addAll(triples);
}

async function addPrecondition(store: InMemoryTripleStore, uid: string): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Precondition")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(`P ${uid}`)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Precondition_sparqlAsk"),
      new Literal('ASK { $target <https://exocortex.my/ontology/exo#Asset_label> "never (fixture)" }'),
    ),
  ]);
}

function spyLogger(): { warn: jest.Mock; logger: ConstructorParameters<typeof CommandResolver>[1] } {
  const warn = jest.fn();
  return {
    warn,
    logger: { debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() } as unknown as ConstructorParameters<
      typeof CommandResolver
    >[1],
  };
}

/** A `CommandBindingStyle` asset with the given style properties. */
async function addStyleAsset(
  store: InMemoryTripleStore,
  uid: string,
  props: { showIcon?: string; variant?: string },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBindingStyle")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(`St ${uid}`)),
  ];
  if (props.showIcon !== undefined) {
    triples.push(
      new Triple(subject, Namespace.EXOCMD.term("CommandBindingStyle_showIcon"), new Literal(props.showIcon)),
    );
  }
  if (props.variant !== undefined) {
    triples.push(
      new Triple(subject, Namespace.EXOCMD.term("CommandBindingStyle_variant"), new Literal(props.variant)),
    );
  }
  await store.addAll(triples);
}

/** Link a binding to a style asset (`CommandBinding_style`). */
async function linkStyle(store: InMemoryTripleStore, bindingUid: string, styleUid: string): Promise<void> {
  await store.addAll([
    new Triple(
      new IRI(`obsidian://vault/${bindingUid}.md`),
      Namespace.EXOCMD.term("CommandBinding_style"),
      new IRI(`obsidian://vault/${styleUid}.md`),
    ),
  ]);
}

/** Give an existing command a command-level precondition. */
async function setCommandPrecondition(store: InMemoryTripleStore, commandUid: string, pre: string): Promise<void> {
  await store.addAll([
    new Triple(
      new IRI(`obsidian://vault/${commandUid}.md`),
      Namespace.EXOCMD.term("Command_precondition"),
      new IRI(`obsidian://vault/${pre}.md`),
    ),
  ]);
}

/** Divergence reports of this fix among the logger's warnings. */
function dedupReports(warn: jest.Mock): string[] {
  return warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("0cae1d41"));
}

/** `[commandId, bindingId]` pairs in result order. */
function pairs(
  resolved: Array<{ command: { id: string }; binding: { id: string } }>,
): string[][] {
  return resolved.map((rc) => [rc.command.id, rc.binding.id]);
}

describe("CommandResolver — one command, one entry (ems__Bug 0cae1d41)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    await seedClass(store, ASSET_UID, "exo__Asset");
    await seedClass(store, EFFORT_UID, "ems__Effort", "exo__Asset");
    await seedClass(store, TASK_UID, "ems__Task", "ems__Effort");
    resolver = new CommandResolver(store);
  });

  it("D1 two bindings of one command on two classes of one asset yield ONE entry", async () => {
    await addCommand(store, "cmd-blocker", "Set blocker");
    await addBinding(store, { uid: "bind-act", commandRef: "cmd-blocker", targetClass: "test__Act", order: 217 });
    await addBinding(store, { uid: "bind-dt", commandRef: "cmd-blocker", targetClass: "test__Dt", order: 217 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__Act", "test__Dt"]);

    expect(resolved.map((rc) => rc.command.id)).toEqual(["cmd-blocker"]);
  });

  it("D2 the nearest class wins over a better order on an ancestor class", async () => {
    await addCommand(store, "cmd-s", "S");
    // Task binding: depth 0, order 300. Effort binding: depth 1, order 100.
    await addBinding(store, { uid: "bind-task", commandRef: "cmd-s", targetClass: "ems__Task", order: 300 });
    await addBinding(store, { uid: "bind-effort", commandRef: "cmd-s", targetClass: "ems__Effort", order: 100 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, [TASK_UID]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-task"]]);
  });

  it("D3 at the same depth the lower order wins", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 300 });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-b"]]);
  });

  it("D4 on a full tie the smaller binding.id wins whatever the class order (cold and cached)", async () => {
    await addCommand(store, "cmd-s", "S");
    // The binding with the LARGER id is on the class listed first.
    await addBinding(store, { uid: "bind-z", commandRef: "cmd-s", targetClass: "test__A", order: 217 });
    await addBinding(store, { uid: "bind-m", commandRef: "cmd-s", targetClass: "test__B", order: 217 });

    const coldAB = await new CommandResolver(store).resolveForAssetMulti(TARGET, ["test__A", "test__B"]);
    const coldBA = await new CommandResolver(store).resolveForAssetMulti(TARGET, ["test__B", "test__A"]);
    const warmAB = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);
    const warmBA = await resolver.resolveForAssetMulti(TARGET, ["test__B", "test__A"]);

    for (const r of [coldAB, coldBA, warmAB, warmBA]) {
      expect(pairs(r)).toEqual([["cmd-s", "bind-m"]]);
    }
  });

  it("D5 the collapsed command keeps its first position; the order of other commands is unchanged", async () => {
    await addCommand(store, "cmd-x", "X");
    await addCommand(store, "cmd-s", "S");
    await addCommand(store, "cmd-y", "Y");
    await addBinding(store, { uid: "bind-x", commandRef: "cmd-x", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-s-a", commandRef: "cmd-s", targetClass: "test__A", order: 200 });
    await addBinding(store, { uid: "bind-s-b", commandRef: "cmd-s", targetClass: "test__B", order: 50 });
    await addBinding(store, { uid: "bind-y", commandRef: "cmd-y", targetClass: "test__B", order: 150 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([
      ["cmd-s", "bind-s-b"],
      ["cmd-x", "bind-x"],
      ["cmd-y", "bind-y"],
    ]);
  });

  it("D6 an overriding binding survives — override removal runs before the command dedup", async () => {
    await addCommand(store, "cmd-s", "S");
    // bind-s1 ranks better (order 50) but is overridden by bind-s2.
    await addBinding(store, { uid: "bind-s1", commandRef: "cmd-s", targetClass: "test__A", order: 50 });
    await addBinding(store, {
      uid: "bind-s2",
      commandRef: "cmd-s",
      targetClass: "test__B",
      order: 100,
      overrides: ["bind-s1"],
    });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-s2"]]);
  });

  it("D7 two different commands with the same name are NOT collapsed", async () => {
    await addCommand(store, "cmd-one", "Set blocker");
    await addCommand(store, "cmd-two", "Set blocker");
    await addBinding(store, { uid: "bind-one", commandRef: "cmd-one", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-two", commandRef: "cmd-two", targetClass: "test__B", order: 200 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([
      ["cmd-one", "bind-one"],
      ["cmd-two", "bind-two"],
    ]);
  });

  it("D8 control — an asset with ONE bound class gets every matching command, in order", async () => {
    await addCommand(store, "cmd-x", "X");
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-x", commandRef: "cmd-x", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-s-a", commandRef: "cmd-s", targetClass: "test__A", order: 200 });
    await addBinding(store, { uid: "bind-s-b", commandRef: "cmd-s", targetClass: "test__B", order: 50 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A"]);

    expect(pairs(resolved)).toEqual([
      ["cmd-x", "bind-x"],
      ["cmd-s", "bind-s-a"],
    ]);
  });

  it("D9 a targetAsset binding (priority 0) wins over a class binding with a better order", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-class", commandRef: "cmd-s", targetClass: "test__A", order: 1 });
    await addBinding(store, { uid: "bind-asset", commandRef: "cmd-s", targetAsset: TARGET, order: 900 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-asset"]]);
  });

  it("D10 a command referenced as a [[uid]] literal and as a file IRI is still one command", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-iri", commandRef: "cmd-s", targetClass: "test__A", order: 100 });
    await addBinding(store, {
      uid: "bind-lit",
      commandRef: "cmd-s",
      targetClass: "test__B",
      order: 100,
      commandAsLiteral: true,
    });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-iri"]]);
  });

  it("D11 three classes binding one command, plus a second command on two of them, yield one entry each", async () => {
    // Mirrors the measured ems__Action + ems__Task + jedi2__Task case.
    await addCommand(store, "cmd-blocker", "Set blocker");
    await addCommand(store, "cmd-votes", "Set votes");
    for (const [uid, cls] of [
      ["bind-b-act", "test__Act"],
      ["bind-b-task", "test__Task"],
      ["bind-b-dt", "test__Dt"],
    ]) {
      await addBinding(store, { uid, commandRef: "cmd-blocker", targetClass: cls, order: 217 });
    }
    await addBinding(store, { uid: "bind-v-act", commandRef: "cmd-votes", targetClass: "test__Act", order: 447 });
    await addBinding(store, { uid: "bind-v-task", commandRef: "cmd-votes", targetClass: "test__Task", order: 446 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__Act", "test__Task", "test__Dt"]);

    expect(pairs(resolved)).toEqual([
      ["cmd-blocker", "bind-b-act"],
      ["cmd-votes", "bind-v-task"],
    ]);
  });

  // D12–D18 — axes from the independent review (2026-11-11): each locks a
  // plausible wrong implementation that passed D1–D11.

  it("D12 equal order: the nearer class wins although the ancestor binding has the smaller id", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-z-task", commandRef: "cmd-s", targetClass: "ems__Task", order: 100 });
    await addBinding(store, { uid: "bind-a-effort", commandRef: "cmd-s", targetClass: "ems__Effort", order: 100 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, [TASK_UID]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-z-task"]]);
  });

  it("D13 a full-tie survivor that comes later keeps the FIRST position of its command", async () => {
    await addCommand(store, "cmd-s", "S");
    await addCommand(store, "cmd-x", "X");
    await addBinding(store, { uid: "bind-z", commandRef: "cmd-s", targetClass: "test__A" });
    await addBinding(store, { uid: "bind-x", commandRef: "cmd-x", targetClass: "test__A" });
    await addBinding(store, { uid: "bind-m", commandRef: "cmd-s", targetClass: "test__B" });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([
      ["cmd-s", "bind-m"],
      ["cmd-x", "bind-x"],
    ]);
  });

  it("D14 tied DIFFERENT commands keep their order — no new sort key", async () => {
    await addCommand(store, "cmd-x", "X");
    await addCommand(store, "cmd-y", "Y");
    // The first command's binding has the LARGER id; a sort by binding.id would swap them.
    await addBinding(store, { uid: "bind-z", commandRef: "cmd-x", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-y", targetClass: "test__A", order: 100 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A"]);

    expect(pairs(resolved)).toEqual([
      ["cmd-x", "bind-z"],
      ["cmd-y", "bind-a"],
    ]);
  });

  it("D15 the full-tie break is the binding uid, not its editable label", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 100, label: "Zeta" });
    await addBinding(store, { uid: "bind-z", commandRef: "cmd-s", targetClass: "test__B", order: 100, label: "Alpha" });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__B", "test__A"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-a"]]);
  });

  it("D16 the survivor carries its OWN grounding, picked by its targetClass", async () => {
    const ga = await addGrounding(store, "g-a", "test__A");
    const gb = await addGrounding(store, "g-b", "test__B");
    await addMultiGroundingCommand(store, "cmd-c", [ga, gb]);
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-c", targetClass: "test__B", order: 100 });
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-c", targetClass: "test__A", order: 100 });

    const resolved = await new CommandResolver(store, spyLogger().logger).resolveForAssetMulti(TARGET, [
      "test__B",
      "test__A",
    ]);

    expect(pairs(resolved)).toEqual([["cmd-c", "bind-a"]]);
    expect(resolved[0].command.grounding.id).toBe("g-a");
  });

  it("D17 equal order and depth: a targetAsset binding wins although the class binding has the smaller id", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-a-class", commandRef: "cmd-s", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-z-asset", commandRef: "cmd-s", targetAsset: TARGET, order: 100 });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-z-asset"]]);
  });

  it("D18 a [[uid]]-literal reference is the SAME command and can be the survivor", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-z-iri", commandRef: "cmd-s", targetClass: "test__A", order: 100 });
    await addBinding(store, {
      uid: "bind-a-lit",
      commandRef: "cmd-s",
      targetClass: "test__B",
      order: 100,
      commandAsLiteral: true,
    });

    const resolved = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-a-lit"]]);
  });

  it("D19 a non-numeric order ranks as the default 100 — the tie break still decides (cold and cached)", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-z", commandRef: "cmd-s", targetClass: "test__A", orderRaw: "abc" });
    await addBinding(store, { uid: "bind-m", commandRef: "cmd-s", targetClass: "test__B", order: 100 });

    const coldAB = await new CommandResolver(store).resolveForAssetMulti(TARGET, ["test__A", "test__B"]);
    const coldBA = await new CommandResolver(store).resolveForAssetMulti(TARGET, ["test__B", "test__A"]);
    const warmAB = await resolver.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);
    const warmBA = await resolver.resolveForAssetMulti(TARGET, ["test__B", "test__A"]);

    for (const r of [coldAB, coldBA, warmAB, warmBA]) {
      expect(pairs(r)).toEqual([["cmd-s", "bind-m"]]);
    }
  });

  it("D20 the survivor's binding-level precondition is the entry's precondition", async () => {
    await addCommand(store, "cmd-s", "S");
    await addPrecondition(store, "pre-never");
    // bind-a (smaller id) carries its own precondition; bind-b has none.
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 100, precondition: "pre-never" });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100 });

    const resolved = await new CommandResolver(store, spyLogger().logger).resolveForAssetMulti(TARGET, [
      "test__A",
      "test__B",
    ]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-a"]]);
    expect(resolved[0].command.precondition?.id).toBe("pre-never");
  });

  it("D21 a dropped binding that would act differently is reported once, naming both bindings", async () => {
    await addCommand(store, "cmd-s", "S");
    await addPrecondition(store, "pre-never");
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 100, precondition: "pre-never" });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100 });
    const { warn, logger } = spyLogger();
    const r = new CommandResolver(store, logger);

    await r.resolveForAssetMulti(TARGET, ["test__A", "test__B"]);
    await r.resolveForAssetMulti("obsidian://vault/0cae/other.md", ["test__A", "test__B"]);

    const reports = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("0cae1d41"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("bind-a");
    expect(reports[0]).toContain("bind-b");
    expect(reports[0]).toContain("precondition");
  });

  it("D22 interchangeable bindings collapse silently", async () => {
    await addCommand(store, "cmd-blocker", "Set blocker");
    await addBinding(store, { uid: "bind-act", commandRef: "cmd-blocker", targetClass: "test__Act", order: 217 });
    await addBinding(store, { uid: "bind-dt", commandRef: "cmd-blocker", targetClass: "test__Dt", order: 217 });
    const { warn, logger } = spyLogger();

    const resolved = await new CommandResolver(store, logger).resolveForAssetMulti(TARGET, ["test__Act", "test__Dt"]);

    expect(resolved).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("0cae1d41"))).toHaveLength(0);
  });

  it("D23 a dropped binding with another grounding is reported, naming the field", async () => {
    const ga = await addGrounding(store, "g-a", "test__A");
    const gb = await addGrounding(store, "g-b", "test__B");
    await addMultiGroundingCommand(store, "cmd-c", [ga, gb]);
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-c", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-c", targetClass: "test__B", order: 100 });
    const { warn, logger } = spyLogger();

    await new CommandResolver(store, logger).resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    const reports = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("0cae1d41"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("grounding");
  });

  it("D24 two bindings with the same inline variant are interchangeable — no report", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 100, variant: "danger" });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100, variant: "danger" });
    const { warn, logger } = spyLogger();

    const resolved = await new CommandResolver(store, logger).resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-a"]]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("0cae1d41"))).toHaveLength(0);
  });

  it("D25 a dropped binding with another variant is reported, naming the field", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100, variant: "danger" });
    const { warn, logger } = spyLogger();

    await new CommandResolver(store, logger).resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    const reports = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("0cae1d41"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("variant");
  });

  // D26–D31 — plausible wrong implementations found by the independent review
  // of the specification (2026-11-11) that passed D1–D25: each axis locks one.

  it("D26 a dropped binding that differs only by a linked style property is reported, naming style", async () => {
    await addCommand(store, "cmd-s", "S");
    await addStyleAsset(store, "style-noicon", { showIcon: "false" });
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100 });
    await linkStyle(store, "bind-b", "style-noicon");
    const { warn, logger } = spyLogger();

    const resolved = await new CommandResolver(store, logger).resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-a"]]);
    const reports = dedupReports(warn);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("style");
  });

  it("D27 a dropped binding whose linked style differs only in the style's own variant is reported, naming style", async () => {
    await addCommand(store, "cmd-s", "S");
    await addStyleAsset(store, "style-primary", { variant: "primary" });
    await addStyleAsset(store, "style-warning", { variant: "warning" });
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100 });
    await linkStyle(store, "bind-a", "style-primary");
    await linkStyle(store, "bind-b", "style-warning");
    const { warn, logger } = spyLogger();

    const resolved = await new CommandResolver(store, logger).resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-a"]]);
    expect(resolved[0].binding.variant).toBeUndefined();
    const reports = dedupReports(warn);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("style");
  });

  it("D28 a three-way full tie keeps the smallest binding.id whatever the class order (cold)", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-c", commandRef: "cmd-s", targetClass: "test__A", order: 100 });
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__B", order: 100 });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__C", order: 100 });

    for (const classes of [
      ["test__A", "test__B", "test__C"],
      ["test__C", "test__A", "test__B"],
      ["test__B", "test__C", "test__A"],
    ]) {
      const resolved = await new CommandResolver(store).resolveForAssetMulti(TARGET, classes);
      expect(pairs(resolved)).toEqual([["cmd-s", "bind-a"]]);
    }
  });

  it("D29 the divergence report names the FINAL survivor when the survivor is replaced twice", async () => {
    await addCommand(store, "cmd-s", "S");
    await addPrecondition(store, "pre-never");
    await addBinding(store, {
      uid: "bind-c",
      commandRef: "cmd-s",
      targetClass: "test__A",
      order: 100,
      precondition: "pre-never",
    });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100 });
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__C", order: 100 });
    const { warn, logger } = spyLogger();

    const resolved = await new CommandResolver(store, logger).resolveForAssetMulti(TARGET, [
      "test__A",
      "test__B",
      "test__C",
    ]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-a"]]);
    const reports = dedupReports(warn);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("binding bind-a surfaces, binding bind-c is dropped");
  });

  it("D30 the same EFFECTIVE precondition (binding-level equals command-level) is not a divergence", async () => {
    await addCommand(store, "cmd-s", "S");
    await addPrecondition(store, "pre-p");
    await setCommandPrecondition(store, "cmd-s", "pre-p");
    await addBinding(store, {
      uid: "bind-a",
      commandRef: "cmd-s",
      targetClass: "test__A",
      order: 100,
      precondition: "pre-p",
    });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__B", order: 100 });
    const { warn, logger } = spyLogger();

    const resolved = await new CommandResolver(store, logger).resolveForAssetMulti(TARGET, ["test__A", "test__B"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-a"]]);
    expect(resolved[0].command.precondition?.id).toBe("pre-p");
    expect(dedupReports(warn)).toHaveLength(0);
  });

  it("D31 two bindings of one command on the SAME class yield one entry — the better order", async () => {
    await addCommand(store, "cmd-s", "S");
    await addBinding(store, { uid: "bind-a", commandRef: "cmd-s", targetClass: "test__A", order: 200 });
    await addBinding(store, { uid: "bind-b", commandRef: "cmd-s", targetClass: "test__A", order: 100 });

    const resolved = await new CommandResolver(store).resolveForAssetMulti(TARGET, ["test__A"]);

    expect(pairs(resolved)).toEqual([["cmd-s", "bind-b"]]);
  });
});

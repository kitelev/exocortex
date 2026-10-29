/**
 * RFC 9821a379 §Шаг 2 — the `query-table` row provider (ticket 058bad52):
 * AC5 (cells, columns), AC7 (unset token), AC10 (time), AC11 (errors as
 * outcomes). Production shape: the REAL core `NamedQueryRunner` over a REAL
 * `InMemoryTripleStore`; only the body resolver and the vault lookups are fakes.
 *
 * revert-verify: `QueryTableProvider.spec.json`.
 */
import {
  BlankNode,
  IRI,
  InMemoryTripleStore,
  Literal,
  NamedQueryRunner,
  Triple,
  type IQueryBodyResolver,
  type QueryTableBlock,
} from "@kitelev/exocortex-core";
import {
  createQueryTableProvider,
  describeQueryTableProblem,
  type QueryTableOutcome,
} from "../../../../../src/presentation/renderers/layout/QueryTableProvider";

const EXO = "https://exocortex.my/ontology/exo#";
const LIFE = "https://exocortex.my/ontology/life#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const DAY = "obsidian://vault/notes/2026-08-10%20Note.md";
const EP1 = "obsidian://vault/my/ep-1.md";
const EP2 = "obsidian://vault/my/ep-2.md";
const GONE = "obsidian://vault/my/gone.md";

class MapBodies implements IQueryBodyResolver {
  constructor(private readonly bodies: Record<string, string>) {}
  async resolveSparql(uid: string): Promise<string | null> {
    return this.bodies[uid] ?? null;
  }
}

function store(): InMemoryTripleStore {
  const s = new InMemoryTripleStore();
  const add = (o: string, p: string, v: IRI | Literal) =>
    s.add(new Triple(new IRI(o), new IRI(p), v));
  add(DAY, `${EXO}Asset_label`, new Literal("Day 10"));
  add(EP1, `${EXO}Instance_class`, new IRI(`${LIFE}Episode`));
  add(
    EP1,
    `${LIFE}Episode_startTimestamp`,
    new Literal("2026-08-10T07:00:00", new IRI(`${XSD}dateTime`)),
  );
  add(EP2, `${EXO}Instance_class`, new IRI(`${LIFE}Episode`));
  add(
    EP2,
    `${LIFE}Episode_start`,
    new Literal("2026-08-09", new IRI(`${XSD}date`)),
  );
  add(GONE, `${EXO}Instance_class`, new IRI(`${LIFE}Episode`));
  return s;
}

function block(query: string, limit = 100): QueryTableBlock {
  return {
    kind: "query-table",
    uid: "blk",
    title: "Эпизоды дня",
    collapsed: false,
    layoutRef: "L",
    order: 1,
    sourcePath: "blk.md",
    query,
    limit,
    emptyText: "Эпизодов нет",
  } as QueryTableBlock;
}

function provider(
  bodies: Record<string, string>,
  extra: { now?: () => number } = {},
) {
  const runner = new NamedQueryRunner(new MapBodies(bodies), store());
  return createQueryTableProvider({
    runner,
    queryLabel: (uid) =>
      uid === "q-known" ? "Эпизоды, покрывающие день" : null,
    createLinkText: () => (path) =>
      path === "my/ep-1.md"
        ? "🔄 Утро"
        : path === "my/ep-2.md"
          ? "Вечер"
          : null,
    now: extra.now,
  });
}

const page = { path: "notes/2026-08-10 Note.md" };

function rows(outcome: QueryTableOutcome) {
  if (outcome.kind !== "rows")
    throw new Error(`expected rows, got ${outcome.kind}`);
  return outcome;
}

describe("QueryTableProvider (RFC 9821a379, ticket 058bad52)", () => {
  it("P1 @req:23f10730-82f7-4037-b566-da79d5fa3378 columns follow the SELECT projection, not the order the query binds them", async () => {
    const p = provider({
      "q-known": `SELECT ?Конец ?Начало WHERE { BIND("a" AS ?Начало) BIND("b" AS ?Конец) }`,
    });
    const out = rows(await p(page, block("q-known")));
    expect(out.columns).toEqual(["Конец", "Начало"]);
    expect(out.rows).toEqual([
      [
        { kind: "text", text: "b" },
        { kind: "text", text: "a" },
      ],
    ]);
  });

  it("P2 @req:23f10730-82f7-4037-b566-da79d5fa3378 an existing vault asset is a link with its display name; a missing one and a non-vault IRI are text", async () => {
    const p = provider({
      "q-known": `SELECT ?e ?k WHERE { ?e <${EXO}Instance_class> ?k } ORDER BY ?e`,
    });
    const out = rows(await p(page, block("q-known")));
    expect(out.rows).toEqual([
      [
        { kind: "link", path: "my/ep-1.md", text: "🔄 Утро" },
        { kind: "text", text: "life__Episode" },
      ],
      [
        { kind: "link", path: "my/ep-2.md", text: "Вечер" },
        { kind: "text", text: "life__Episode" },
      ],
      [
        { kind: "text", text: "gone" },
        { kind: "text", text: "life__Episode" },
      ],
    ]);
  });

  it("P11 @req:23f10730-82f7-4037-b566-da79d5fa3378 a literal keeps its lexical form (a timestamp and a date as written); unbound is empty", async () => {
    const p = provider({
      "q-known": [
        `SELECT ?t ?d WHERE {`,
        `  ?e <${EXO}Instance_class> ?k .`,
        `  OPTIONAL { ?e <${LIFE}Episode_startTimestamp> ?t }`,
        `  OPTIONAL { ?e <${LIFE}Episode_start> ?d }`,
        `} ORDER BY ?e`,
      ].join("\n"),
    });
    const out = rows(await p(page, block("q-known")));
    expect(out.rows).toEqual([
      [
        { kind: "text", text: "2026-08-10T07:00:00" },
        { kind: "text", text: "" },
      ],
      [
        { kind: "text", text: "" },
        { kind: "text", text: "2026-08-09" },
      ],
      [
        { kind: "text", text: "" },
        { kind: "text", text: "" },
      ],
    ]);
  });

  it("P3 @req:23f10730-82f7-4037-b566-da79d5fa3378 the block limit caps the rows; total keeps the full count", async () => {
    const p = provider({
      "q-known": `SELECT ?e WHERE { ?e <${EXO}Instance_class> ?k } ORDER BY ?e`,
    });
    const out = rows(await p(page, block("q-known", 2)));
    expect(out.rows).toHaveLength(2);
    expect(out.total).toBe(3);
  });

  it("P4 @req:23f10730-82f7-4037-b566-da79d5fa3378 a $token with no value is refused — not evaluated (bypass of 2bc09942)", async () => {
    const p = provider({
      "q-known": `SELECT ?e WHERE { ?e <${EXO}Instance_class> ?k . FILTER(?k != $kind) }`,
    });
    const out = await p(page, block("q-known"));
    expect(out).toEqual({
      kind: "unset-token",
      queryLabel: "Эпизоды, покрывающие день",
      tokens: ["kind"],
    });
  });

  it("P5 @req:23f10730-82f7-4037-b566-da79d5fa3378 $currentAsset is the IRI of the open page", async () => {
    const p = provider({
      "q-known": `SELECT ?l WHERE { $currentAsset <${EXO}Asset_label> ?l }`,
    });
    const out = rows(await p(page, block("q-known")));
    expect(out.rows).toEqual([[{ kind: "text", text: "Day 10" }]]);
  });

  it("P6 @req:23f10730-82f7-4037-b566-da79d5fa3378 an UPDATE body, a missing body and an ASK become outcomes named by the query label, never a throw", async () => {
    const p = provider({
      "q-known": `DELETE WHERE { ?s ?p ?o }`,
      "q-ask": `ASK { ?s ?p ?o }`,
    });
    const update = await p(page, block("q-known"));
    expect(update.kind).toBe("error");
    expect(update.queryLabel).toBe("Эпизоды, покрывающие день");
    expect(await p(page, block("q-missing"))).toEqual({
      kind: "not-found",
      queryLabel: "q-missing",
    });
    expect(await p(page, block("q-ask"))).toEqual({
      kind: "not-select",
      queryLabel: "q-ask",
      resultKind: "ask",
    });
  });

  it("P7 @req:23f10730-82f7-4037-b566-da79d5fa3378 the time covers the query and the cells (AC10)", async () => {
    // A clock that advances only inside the cell building (+12).
    let t = 1000;
    const runner = new NamedQueryRunner(
      new MapBodies({
        "q-known": `SELECT ?e WHERE { ?e <${EXO}Instance_class> ?k }`,
      }),
      store(),
    );
    const p = createQueryTableProvider({
      runner,
      queryLabel: () => "Эпизоды",
      createLinkText: () => {
        t += 12;
        return () => null;
      },
      now: () => t,
    });
    expect(rows(await p(page, block("q-known"))).elapsedMs).toBe(12);
  });

  it("P12 @req:23f10730-82f7-4037-b566-da79d5fa3378 the time covers the label lookup too (it builds the uid index the body lookup reuses)", async () => {
    // A clock that advances only inside the label lookup (+30).
    let t = 1000;
    const runner = new NamedQueryRunner(
      new MapBodies({
        "q-known": `SELECT ?e WHERE { ?e <${EXO}Instance_class> ?k }`,
      }),
      store(),
    );
    const p = createQueryTableProvider({
      runner,
      queryLabel: () => {
        t += 30;
        return "Эпизоды";
      },
      createLinkText: () => () => null,
      now: () => t,
    });
    expect(rows(await p(page, block("q-known"))).elapsedMs).toBe(30);
  });

  it("P8 @req:23f10730-82f7-4037-b566-da79d5fa3378 the problem text names the query by its label", () => {
    expect(
      describeQueryTableProblem({
        kind: "unset-token",
        queryLabel: "Q",
        tokens: ["x"],
      }),
    ).toBe("Запрос «Q»: в запросе не задан $x");
    expect(
      describeQueryTableProblem({
        kind: "unset-token",
        queryLabel: "Q",
        tokens: ["a", "b"],
      }),
    ).toBe("Запрос «Q»: в запросе не заданы $a, $b");
    expect(
      describeQueryTableProblem({ kind: "not-found", queryLabel: "Q" }),
    ).toBe("Запрос «Q» не найден или у него нет блока sparql");
    expect(
      describeQueryTableProblem({
        kind: "not-select",
        queryLabel: "Q",
        resultKind: "ask",
      }),
    ).toBe("Запрос «Q»: таблица показывает только SELECT, а запрос — ASK");
    expect(
      describeQueryTableProblem({
        kind: "error",
        queryLabel: "Q",
        message: "boom",
      }),
    ).toBe("Запрос «Q»: boom");
  });
  it("P9 @req:23f10730-82f7-4037-b566-da79d5fa3378 a percent-encoded vault IRI (space, Cyrillic) is decoded to the file path the link opens", async () => {
    const s2 = store();
    const NOTE = "obsidian://vault/notes/%D0%A3%D1%82%D1%80%D0%BE%20ep.md";
    s2.add(
      new Triple(new IRI(NOTE), new IRI(`${EXO}Asset_label`), new Literal("x")),
    );
    const runner = new NamedQueryRunner(
      new MapBodies({ q: `SELECT ?s WHERE { ?s <${EXO}Asset_label> "x" }` }),
      s2,
    );
    const p = createQueryTableProvider({
      runner,
      queryLabel: () => null,
      createLinkText: () => (path) =>
        path === "notes/Утро ep.md" ? "Утро" : null,
    });
    expect(rows(await p(page, block("q"))).rows).toEqual([
      [{ kind: "link", path: "notes/Утро ep.md", text: "Утро" }],
    ]);
  });

  it("P10 @req:23f10730-82f7-4037-b566-da79d5fa3378 a failing label lookup falls back to the uid; a failing link text is an outcome named by the label, never a throw", async () => {
    const runner = new NamedQueryRunner(
      new MapBodies({ q: `SELECT ?e WHERE { ?e <${EXO}Instance_class> ?k }` }),
      store(),
    );
    const noLabel = createQueryTableProvider({
      runner,
      queryLabel: () => {
        throw new Error("index broken");
      },
      createLinkText: () => () => null,
    });
    expect((await noLabel(page, block("q"))).queryLabel).toBe("q");
    const brokenLinks = createQueryTableProvider({
      runner,
      queryLabel: () => "Эпизоды",
      createLinkText: () => () => {
        throw new Error("metadata broken");
      },
    });
    expect(await brokenLinks(page, block("q"))).toEqual({
      kind: "error",
      queryLabel: "Эпизоды",
      message: "metadata broken",
    });
  });

  async function foreignAndBlank(): Promise<QueryTableOutcome> {
    const s = new InMemoryTripleStore();
    const A = new IRI(EP1);
    await s.add(
      new Triple(A, new IRI("http://e.org/p"), new IRI("http://example.org/thing")),
    );
    await s.add(new Triple(A, new IRI("http://e.org/q"), new BlankNode("b0")));
    const runner = new NamedQueryRunner(
      new MapBodies({
        q: "SELECT ?o ?b WHERE { ?s <http://e.org/p> ?o . ?s <http://e.org/q> ?b }",
      }),
      s,
    );
    const p = createQueryTableProvider({
      runner,
      queryLabel: () => "Q",
      createLinkText: () => () => null,
    });
    return p(page, block("q"));
  }

  it("P13 @req:23f10730-82f7-4037-b566-da79d5fa3378 a non-vault IRI with no Obsidian name shows the IRI itself", async () => {
    expect(rows(await foreignAndBlank()).rows[0][0]).toEqual({
      kind: "text",
      text: "http://example.org/thing",
    });
  });

  it("P14 @req:23f10730-82f7-4037-b566-da79d5fa3378 a blank node shows _:id", async () => {
    expect(rows(await foreignAndBlank()).rows[0][1]).toEqual({
      kind: "text",
      text: "_:b0",
    });
  });
});

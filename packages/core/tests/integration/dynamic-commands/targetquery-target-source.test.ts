/**
 * Integration: RDF → CommandResolver → NamedQueryRunner → GroundingExecutor
 * (req faf269bf — `exocmd__Grounding_targetQuery` TARGET-source).
 *
 * A command step could address exactly two things: the click-target, and the
 * asset a previous step created. A REIFIED link is neither — it has to be FOUND
 * from one of its ends. This suite proves the whole requirement end-to-end
 * against a realistic triple store + file system: nothing about the grounding is
 * mocked, `CommandResolver` parses `exocmd__Grounding_targetQuery` for real and
 * the real `NamedQueryRunner` runs the real SPARQL.
 *
 * The fixture mirrors the live consumer (RFC 85fa0652 — agreement audit): a
 * norm, and a separate reified "last audit" statement pointing at it. The
 * command is clicked on the NORM, but the date must land on the STATEMENT.
 *
 * ⛤ The reified link deliberately lives in a DIFFERENT folder from the norm, so
 * addressing it requires a real vault-relative PATH. A basename alone (what the
 * NamedQuery scalar's display `value` carries) could not locate it — which is
 * exactly why the resolver reads the raw `iri` and converts it via
 * `iriToVaultPath`.
 *
 * REVERT-VERIFY (integration-test-revert-verify rule) — one axis per guarantee,
 * each reddening only its own scenario:
 *   - neutralise the `targetQuery` branch in `executePropertySet`
 *       → Scenario 1 RED, Scenario 4 (back-compat) GREEN;
 *   - drop the mutual-exclusivity guard
 *       → Scenario 2 RED;
 *   - let an empty query fall back to the click-target
 *       → Scenario 3 RED.
 *
 * Regression control for the additive `NamedQueryScalar.iri` field: the sibling
 * suite `namedquery-value-source.test.ts` (the `targetValueQuery` VALUE-source,
 * which reads `value`/`kind`) must stay green — it is the contract-change gate.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { NamedQueryRunner } from "../../../src/services/NamedQueryRunner";
import type { IQueryBodyResolver } from "../../../src/interfaces/IQueryBodyResolver";
import type {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../../src/interfaces/IFileSystemAdapter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// -- in-memory fs (mirrors namedquery-value-source.test.ts) --
class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>();
  constructor(initial?: Record<string, string>) {
    if (initial)
      for (const [p, c] of Object.entries(initial)) this.files.set(p, c);
  }
  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`File not found: ${path}`);
    return c;
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async getMarkdownFiles(): Promise<string[]> {
    return Array.from(this.files.keys()).filter((p) => p.endsWith(".md"));
  }
  async createFile(path: string, content: string): Promise<string> {
    this.files.set(path, content);
    return path;
  }
  async updateFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const c = this.files.get(oldPath);
    if (c !== undefined) {
      this.files.set(newPath, c);
      this.files.delete(oldPath);
    }
  }
  get(path: string): string | undefined {
    return this.files.get(path);
  }
}

class MapQueryBodyResolver implements IQueryBodyResolver {
  constructor(private readonly bodies: Record<string, string>) {}
  async resolveSparql(uid: string): Promise<string | null> {
    return this.bodies[uid] ?? null;
  }
}

// -- ABox: a norm, and the reified "last audit" statement about it -----------
// The statement lives in a DIFFERENT folder than the norm on purpose (see the
// header note): only a real path can address it.
const NORM_IRI = "obsidian://vault/agreements/norm-flowers.md";
const NORM_PATH = "agreements/norm-flowers.md";
const LINK_IRI = "obsidian://vault/agreements/audits/last-audit-flowers.md";
const LINK_PATH = "agreements/audits/last-audit-flowers.md";

// A second norm that has NO audit statement — drives Scenario 3.
const UNAUDITED_NORM_IRI = "obsidian://vault/agreements/norm-dishes.md";
const UNAUDITED_NORM_PATH = "agreements/norm-dishes.md";

const AGR = "https://exocortex.my/ontology/agr";
const LAST_AUDIT_OF = `${AGR}#LastAudit_norm`;

const QUERY_UID = "faf10001-0000-4000-8000-0000000000aa";
const CMD_UID = "cmd-confirm-audit";
const GND_QUERY_UID = "gnd-audit-via-targetquery";
const GND_BOTH_UID = "gnd-audit-both-addressings";
const GND_PLAIN_UID = "gnd-audit-no-targetquery";

// property_set grounding-type UID (GroundingTypeUIDs.ts)
const PROPERTY_SET_TYPE = "[[cf3bb923-f1f1-40be-b728-782844402426]]";

const AUDIT_DATE = "2026-08-03";
const TARGET_PROPERTY = "agr__LastAudit_on";

/** Find the reified statement whose subject-end is the clicked norm. */
const FIND_LAST_AUDIT_BODY = `SELECT ?link WHERE { ?link <${LAST_AUDIT_OF}> $currentAsset }`;

/** Seed one property_set grounding; `extra` adds the variant-specific triples. */
function groundingTriples(uid: string, extra: Triple[] = []): Triple[] {
  const gnd = new IRI(`obsidian://vault/${uid}.md`);
  return [
    new Triple(
      gnd,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Grounding"),
    ),
    new Triple(gnd, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(
      gnd,
      Namespace.EXO.term("Asset_label"),
      new Literal("Record last audit date"),
    ),
    new Triple(
      gnd,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal(PROPERTY_SET_TYPE),
    ),
    new Triple(
      gnd,
      Namespace.EXOCMD.term("Grounding_targetProperty"),
      new Literal(TARGET_PROPERTY),
    ),
    new Triple(
      gnd,
      Namespace.EXOCMD.term("Grounding_targetValueLiteral"),
      new Literal(AUDIT_DATE),
    ),
    ...extra,
  ];
}

async function seedCommandGraph(store: InMemoryTripleStore): Promise<void> {
  const queryRef = new IRI(`obsidian://vault/${QUERY_UID}.md`);
  const cmd = new IRI(`obsidian://vault/${CMD_UID}.md`);

  await store.addAll([
    // (a) the requirement's grounding: target addressed by NamedQuery
    ...groundingTriples(GND_QUERY_UID, [
      new Triple(
        new IRI(`obsidian://vault/${GND_QUERY_UID}.md`),
        Namespace.EXOCMD.term("Grounding_targetQuery"),
        queryRef,
      ),
    ]),
    // (b) both addressings at once — Scenario 2
    ...groundingTriples(GND_BOTH_UID, [
      new Triple(
        new IRI(`obsidian://vault/${GND_BOTH_UID}.md`),
        Namespace.EXOCMD.term("Grounding_targetQuery"),
        queryRef,
      ),
      new Triple(
        new IRI(`obsidian://vault/${GND_BOTH_UID}.md`),
        Namespace.EXOCMD.term("Grounding_targetsCreatedInstance"),
        new Literal("true"),
      ),
    ]),
    // (c) no targetQuery at all — Scenario 4 (every existing grounding)
    ...groundingTriples(GND_PLAIN_UID),
    // Command → the requirement's grounding
    new Triple(
      cmd,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    ),
    new Triple(cmd, Namespace.EXO.term("Asset_uid"), new Literal(CMD_UID)),
    new Triple(
      cmd,
      Namespace.EXO.term("Asset_label"),
      new Literal("Confirm audit"),
    ),
    new Triple(
      cmd,
      Namespace.EXOCMD.term("Command_grounding"),
      new IRI(`obsidian://vault/${GND_QUERY_UID}.md`),
    ),
  ]);
}

/** The reified statement points at the norm; the unaudited norm has none. */
async function seedAuditLink(store: InMemoryTripleStore): Promise<void> {
  store.add(
    new Triple(new IRI(LINK_IRI), new IRI(LAST_AUDIT_OF), new IRI(NORM_IRI)),
  );
}

function seedFiles(): InMemoryFileSystem {
  return new InMemoryFileSystem({
    [NORM_PATH]: [
      "---",
      "exo__Asset_uid: norm-flowers",
      'exo__Asset_label: "Цветы раз в месяц"',
      "---",
      "# Norm",
    ].join("\n"),
    [LINK_PATH]: [
      "---",
      "exo__Asset_uid: last-audit-flowers",
      `${TARGET_PROPERTY}: 2026-06-01`,
      "---",
      "# Last audit",
    ].join("\n"),
    [UNAUDITED_NORM_PATH]: [
      "---",
      "exo__Asset_uid: norm-dishes",
      'exo__Asset_label: "Посуда"',
      "---",
      "# Norm",
    ].join("\n"),
  });
}

describe("req faf269bf — Grounding_targetQuery target-source (integration)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;
  let runner: NamedQueryRunner;
  let fs: InMemoryFileSystem;
  let executor: GroundingExecutor;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    await seedCommandGraph(store);
    await seedAuditLink(store);
    resolver = new CommandResolver(store);
    runner = new NamedQueryRunner(
      new MapQueryBodyResolver({ [QUERY_UID]: FIND_LAST_AUDIT_BODY }),
      store,
    );
    fs = seedFiles();
    executor = new GroundingExecutor(fs, fs, new ServiceRegistry(), undefined, {
      namedQueryRunner: runner,
    });
  });

  it("@req:faf269bf-d4ff-4e84-b0ea-c41bf46da035 resolver parses Grounding_targetQuery to the bare query UID", async () => {
    const grounding = await resolver.loadGroundingByUid(GND_QUERY_UID);
    expect(grounding).not.toBeNull();
    expect(grounding?.targetQuery).toBe(QUERY_UID);
    // The VALUE-source stays untouched — the two are orthogonal.
    expect(grounding?.targetValueQuery).toBeUndefined();
  });

  // -- Scenario 1 -----------------------------------------------------------
  it("@req:faf269bf-d4ff-4e84-b0ea-c41bf46da035 Scenario 1: writes into the asset the query found, leaving the click-target untouched", async () => {
    const command = await resolver.loadCommand(CMD_UID);
    expect(command).not.toBeNull();

    const normBefore = fs.get(NORM_PATH)!;

    const result = await executor.execute(
      command!.grounding,
      NORM_IRI,
      NORM_PATH,
    );
    expect(result.success).toBe(true);

    // The date landed on the reified statement — addressed purely by the query,
    // and reachable only via its full path (it sits in a nested folder).
    const link = fs.get(LINK_PATH) ?? "";
    expect(link).toContain(`${TARGET_PROPERTY}: ${AUDIT_DATE}`);
    expect(link).not.toContain("2026-06-01");

    // …and the clicked norm is byte-for-byte untouched.
    expect(fs.get(NORM_PATH)).toBe(normBefore);
  });

  // -- Scenario 2 -----------------------------------------------------------
  it("@req:faf269bf-d4ff-4e84-b0ea-c41bf46da035 Scenario 2: refuses when targetQuery and targetsCreatedInstance are both set, writing nothing", async () => {
    const grounding = await resolver.loadGroundingByUid(GND_BOTH_UID);
    expect(grounding?.targetQuery).toBe(QUERY_UID);
    expect(grounding?.targetsCreatedInstance).toBe(true);

    const normBefore = fs.get(NORM_PATH)!;
    const linkBefore = fs.get(LINK_PATH)!;

    const result = await executor.execute(grounding!, NORM_IRI, NORM_PATH);

    expect(result.success).toBe(false);
    expect(result.error).toContain("mutually exclusive");
    // Nothing was written — neither addressing was silently chosen.
    expect(fs.get(NORM_PATH)).toBe(normBefore);
    expect(fs.get(LINK_PATH)).toBe(linkBefore);
  });

  // -- Scenario 3 -----------------------------------------------------------
  it("@req:faf269bf-d4ff-4e84-b0ea-c41bf46da035 Scenario 3: fails loudly when the query matches nothing and never falls back to the click-target", async () => {
    const command = await resolver.loadCommand(CMD_UID);
    const unauditedBefore = fs.get(UNAUDITED_NORM_PATH)!;

    // This norm has no reified audit statement → the query returns no rows.
    const result = await executor.execute(
      command!.grounding,
      UNAUDITED_NORM_IRI,
      UNAUDITED_NORM_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("matched no asset");
    // The click-target must NOT have absorbed the write.
    expect(fs.get(UNAUDITED_NORM_PATH)).toBe(unauditedBefore);
    expect(fs.get(UNAUDITED_NORM_PATH)).not.toContain(AUDIT_DATE);
  });

  // -- Scenario 4 (back-compat control) -------------------------------------
  it("@req:faf269bf-d4ff-4e84-b0ea-c41bf46da035 Scenario 4: a grounding without targetQuery still writes into the click-target", async () => {
    const grounding = await resolver.loadGroundingByUid(GND_PLAIN_UID);
    expect(grounding?.targetQuery).toBeUndefined();

    const linkBefore = fs.get(LINK_PATH)!;

    const result = await executor.execute(grounding!, NORM_IRI, NORM_PATH);

    expect(result.success).toBe(true);
    expect(fs.get(NORM_PATH) ?? "").toContain(
      `${TARGET_PROPERTY}: ${AUDIT_DATE}`,
    );
    // The query-found asset is irrelevant here — untouched.
    expect(fs.get(LINK_PATH)).toBe(linkBefore);
  });
});

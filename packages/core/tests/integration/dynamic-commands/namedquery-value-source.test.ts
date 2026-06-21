/**
 * Integration: RDF → CommandResolver → NamedQueryRunner → GroundingExecutor
 * (RFC 78c2b7d0 C4 — NamedQuery read-side value-source + C3 inheritance).
 *
 * Two end-to-end properties are proven against a realistic triple store +
 * file system (no mocked grounding — the resolver parses
 * `exocmd__Grounding_targetValueQuery` for real):
 *
 *   1. **Value-source bridge** — a `property_set` grounding whose value is
 *      computed by a `query__NamedQuery` (1-hop `currentAsset → isDefinedBy →
 *      archiveOntology`) writes the queried entity reference as a wikilink.
 *      This is the exact mechanism C5 (ontological archive) will consume.
 *
 *   2. **C3 class-inheritance** — the command is bound to a PARENT class; the
 *      grounding (carrying the NamedQuery reference) is resolved for a CHILD
 *      class instance via `resolveForAssetMulti`'s superClass BFS, and the
 *      NamedQuery runs with the child instance as `$currentAsset`. So the
 *      NamedQuery participates in capability inheritance via the inherited
 *      command — the same mechanism that serves commands and layouts.
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

// -- in-memory fs (mirrors grounding-resolve-execute.test.ts) --
class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>();
  constructor(initial?: Record<string, string>) {
    if (initial) for (const [p, c] of Object.entries(initial)) this.files.set(p, c);
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

// -- TBox UIDs (test classes) --
const ASSET_UID = "493c2ae2-de56-47ec-954d-2eb8cb49bff7"; // exo__Asset (root)
const PARENT_UID = "aaaa1111-0000-4000-8000-000000000001";
const CHILD_UID = "bbbb2222-0000-4000-8000-000000000002";

// -- ABox --
const CHILD_ASSET_IRI = "obsidian://vault/knowledge/child-instance.md";
const CHILD_FILE_PATH = "knowledge/child-instance.md";
const SRC_ONTO_IRI = "obsidian://vault/onto/src-onto.md";
const ARCHIVE_ONTO_IRI = "obsidian://vault/onto/7c0ffee0-archive.md";

const EXO = "https://exocortex.my/ontology/exo";
const ISDEFINEDBY = `${EXO}#Asset_isDefinedBy`;
const ARCHIVE_ONTO_PRED = `${EXO}#Ontology_archiveOntology`;

const QUERY_UID = "c4query0-0000-4000-8000-0000000000aa";
const CMD_UID = "cmd-archive-ontologically";
const GND_UID = "gnd-archive-isdefinedby";
const BIND_UID = "bind-archive-on-parent";

// property_set grounding-type UID (GroundingTypeUIDs.ts)
const PROPERTY_SET_TYPE = "[[cf3bb923-f1f1-40be-b728-782844402426]]";

function classFileIRI(uid: string): IRI {
  return new IRI(`obsidian://vault/assetspaces/test/${uid}.md`);
}
function expandClassLabel(label: string): IRI {
  const parsed = Namespace.fromPropertyKey(label);
  if (!parsed) throw new Error(`bad label ${label}`);
  return parsed.namespace.term(parsed.localName);
}

async function seedClass(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
  superClassLabel?: string,
): Promise<void> {
  const subject = classFileIRI(uid);
  const triples: Triple[] = [
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ];
  if (superClassLabel) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXO.term("Class_superClass"),
        expandClassLabel(superClassLabel),
      ),
    );
  }
  await store.addAll(triples);
}

async function seedCommandGraph(store: InMemoryTripleStore): Promise<void> {
  const gnd = new IRI(`obsidian://vault/${GND_UID}.md`);
  const cmd = new IRI(`obsidian://vault/${CMD_UID}.md`);
  const bind = new IRI(`obsidian://vault/${BIND_UID}.md`);

  await store.addAll([
    // Grounding: property_set on exo__Asset_isDefinedBy, value via NamedQuery
    new Triple(gnd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(gnd, Namespace.EXO.term("Asset_uid"), new Literal(GND_UID)),
    new Triple(gnd, Namespace.EXO.term("Asset_label"), new Literal("Set isDefinedBy via NamedQuery")),
    new Triple(gnd, Namespace.EXOCMD.term("Grounding_type"), new Literal(PROPERTY_SET_TYPE)),
    new Triple(
      gnd,
      Namespace.EXOCMD.term("Grounding_targetProperty"),
      new Literal("exo__Asset_isDefinedBy"),
    ),
    // targetValueQuery → IRI to the query asset file (resolver unwraps to UID)
    new Triple(
      gnd,
      Namespace.EXOCMD.term("Grounding_targetValueQuery"),
      new IRI(`obsidian://vault/${QUERY_UID}.md`),
    ),
    // Command → Grounding
    new Triple(cmd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmd, Namespace.EXO.term("Asset_uid"), new Literal(CMD_UID)),
    new Triple(cmd, Namespace.EXO.term("Asset_label"), new Literal("Archive Ontologically")),
    new Triple(cmd, Namespace.EXOCMD.term("Command_grounding"), gnd),
    // Binding on the PARENT class (inherited by CHILD via C3 BFS)
    new Triple(bind, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(bind, Namespace.EXO.term("Asset_uid"), new Literal(BIND_UID)),
    new Triple(bind, Namespace.EXOCMD.term("CommandBinding_command"), cmd),
    new Triple(
      bind,
      Namespace.EXOCMD.term("CommandBinding_targetClass"),
      new Literal("test__Parent"),
    ),
  ]);
}

async function seedNavigationData(store: InMemoryTripleStore): Promise<void> {
  // child-instance --isDefinedBy--> src-onto --archiveOntology--> archive-onto
  store.add(
    new Triple(new IRI(CHILD_ASSET_IRI), new IRI(ISDEFINEDBY), new IRI(SRC_ONTO_IRI)),
  );
  store.add(
    new Triple(
      new IRI(SRC_ONTO_IRI),
      new IRI(ARCHIVE_ONTO_PRED),
      new IRI(ARCHIVE_ONTO_IRI),
    ),
  );
  // child-instance rdf:type test__Child (so resolveForAsset matches)
  store.add(
    new Triple(
      new IRI(CHILD_ASSET_IRI),
      Namespace.RDF.term("type"),
      expandClassLabel("test__Child"),
    ),
  );
}

const ARCHIVE_QUERY_BODY = `SELECT ?archiveOnto WHERE { $currentAsset <${ISDEFINEDBY}> ?o . ?o <${ARCHIVE_ONTO_PRED}> ?archiveOnto }`;

describe("C4 NamedQuery value-source + C3 inheritance (integration)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;
  let runner: NamedQueryRunner;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    await seedClass(store, ASSET_UID, "exo__Asset");
    await seedClass(store, PARENT_UID, "test__Parent", "exo__Asset");
    await seedClass(store, CHILD_UID, "test__Child", "test__Parent");
    await seedCommandGraph(store);
    await seedNavigationData(store);
    resolver = new CommandResolver(store);
    runner = new NamedQueryRunner(
      new MapQueryBodyResolver({ [QUERY_UID]: ARCHIVE_QUERY_BODY }),
      store,
    );
  });

  it("resolver parses Grounding_targetValueQuery to the bare query UID", async () => {
    const grounding = await resolver.loadGroundingByUid(GND_UID);
    expect(grounding).not.toBeNull();
    expect(grounding?.targetValueQuery).toBe(QUERY_UID);
  });

  it("NamedQuery participates in C3 inheritance: parent-bound command resolves for a child instance", async () => {
    const resolved = await resolver.resolveForAssetMulti(CHILD_ASSET_IRI, [
      "test__Child",
    ]);
    expect(resolved.length).toBe(1);
    expect(resolved[0].command.id).toBe(CMD_UID);
    // grounding survives resolution with its NamedQuery reference intact
    expect(resolved[0].command.grounding.targetValueQuery).toBe(QUERY_UID);
  });

  it("end-to-end: inherited command runs the NamedQuery with the child as $currentAsset and writes the computed archive ontology", async () => {
    const fs = new InMemoryFileSystem({
      [CHILD_FILE_PATH]: [
        "---",
        `exo__Asset_uid: ${CHILD_UID}`,
        'exo__Instance_class:',
        '  - "[[test__Child]]"',
        'exo__Asset_isDefinedBy: "[[src-onto]]"',
        "---",
        "# Child",
      ].join("\n"),
    });
    const executor = new GroundingExecutor(fs, fs, new ServiceRegistry(), undefined, {
      namedQueryRunner: runner,
    });

    // Resolve the inherited command for the child instance, then execute its grounding.
    const resolved = await resolver.resolveForAssetMulti(CHILD_ASSET_IRI, [
      "test__Child",
    ]);
    const grounding = resolved[0].command.grounding;

    const result = await executor.execute(
      grounding,
      CHILD_ASSET_IRI,
      CHILD_FILE_PATH,
    );

    expect(result.success).toBe(true);
    const written = fs.get(CHILD_FILE_PATH) ?? "";
    // The query computed archiveOntology from the child's isDefinedBy 1-hop.
    expect(written).toContain('exo__Asset_isDefinedBy: "[[7c0ffee0-archive]]"');
    expect(written).not.toContain("src-onto");
  });
});

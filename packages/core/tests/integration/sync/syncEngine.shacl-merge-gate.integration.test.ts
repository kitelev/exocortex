/**
 * ExoSync SHACL merge-gate — non-network integration harness (req b0fd3343).
 *
 * Composes the REAL `GatedStructuredMerger` + REAL `MergeShaclGate` inside a
 * full `SyncEngine` cycle against the production-shape in-memory
 * `FakeGitHubRepo` (mock-github transport — NO network), and proves the D17
 * invariant end-to-end in the pipeline: a structurally-clean auto-merge whose
 * MERGED result violates an intrinsic SHACL constraint (minCount on
 * `ems__Effort_status`) is REFUSED (routed to quarantine) and NEVER shipped to
 * the remote — an automatic merge can never silently propagate a schema-broken
 * asset.
 *
 * This is the CI-reliable (network-free, in-repo) integration binding for
 * b0fd3343. It is distinct from the existing tiers:
 *   - `MergeShaclGate.test.ts` gates the verdict in ISOLATION (fixed triples).
 *   - `GatedStructuredMerger.test.ts` composes the merger with a FAKE gate.
 *   - `SyncEngine.test.ts` composes a STUB merge layer.
 *   - `syncEngine.real-github.integration.test.ts` (network/PAT-gated) does NOT
 *     inject a gated merge layer at all (its `SyncEngine` runs the default,
 *     gate-less `EMPTY_MERGE` path).
 * Only THIS harness composes the real gate inside the real engine + transport.
 *
 * The `triplesFor` port is supplied with a content-DERIVING parser (it parses
 * the actual merged frontmatter into RDF triples) so the gate's verdict depends
 * on the real merged bytes — a merge that dropped `ems__Effort_status` produces
 * NO status triple, so the validator's minCount shape fires (test-fixture-
 * realism: the gate sees what the merge produced, not a hard-coded fixture).
 * The control scenario proves the gate ships a SHACL-VALID merge, so the block
 * is a genuine content-dependent verdict, not an always-quarantine stub.
 *
 * NB the gate is composed EXPLICITLY here: the default production SyncEngine
 * wiring (`SyncDepsFactory` + CLI `exosync-sync`) currently composes
 * `GatedStructuredMerger` WITHOUT a gate (a documented follow-up — see
 * `SyncDepsFactory` "SHACL merge-gate deferred"). This harness binds the gate's
 * blocking behaviour in the full pipeline so wiring it into the default engine
 * is a drop-in.
 */

import * as yaml from "js-yaml";
import {
  GatedStructuredMerger,
  InMemoryQuarantineStore,
  MergeShaclGate,
  StructuredMerger,
  SyncEngine,
  type SyncEngineDeps,
  type SyncRepoSpec,
  type YamlCodec,
} from "../../../src";
import { ShapeRegistry } from "../../../src/services/ShaclLiteValidator";
import type { Triple } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  sha1Hex,
} from "../../unit/services/sync/fakeGitHub";

const EXO = "https://exocortex.my/ontology/exo#";
const EMS = "https://exocortex.my/ontology/ems#";
const TYPE = `${EXO}Instance_class`;
const TASK_CLASS = `${EMS}Task`;
const STATUS_PROP = `${EMS}Effort_status`;

const FILE_A = "assets/task.md";

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

/**
 * An `ems__Task` markdown asset. `status` present ⇒ valid (minCount 1
 * satisfied); absent ⇒ SHACL-invalid. `label` is a disjoint scalar one side
 * edits; `body` is a disjoint section the other side edits.
 */
function taskAsset(opts: {
  label: string;
  status?: string;
  body?: string;
}): string {
  const statusLine =
    opts.status !== undefined ? `ems__Effort_status: ${opts.status}\n` : "";
  return (
    `---\n` +
    `exo__Asset_uid: u1\n` +
    `exo__Instance_class: ems__Task\n` +
    `exo__Asset_label: ${opts.label}\n` +
    statusLine +
    `---\n\n${opts.body ?? "body"}\n`
  );
}

const iri = (value: string): { type: "iri"; value: string } => ({
  type: "iri",
  value,
});
const lit = (value: string): { type: "literal"; value: string } => ({
  type: "literal",
  value,
});

/** Parse a markdown asset's YAML frontmatter (same CORE_SCHEMA codec as merge). */
function parseFrontmatter(content: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return {};
  const parsed = yaml.load(m[1], { schema: yaml.CORE_SCHEMA });
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** `[[uid|prefix__Name]]` / `prefix__Name` → `…/ontology/prefix#Name`, else null. */
function localNameToIri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const inner = value.replace(/^\[\[(?:[^|\]]*\|)?/, "").replace(/\]\]$/, "");
  const m = /^([a-z][a-zA-Z0-9]*)__(.+)$/.exec(inner);
  return m ? `https://exocortex.my/ontology/${m[1]}#${m[2]}` : null;
}

/**
 * Production-shape content→triples port for the gate. Derives the type triple
 * and (when present) the `ems__Effort_status` property triple from the ACTUAL
 * merged frontmatter — so a merge that dropped the status emits no status
 * triple and the minCount shape gates it. Mirrors what the deferred production
 * `NoteToRDFConverter` adapter (MergeShaclGate JSDoc) would feed the gate.
 */
const triplesFromContent = async (
  path: string,
  content: string,
): Promise<Triple[]> => {
  const fm = parseFrontmatter(content);
  const subject = `obsidian://vault/${path}`;
  const triples: Triple[] = [];
  const cls = localNameToIri(fm["exo__Instance_class"]);
  if (cls !== null) {
    triples.push({
      subject: iri(subject),
      predicate: iri(TYPE),
      object: iri(cls),
    });
  }
  if (typeof fm["ems__Effort_status"] === "string") {
    triples.push({
      subject: iri(subject),
      predicate: iri(STATUS_PROP),
      object: lit(fm["ems__Effort_status"] as string),
    });
  }
  return triples;
};

/** Real `MergeShaclGate`: `ems__Effort_status` minCount 1 on `ems__Task`. */
function statusMinCountGate(): MergeShaclGate {
  return new MergeShaclGate({
    registry: new ShapeRegistry(
      [
        {
          propertyIRI: STATUS_PROP,
          domain: [TASK_CLASS],
          minCount: 1,
          severity: "sh:Violation",
        },
      ],
      TYPE,
    ),
    hierarchy: { isSubClassOf: (c: string, p: string): boolean => c === p },
    triplesFor: triplesFromContent,
  });
}

function makeEngine(
  gh: FakeGitHubRepo,
  local: FakeLocalFiles,
  overrides: Partial<SyncEngineDeps> = {},
): { engine: SyncEngine; watermarks: FakeWatermarkStore } {
  const watermarks = new FakeWatermarkStore();
  const engine = new SyncEngine({
    transport: gh.transport(),
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    ...overrides,
  });
  return { engine, watermarks };
}

async function bootstrap(engine: SyncEngine, spec: SyncRepoSpec): Promise<void> {
  const result = await engine.sync(spec);
  expect(result.status).toBe("synced");
}

describe("SyncEngine + real SHACL merge-gate (b0fd3343)", () => {
  it("@req:b0fd3343-03c5-409a-bede-5c47eae5593c blocks a structurally-clean auto-merge whose result is SHACL-invalid (missing ems__Effort_status) — quarantined, never shipped", async () => {
    const base = taskAsset({ label: "Base", status: "doing" });
    const gh = new FakeGitHubRepo({ [FILE_A]: base });
    const local = new FakeLocalFiles({ [FILE_A]: base });
    const store = new InMemoryQuarantineStore();
    const { engine } = makeEngine(gh, local, {
      mergeLayer: new GatedStructuredMerger(
        new StructuredMerger(codec),
        statusMinCountGate(),
      ),
      quarantine: store,
    });
    await bootstrap(engine, gh.spec());

    // Device B (remote): edits a DISJOINT scalar (label), keeps status → valid.
    const remoteEdit = taskAsset({ label: "Remote", status: "doing" });
    gh.commitDirect("main", { [FILE_A]: remoteEdit }, "B");
    // Device A (local): REMOVES ems__Effort_status (keeps label). Structurally
    // non-overlapping with the remote label edit, so the 3-way merge SUCCEEDS —
    // but the merged result drops the required status → SHACL-invalid.
    const localEdit = taskAsset({ label: "Base" });
    local.files.set(FILE_A, localEdit);

    const result = await engine.sync(gh.spec());

    // The invalid auto-merge is refused (quarantined), nothing merged/shipped.
    expect(result.quarantinedCount).toBe(1);
    expect(result.quarantinedPaths).toEqual([FILE_A]);
    expect(result.mergedCount).toBe(0);
    // The gate is the reason — not a structural conflict (the merge itself
    // succeeded; the SHACL verdict rejected the merged candidate).
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({
      path: FILE_A,
      uid: "u1",
      reason: expect.stringMatching(/SHACL-invalid/),
    });
    // Both versions preserved (D17); nothing shipped to the remote — the
    // device-B commit is still head, the invalid merge never landed.
    expect(gh.headFiles().get(FILE_A)).toBe(remoteEdit);
    expect(local.files.get(FILE_A)).toBe(localEdit); // disk untouched
  });

  it("ships a structurally-clean merge whose result stays SHACL-valid (keeps ems__Effort_status) — the gate is content-dependent, not always-quarantine", async () => {
    const base = taskAsset({ label: "Base", status: "doing", body: "base body" });
    const gh = new FakeGitHubRepo({ [FILE_A]: base });
    const local = new FakeLocalFiles({ [FILE_A]: base });
    const store = new InMemoryQuarantineStore();
    const { engine } = makeEngine(gh, local, {
      mergeLayer: new GatedStructuredMerger(
        new StructuredMerger(codec),
        statusMinCountGate(),
      ),
      quarantine: store,
    });
    await bootstrap(engine, gh.spec());

    // Device B (remote): edits the label (frontmatter), keeps status.
    gh.commitDirect(
      "main",
      { [FILE_A]: taskAsset({ label: "Remote", status: "doing", body: "base body" }) },
      "B",
    );
    // Device A (local): edits the body (disjoint section), keeps status.
    local.files.set(
      FILE_A,
      taskAsset({ label: "Base", status: "doing", body: "local body" }),
    );

    const result = await engine.sync(gh.spec());

    // Valid merge → use-merged → shipped; nothing quarantined.
    expect(result.mergedCount).toBe(1);
    expect(result.quarantinedCount).toBe(0);
    expect(store.entries).toHaveLength(0);
    const shipped = gh.headFiles().get(FILE_A)!;
    expect(shipped).toContain("ems__Effort_status: doing"); // status preserved
    expect(shipped).toContain("exo__Asset_label: Remote"); // remote's edit
    expect(shipped).toContain("local body"); // local's edit
    expect(local.files.get(FILE_A)).toBe(shipped); // disk converged
  });
});

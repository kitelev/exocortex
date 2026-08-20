import { describe, it, expect } from "@jest/globals";
import * as yaml from "js-yaml";
import { createInstantiatePrototypeSubtreeService } from "@kitelev/exocortex-services";
import { FrontmatterService } from "@kitelev/exocortex-core";

/**
 * Production-shape revert-verify test for the `instantiatePrototypeSubtree`
 * `service_call` service (issue #3881, Gap 3).
 *
 * Fixtures are RAW markdown parsed through the real `FrontmatterService`
 * (test-fixture-realism) — the fake `IVaultAdapter.getFrontmatter` returns
 * exactly what the production adapter would. The service is exercised end to
 * end; assertions cover: subtree discovery, label substitution, per-node
 * instance-class derivation, blocker re-mapping onto clones, WBS containment,
 * structured relates (person + quarter), and Project-classed parent linking.
 *
 * Revert-verify: temporarily breaking the substitution loop OR the blocker
 * re-map in `prototype-subtree-instantiator.ts` flips the marked assertions
 * RED; restoring returns them GREEN (integration-test-revert-verify).
 */

// --- fixed fixture UIDs (deterministic) ---
const PROJ_PROTO = "b2a49bb7-0000-0000-0000-000000000001";
const TASK_PROTO = "df7e579d-0000-0000-0000-000000000002";
const WCT_PROTO = "a67fc3b8-0000-0000-0000-000000000003";
const ROOT = "d4b5bbf8-0000-0000-0000-000000000010";
const C1 = "00000001-0000-0000-0000-000000000011"; // task, no blocker
const C2 = "00000002-0000-0000-0000-000000000012"; // waiting, blocker→C1
const C3 = "00000003-0000-0000-0000-000000000013"; // task, blocker→C2
const PERSON = "d350b625-0000-0000-0000-000000000020";
const QUARTER = "ed8e4fbb-0000-0000-0000-000000000021";
const PARENT_PROJ = "11111111-0000-0000-0000-000000000030";

// Real ems class-definition UIDs (production-shape) — the derived instance class
// of each node MUST be written as the canonical UID-alias `[[uid|label]]`, which
// requires the class-definition asset to be present in the scanned vault. These
// mirror the real `exoas-public/ems/*.md` files (co-mounted with the prototypes).
const EXO_CLASS_METACLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9";
const EMS_PROJECT_CLS = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
const EMS_TASK_CLS = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const EMS_WCT_CLS = "47dac51c-6332-467a-abb6-84498755a91e";
// instance-class label → canonical UID-alias ref the service must write (#3908).
const CLASS_UID_BY_LABEL: Record<string, string> = {
  ems__Project: EMS_PROJECT_CLS,
  ems__Task: EMS_TASK_CLS,
  ems__WaitingCheckTask: EMS_WCT_CLS,
};

interface FakeFile {
  path: string;
  basename: string;
  name: string;
  parent: { path: string; name: string } | null;
}

function mkFile(uid: string, folder = "efforts"): FakeFile {
  return {
    path: `${folder}/${uid}.md`,
    basename: uid,
    name: `${uid}.md`,
    parent: { path: folder, name: folder },
  };
}

// Raw markdown fixtures (parsed via real FrontmatterService in the fake adapter).
function fixtures(): Record<string, string> {
  return {
    // Class definitions (UID-named class files) — needed so the derived instance
    // class resolves to its canonical UID-alias ref (#3908). Metaclass-typed.
    [EMS_PROJECT_CLS]: `---\nexo__Asset_uid: ${EMS_PROJECT_CLS}\nexo__Instance_class:\n  - "[[${EXO_CLASS_METACLASS}]]"\nexo__Class_superClass:\n  - "[[086f71fa-dd30-4284-90cf-e609f2a6c461]]"\nexo__Asset_label: ems__Project\n---\n`,
    [EMS_TASK_CLS]: `---\nexo__Asset_uid: ${EMS_TASK_CLS}\nexo__Instance_class:\n  - "[[${EXO_CLASS_METACLASS}]]"\nexo__Class_superClass:\n  - "[[086f71fa-dd30-4284-90cf-e609f2a6c461]]"\nexo__Asset_label: ems__Task\n---\n`,
    [EMS_WCT_CLS]: `---\nexo__Asset_uid: ${EMS_WCT_CLS}\nexo__Instance_class:\n  - "[[${EXO_CLASS_METACLASS}]]"\nexo__Class_superClass:\n  - "[[${EMS_TASK_CLS}]]"\nexo__Asset_label: ems__WaitingCheckTask\n---\n`,
    [PROJ_PROTO]: `---\nexo__Asset_uid: ${PROJ_PROTO}\nexo__Instance_class:\n  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"\nexo__Asset_label: ems__ProjectPrototype\n---\n`,
    [TASK_PROTO]: `---\nexo__Asset_uid: ${TASK_PROTO}\nexo__Instance_class:\n  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"\nexo__Asset_label: ems__TaskPrototype\n---\n`,
    [WCT_PROTO]: `---\nexo__Asset_uid: ${WCT_PROTO}\nexo__Instance_class:\n  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"\nexo__Asset_label: ems__WaitingCheckTaskPrototype\n---\n`,
    [PERSON]: `---\nexo__Asset_uid: ${PERSON}\nexo__Instance_class:\n  - "[[person__Person]]"\nexo__Asset_label: n.rudopas\n---\n`,
    [QUARTER]: `---\nexo__Asset_uid: ${QUARTER}\nexo__Instance_class:\n  - "[[period__Quarter]]"\nexo__Asset_label: Q3-26\n---\n`,
    [PARENT_PROJ]: `---\nexo__Asset_uid: ${PARENT_PROJ}\nexo__Instance_class:\n  - "[[ems__Project]]"\nexo__Asset_label: Team Q3-26\n---\n`,
    [ROOT]: `---\nexo__Asset_uid: ${ROOT}\nexo__Instance_class:\n  - "[[${PROJ_PROTO}]]"\nexo__Asset_isDefinedBy: "[[95c3de47-4c16-4dc8-a696-6e2f01993b6d]]"\nexo__Asset_label: "Ревьюшница {{сотрудник}} {{квартал}}"\n---\n`,
    [C1]: `---\nexo__Asset_uid: ${C1}\nexo__Instance_class:\n  - "[[${TASK_PROTO}]]"\nexo__Asset_label: "Поручить {{сотрудник}} заполнить {{квартал}}"\nems__EffortPrototype_parentEffortPrototype: "[[${ROOT}]]"\n---\n`,
    [C2]: `---\nexo__Asset_uid: ${C2}\nexo__Instance_class:\n  - "[[${WCT_PROTO}]]"\nexo__Asset_label: "{{сотрудник}} заполнил {{квартал}}"\nems__EffortPrototype_parentEffortPrototype: "[[${ROOT}]]"\nems__Effort_blocker: "[[${C1}]]"\n---\n`,
    [C3]: `---\nexo__Asset_uid: ${C3}\nexo__Instance_class:\n  - "[[${TASK_PROTO}]]"\nexo__Asset_label: "Согласовать {{сотрудник}} {{квартал}}"\nems__EffortPrototype_parentEffortPrototype: "[[${ROOT}]]"\nems__Effort_blocker: "[[${C2}]]"\n---\n`,
  };
}

function makeAdapterAndWriter(extraParams?: Record<string, string>) {
  const fm = new FrontmatterService();
  const raw = fixtures();
  const files = Object.keys(raw).map((uid) => mkFile(uid));
  const byPath = new Map<string, string>();
  files.forEach((f) => byPath.set(f.path, raw[f.basename]));

  const writes: { path: string; content: string }[] = [];

  const vaultAdapter = {
    getAllFiles: () => files,
    getFrontmatter: (file: { path: string }) => {
      const content = byPath.get(file.path);
      return content ? fm.parseObject(content) : null;
    },
  } as never;

  const fsAdapter = {
    createFile: async (path: string, content: string) => {
      writes.push({ path, content });
      return path;
    },
  } as never;

  return { vaultAdapter, fsAdapter, writes, fm };
}

/**
 * Strip a single layer of surrounding double-quotes. `FrontmatterService.parseObject`
 * (the test reader) keeps the YAML quotes the service writes for safety; the real
 * store's YAML parser strips them. Normalising here mirrors production semantics
 * (the quoted-wikilink write format is the established `createCreateAssetService`
 * convention — required so colon-containing labels like «На 1-2-1: …» stay valid YAML).
 */
const unq = (s: unknown): string => String(s ?? "").replace(/^"(.*)"$/, "$1");

/** Parse a created instance's frontmatter + identify its source prototype. */
function parseWrites(
  writes: { path: string; content: string }[],
  fm: FrontmatterService,
) {
  return writes.map((w) => {
    const parsed = fm.parseObject(w.content) as Record<string, unknown>;
    const protoUid =
      unq(parsed.exo__Asset_prototype).match(/\[\[([^\]|]+)/)?.[1] ?? "";
    return { path: w.path, fm: parsed, protoUid, content: w.content };
  });
}

// @req:61206fe4-a599-4fc9-862d-9289e33c79e7
describe("instantiatePrototypeSubtree (issue #3881 Gap 3)", () => {
  const rootIRI = `obsidian://vault/efforts/${ROOT}.md`;

  it("clones the whole subtree with substitution, derived classes, blocker re-map, relates + parent (@req:61206fe4-a599-4fc9-862d-9289e33c79e7)", async () => {
    const { vaultAdapter, fsAdapter, writes, fm } = makeAdapterAndWriter();
    const service = createInstantiatePrototypeSubtreeService(
      vaultAdapter,
      fsAdapter,
    );

    await service.execute(rootIRI, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      сотрудник: `[[${PERSON}]]`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      квартал: `[[${QUARTER}]]`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      родитель: `[[${PARENT_PROJ}]]`,
    });

    // 4-node subtree: root + C1 + C2 + C3.
    expect(writes).toHaveLength(4);

    const nodes = parseWrites(writes, fm);
    const byProto = new Map(nodes.map((n) => [n.protoUid, n]));
    const rootInst = byProto.get(ROOT)!;
    const c1Inst = byProto.get(C1)!;
    const c2Inst = byProto.get(C2)!;
    const c3Inst = byProto.get(C3)!;
    expect(rootInst && c1Inst && c2Inst && c3Inst).toBeTruthy();

    // (revert-verify anchor #1) label substitution — no {{ }} survives, values applied.
    for (const n of nodes) {
      expect(unq(n.fm.exo__Asset_label)).not.toContain("{{");
    }
    expect(unq(rootInst.fm.exo__Asset_label)).toBe("Ревьюшница n.rudopas Q3-26");
    expect(unq(c1Inst.fm.exo__Asset_label)).toBe(
      "Поручить n.rudopas заполнить Q3-26",
    );

    // (revert-verify anchor #3908) instance-class derivation (Prototype-suffix
    // strip) written as the CANONICAL UID-alias `[[uid|label]]` — never a
    // dangling symbolic `[[label]]` (class files are UID-named). Reverting the
    // fix (writing `[[${instClassLabel}]]`) flips these RED.
    const cls = (n: { fm: Record<string, unknown> }) =>
      unq((n.fm.exo__Instance_class as string[])[0]);
    expect(cls(rootInst)).toBe(`[[${EMS_PROJECT_CLS}|ems__Project]]`);
    expect(cls(c1Inst)).toBe(`[[${EMS_TASK_CLS}|ems__Task]]`);
    expect(cls(c2Inst)).toBe(`[[${EMS_WCT_CLS}|ems__WaitingCheckTask]]`);
    expect(cls(c3Inst)).toBe(`[[${EMS_TASK_CLS}|ems__Task]]`);

    // (revert-verify anchor #2) blocker re-map onto CLONED siblings, not prototypes.
    const c1NewUid = unq(c1Inst.fm.exo__Asset_uid);
    const c2NewUid = unq(c2Inst.fm.exo__Asset_uid);
    expect(unq(c2Inst.fm.ems__Effort_blocker)).toBe(`[[${c1NewUid}]]`);
    expect(unq(c3Inst.fm.ems__Effort_blocker)).toBe(`[[${c2NewUid}]]`);
    // never points at a prototype uid.
    expect(unq(c2Inst.fm.ems__Effort_blocker)).not.toContain(C1);

    // WBS containment: children parent to the root INSTANCE.
    const rootNewUid = unq(rootInst.fm.exo__Asset_uid);
    expect(unq(c1Inst.fm.ems__Effort_parent)).toBe(`[[${rootNewUid}]]`);
    expect(unq(c2Inst.fm.ems__Effort_parent)).toBe(`[[${rootNewUid}]]`);
    expect(unq(c3Inst.fm.ems__Effort_parent)).toBe(`[[${rootNewUid}]]`);

    // Fork A: structured relates on root (person + quarter, differentiated by class).
    const relates = (rootInst.fm.exo__Asset_relates as string[]).map(unq);
    expect(relates).toContain(`[[${PERSON}]]`);
    expect(relates).toContain(`[[${QUARTER}]]`);
    // Fork B: Project-classed ref → root Effort_parent (not relates).
    expect(unq(rootInst.fm.ems__Effort_parent)).toBe(`[[${PARENT_PROJ}]]`);
    expect(relates).not.toContain(`[[${PARENT_PROJ}]]`);

    // provenance + status + co-location.
    expect(unq(rootInst.fm.exo__Asset_prototype)).toBe(`[[${ROOT}]]`);
    expect(unq(rootInst.fm.ems__Effort_status)).toContain(
      "753a44d5-846c-4b82-9196-4fd9a4d48777",
    );
    for (const n of nodes) expect(n.path.startsWith("efforts/")).toBe(true);

    // Production-parser realism (code-reviewer MEDIUM): the real CLI/plugin read
    // path is `js-yaml.load` (NodeFsAdapter/FileSystemVaultAdapter), not the naive
    // FrontmatterService.parseObject the fake adapter uses. Assert the written
    // frontmatter round-trips through the ACTUAL production YAML parser — labels
    // containing «:» (e.g. «На 1-2-1: …») stay valid because they are JSON-quoted.
    const rootWrite = writes.find((w) =>
      w.content.includes(`exo__Asset_prototype: "[[${ROOT}]]"`),
    )!;
    const fmBlock = rootWrite.content.split("---")[1];
    const y = yaml.load(fmBlock) as Record<string, unknown>;
    expect(y.exo__Asset_label).toBe("Ревьюшница n.rudopas Q3-26"); // js-yaml strips quotes
    expect(y.exo__Instance_class).toEqual([
      `[[${EMS_PROJECT_CLS}|ems__Project]]`,
    ]);
    expect(y.exo__Asset_relates).toEqual(
      expect.arrayContaining([`[[${PERSON}]]`, `[[${QUARTER}]]`]),
    );
  });

  it("writes CANONICAL UID-alias class refs `[[uid|label]]`, never dangling symbolic `[[label]]` (#3908)", async () => {
    const { vaultAdapter, fsAdapter, writes, fm } = makeAdapterAndWriter();
    const service = createInstantiatePrototypeSubtreeService(
      vaultAdapter,
      fsAdapter,
    );
    await service.execute(rootIRI, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      сотрудник: `[[${PERSON}]]`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      квартал: `[[${QUARTER}]]`,
    });

    const nodes = parseWrites(writes, fm);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      const ref = unq((n.fm.exo__Instance_class as string[])[0]);
      // (revert-verify anchor #3908) MUST be `[[uid|label]]`, not `[[label]]`.
      // Reverting the fix writes a bare symbolic `[[ems__Project]]` → the alias
      // regex fails to match → this assertion flips RED.
      const m = ref.match(/^\[\[([^|\]]+)\|([^\]]+)\]\]$/);
      expect(m).not.toBeNull();
      const uid = m![1];
      const label = m![2];
      // the UID part is the REAL class-definition UID for that label (resolves to
      // a UID-named class file that actually exists → not dangling in Obsidian).
      expect(CLASS_UID_BY_LABEL[label]).toBe(uid);
    }
  });

  it("standalone when no Project-classed param is supplied (Fork B else-branch)", async () => {
    const { vaultAdapter, fsAdapter, writes, fm } = makeAdapterAndWriter();
    const service = createInstantiatePrototypeSubtreeService(
      vaultAdapter,
      fsAdapter,
    );
    await service.execute(rootIRI, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      сотрудник: `[[${PERSON}]]`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      квартал: `[[${QUARTER}]]`,
    });
    const nodes = parseWrites(writes, fm);
    const rootInst = nodes.find((n) => n.protoUid === ROOT)!;
    // no parent project provided → root has no Effort_parent (standalone).
    expect(rootInst.fm.ems__Effort_parent).toBeUndefined();
    // relates still carries person + quarter.
    const relates = (rootInst.fm.exo__Asset_relates as string[]).map(unq);
    expect(relates.sort()).toEqual([`[[${PERSON}]]`, `[[${QUARTER}]]`].sort());
  });
});

// ---------------------------------------------------------------------------
// Hardening (issue #3896): M1 fail-loud on an unresolvable node class + M2
// idempotency guard against a duplicate re-deploy. @req:6666e9f0-...
// Production-shape revert-verify — the service runs end-to-end over the fake
// vault; reverting either guard flips the marked assertion RED.
// ---------------------------------------------------------------------------

const REQ = "6666e9f0-34fe-41dd-ab3a-a53c6ce94b5a";
const EXISTING = "e0000000-0000-0000-0000-0000000000e1";
const EXISTING_OTHER = "e0000000-0000-0000-0000-0000000000e2";
const OTHER_QUARTER = "ffffffff-0000-0000-0000-000000000099";

/** Build an adapter+writer from an arbitrary raw markdown fixture map. */
function makeAdapterFrom(raw: Record<string, string>) {
  const fm = new FrontmatterService();
  const files = Object.keys(raw).map((uid) => mkFile(uid));
  const byPath = new Map<string, string>();
  files.forEach((f) => byPath.set(f.path, raw[f.basename]));
  const writes: { path: string; content: string }[] = [];
  const vaultAdapter = {
    getAllFiles: () => files,
    getFrontmatter: (file: { path: string }) => {
      const content = byPath.get(file.path);
      return content ? fm.parseObject(content) : null;
    },
  } as never;
  const fsAdapter = {
    createFile: async (path: string, content: string) => {
      writes.push({ path, content });
      return path;
    },
  } as never;
  return { vaultAdapter, fsAdapter, writes, fm };
}

describe(`instantiatePrototypeSubtree hardening (issue #3896, @req:${REQ})`, () => {
  const rootIRI = `obsidian://vault/efforts/${ROOT}.md`;

  it(`M1: fails loud when a subtree node's class is unresolvable — no [[undefined]], zero partial write (@req:6666e9f0-34fe-41dd-ab3a-a53c6ce94b5a)`, async () => {
    const raw = fixtures();
    // Malform C1: strip its exo__Instance_class. It is still parented to the root
    // (so it IS discovered in the subtree), and classLabel(undefined) → undefined
    // → instClassLabel falsy → the OLD code would write exo__Instance_class:
    // [[undefined]] for it.
    raw[C1] = `---\nexo__Asset_uid: ${C1}\nexo__Asset_label: "Поручить {{сотрудник}} заполнить {{квартал}}"\nems__EffortPrototype_parentEffortPrototype: "[[${ROOT}]]"\n---\n`;
    const { vaultAdapter, fsAdapter, writes } = makeAdapterFrom(raw);
    const service = createInstantiatePrototypeSubtreeService(
      vaultAdapter,
      fsAdapter,
    );

    // (revert-verify anchor M1) — removing the pre-pass guard lets the service
    // succeed and write a node with a dangling [[undefined]] class → this
    // rejection assertion flips RED.
    await expect(
      service.execute(rootIRI, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        сотрудник: `[[${PERSON}]]`,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        квартал: `[[${QUARTER}]]`,
      }),
    ).rejects.toThrow(/cannot resolve instance class/i);

    // Atomic: the pre-pass throws BEFORE any file is written — zero partial
    // state, and in particular nothing with a dangling [[undefined]] class.
    expect(writes).toHaveLength(0);
  });

  it(`M2: refuses to re-deploy an already-instantiated subtree (same prototype + same ref-params) (@req:6666e9f0-34fe-41dd-ab3a-a53c6ce94b5a)`, async () => {
    const raw = fixtures();
    // A prior deployment already exists: an instance of the ROOT prototype whose
    // exo__Asset_relates set is exactly the current ref-params (person + quarter).
    raw[EXISTING] = `---\nexo__Asset_uid: ${EXISTING}\nexo__Instance_class:\n  - "[[ems__Project]]"\nexo__Asset_label: "Ревьюшница n.rudopas Q3-26"\nexo__Asset_prototype: "[[${ROOT}]]"\nexo__Asset_relates:\n  - "[[${PERSON}]]"\n  - "[[${QUARTER}]]"\n---\n`;
    const { vaultAdapter, fsAdapter, writes } = makeAdapterFrom(raw);
    const service = createInstantiatePrototypeSubtreeService(
      vaultAdapter,
      fsAdapter,
    );

    // (revert-verify anchor M2) — removing the idempotency guard lets a second
    // full subgraph be written → this rejection assertion flips RED.
    await expect(
      service.execute(rootIRI, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        сотрудник: `[[${PERSON}]]`,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        квартал: `[[${QUARTER}]]`,
      }),
    ).rejects.toThrow(/already deployed/i);

    // No second subgraph written.
    expect(writes).toHaveLength(0);
  });

  it(`M2 negative-control: a DIFFERENT employee/quarter is NOT blocked — the guard matches only the exact ref-param set (@req:6666e9f0-34fe-41dd-ab3a-a53c6ce94b5a)`, async () => {
    const raw = fixtures();
    // A prior deployment exists for the SAME prototype but a DIFFERENT ref-param
    // set (different quarter) → it must NOT block the current deployment.
    raw[EXISTING_OTHER] = `---\nexo__Asset_uid: ${EXISTING_OTHER}\nexo__Instance_class:\n  - "[[ems__Project]]"\nexo__Asset_label: "Ревьюшница n.rudopas Q2-26"\nexo__Asset_prototype: "[[${ROOT}]]"\nexo__Asset_relates:\n  - "[[${PERSON}]]"\n  - "[[${OTHER_QUARTER}]]"\n---\n`;
    const { vaultAdapter, fsAdapter, writes, fm } = makeAdapterFrom(raw);
    const service = createInstantiatePrototypeSubtreeService(
      vaultAdapter,
      fsAdapter,
    );

    await service.execute(rootIRI, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      сотрудник: `[[${PERSON}]]`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      квартал: `[[${QUARTER}]]`,
    });

    // Deploys normally: root + C1 + C2 + C3.
    expect(writes).toHaveLength(4);
    const nodes = parseWrites(writes, fm);
    const rootInst = nodes.find((n) => n.protoUid === ROOT)!;
    expect(rootInst).toBeTruthy();
    const relates = (rootInst.fm.exo__Asset_relates as string[]).map(unq);
    expect(relates.sort()).toEqual([`[[${PERSON}]]`, `[[${QUARTER}]]`].sort());
  });
});

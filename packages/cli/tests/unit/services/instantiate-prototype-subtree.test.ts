import { describe, it, expect } from "@jest/globals";
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
const unq = (s: unknown): string => String(s ?? "").replace(/^"(.*)"$/s, "$1");

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

    // instance-class derivation (Prototype-suffix strip).
    const cls = (n: { fm: Record<string, unknown> }) =>
      unq((n.fm.exo__Instance_class as string[])[0]);
    expect(cls(rootInst)).toBe("[[ems__Project]]");
    expect(cls(c1Inst)).toBe("[[ems__Task]]");
    expect(cls(c2Inst)).toBe("[[ems__WaitingCheckTask]]");
    expect(cls(c3Inst)).toBe("[[ems__Task]]");

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

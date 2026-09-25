import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GROUNDING_TYPE_UIDS } from "../../../src/domain/constants/GroundingTypeUIDs";
import { findUidByAssetLabel } from "../../../src/utilities/assetLabelLookup";

/**
 * Issue #4354 — reverse label lookup over a store built by the REAL converter.
 *
 * `NoteToRDFConverter` emits a `prefix__Local` label (every class and property
 * definition) as its term IRI, `exo:Asset_label <…/ems#Task>`, and only other
 * labels as a `Literal`. Both `findUidByLabel` copies (CommandResolver,
 * WorkflowResolver) matched the Literal form only, and their suites seeded the
 * label as a Literal by hand — so against a real store:
 *   - the class-ancestor walk stopped at the first superclass (inherited
 *     command bindings, #3295 / RFC 78c2b7d0),
 *   - a subclass two hops below Task never reached the Task workflow (req 915b20b2),
 *   - a short-name `Grounding_targetClass` never got its UID (#3212).
 * #4352 widened which labels parse (hyphenated prefixes) and so spread the gap
 * to classes like `tbank-public__ProteusReport`, where it had worked by accident.
 *
 * Every axis below builds its store with `NoteToRDFConverter.convertNote`, so a
 * label is whatever the converter makes of it — nothing is seeded by hand.
 */

const U = (n: number): string => `43540000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const EXO_CLASS = U(1); // exo__Class
const EXO_ASSET = U(2); // exo__Asset
const EFFORT = U(3); // ems__Effort ⊑ exo__Asset
const TASK = U(4); // ems__Task ⊑ ems__Effort
const MEETING = U(5); // ems__Meeting ⊑ ems__Task
const WEBPAGE = U(6); // lit__WebPage ⊑ exo__Asset
const PROTEUS = U(7); // tbank-public__ProteusReport ⊑ lit__WebPage
const ATLAS = U(8); // tbank-public__AtlasReport ⊑ tbank-public__ProteusReport
const HUMAN = U(9); // "Мой класс задач" (a Literal label) ⊑ ems__Task
const WCT = U(10); // ems__WaitingCheckTask ⊑ ems__Task
const WCT2 = U(11); // ems__WaitingCheckTask2 ⊑ ems__WaitingCheckTask
const GROUNDING = U(12); // create_instance grounding, targetClass "ems__Task"
const GT_CREATE = GROUNDING_TYPE_UIDS[GroundingType.CREATE_INSTANCE];

const cls = (uid: string, label: string, superUid?: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
  ...(superUid ? { exo__Class_superClass: [`[[${superUid}]]`] } : {}),
});

const FM: Record<string, IFrontmatter> = {
  [EXO_CLASS]: { exo__Asset_uid: EXO_CLASS, exo__Asset_label: "exo__Class", exo__Instance_class: [`[[${EXO_CLASS}]]`] },
  [EXO_ASSET]: cls(EXO_ASSET, "exo__Asset"),
  [EFFORT]: cls(EFFORT, "ems__Effort", EXO_ASSET),
  [TASK]: cls(TASK, "ems__Task", EFFORT),
  [MEETING]: cls(MEETING, "ems__Meeting", TASK),
  [WEBPAGE]: cls(WEBPAGE, "lit__WebPage", EXO_ASSET),
  [PROTEUS]: cls(PROTEUS, "tbank-public__ProteusReport", WEBPAGE),
  [ATLAS]: cls(ATLAS, "tbank-public__AtlasReport", PROTEUS),
  [HUMAN]: cls(HUMAN, "Мой класс задач", TASK),
  [WCT]: cls(WCT, "ems__WaitingCheckTask", TASK),
  [WCT2]: cls(WCT2, "ems__WaitingCheckTask2", WCT),
  [GT_CREATE]: {
    exo__Asset_uid: GT_CREATE,
    exo__Asset_label: "exocmd__GroundingTypeCreateInstance",
  },
  [GROUNDING]: {
    exo__Asset_uid: GROUNDING,
    exo__Asset_label: "Create Task",
    exocmd__Grounding_type: `[[${GT_CREATE}]]`,
    exocmd__Grounding_targetClass: "ems__Task",
  },
};

const fileOf = (uid: string): IFile => ({
  path: `tbox/${uid}.md`,
  basename: uid,
  name: `${uid}.md`,
  parent: null,
});

function makeVault(): IVaultAdapter {
  return {
    getFrontmatter: jest.fn((file: IFile) => FM[file.basename] ?? null),
    getAllFiles: jest.fn(),
    read: jest.fn().mockResolvedValue(""),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    getFirstLinkpathDest: jest.fn((linkpath: string) => {
      const uid = linkpath.split("|")[0];
      return FM[uid] ? fileOf(uid) : null;
    }),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as unknown as IVaultAdapter;
}

async function buildStore(): Promise<InMemoryTripleStore> {
  const converter = new NoteToRDFConverter(makeVault());
  const store = new InMemoryTripleStore();
  for (const uid of Object.keys(FM)) {
    await store.addAll(await converter.convertNote(fileOf(uid)));
  }
  return store;
}

const depthsOf = (rows: Array<{ ref: string; depth: number }>): Record<string, number> =>
  Object.fromEntries(rows.map((r) => [r.ref, r.depth]));

describe("symbolic label lookup over a converter-built store (issue #4354)", () => {
  let store: InMemoryTripleStore;

  beforeAll(async () => {
    store = await buildStore();
  });

  it("[L0] premise: the converter emits a prefix__Local label as a term IRI, a human label as a Literal", async () => {
    const label = async (uid: string) =>
      (await store.match(new IRI(`obsidian://vault/tbox/${uid}.md`), undefined, undefined))
        .filter((t) => t.predicate.value.endsWith("exo#Asset_label"))
        .map((t) => t.object.constructor.name);
    expect(await label(TASK)).toEqual(["IRI"]);
    expect(await label(PROTEUS)).toEqual(["IRI"]);
    expect(await label(HUMAN)).toEqual(["Literal"]);
  });

  it("[L1] findUidByAssetLabel finds a class by its prefix__Local label (term-IRI form)", async () => {
    expect(await findUidByAssetLabel(store, "ems__Task")).toBe(TASK);
    expect(await findUidByAssetLabel(store, "tbank-public__ProteusReport")).toBe(PROTEUS);
  });

  it("[L2] findUidByAssetLabel still finds a human label (Literal form) and returns null for an unknown one", async () => {
    expect(await findUidByAssetLabel(store, "Мой класс задач")).toBe(HUMAN);
    expect(await findUidByAssetLabel(store, "ems__NoSuchClass")).toBeNull();
    expect(await findUidByAssetLabel(store, "No such label")).toBeNull();
  });

  it("[A1] the ancestor walk climbs through hyphen-prefixed symbolic superclasses to the root", async () => {
    const d = depthsOf(await new CommandResolver(store).getClassAncestorsWithDepth(ATLAS));
    expect(d["tbank-public__ProteusReport"]).toBe(1);
    expect(d[PROTEUS]).toBe(1);
    expect(d["lit__WebPage"]).toBe(2);
    expect(d[WEBPAGE]).toBe(2);
    expect(d["exo__Asset"]).toBe(3);
  });

  it("[A2] a symbolic seed (ems__Meeting) resolves and walks ems__Task → ems__Effort → exo__Asset", async () => {
    const d = depthsOf(await new CommandResolver(store).getClassAncestorsWithDepth("ems__Meeting"));
    expect(d["ems__Task"]).toBe(1);
    expect(d[TASK]).toBe(1);
    expect(d["ems__Effort"]).toBe(2);
    expect(d["exo__Asset"]).toBe(3);
  });

  it("[A3] control: a Literal-labelled class seeded by UID walks the same chain", async () => {
    const d = depthsOf(await new CommandResolver(store).getClassAncestorsWithDepth(HUMAN));
    expect(d["ems__Task"]).toBe(1);
    expect(d["ems__Effort"]).toBe(2);
  });

  it("[W1] a subclass two hops below Task (through a symbolic intermediate) resolves the Task workflow", async () => {
    const wf = await new WorkflowResolver(store).resolveForAssetOrNull(
      new IRI("obsidian://vault/instance.md"),
      [`[[${WCT2}]]`],
    );
    expect(wf?.targetClass).toBe(AssetClass.TASK);
  });

  it("[W2] a bare-label subclass ref resolves the Task workflow", async () => {
    const wf = await new WorkflowResolver(store).resolveForAssetOrNull(
      new IRI("obsidian://vault/instance.md"),
      ["ems__WaitingCheckTask"],
    );
    expect(wf?.targetClass).toBe(AssetClass.TASK);
  });

  it("[G1] a short-name Grounding_targetClass is substituted by the class UID (#3212)", async () => {
    const grounding = await new CommandResolver(store).loadGroundingByUid(GROUNDING);
    expect(grounding).not.toBeNull();
    expect(grounding?.targetClass).toBe(TASK);
  });
});

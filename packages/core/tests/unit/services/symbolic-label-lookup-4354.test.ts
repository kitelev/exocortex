import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
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

const U = (n: number): string =>
  `43540000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
// A class file with NO exo__Asset_label and a class-shaped file name: the
// converter's basename fallback emits its label as a LITERAL (live instance:
// vault-my `kitelev__ReadArticleTask.md`). The only live form that needs the
// Literal branch for a prefix__Local name.
const READ = U(13); // file kitelev__ReadArticleTask.md ⊑ ems__Task
const CYC_A = U(14); // ems__CycA ⊑ ems__CycB
const CYC_B = U(15); // ems__CycB ⊑ ems__CycA (malformed cyclic TBox)
const PAGE = U(16); // file page.md, human label "Page"
const URL_CLS = U(17); // Literal label "https://example.com/page.md" ⊑ PAGE
const CYC_R = U(18); // file kitelev__CycR.md, NO label ⊑ ems__CycS
const CYC_S = U(19); // ems__CycS ⊑ CYC_R (cycle through a label-less class)
const GT_CREATE = GROUNDING_TYPE_UIDS[GroundingType.CREATE_INSTANCE];

/** File basename when it is not the uid (UID-canon is the default). */
const BASENAME: Record<string, string> = {
  [READ]: "kitelev__ReadArticleTask",
  [PAGE]: "page",
  [CYC_R]: "kitelev__CycR",
};
const UID_BY_BASENAME: Record<string, string> = Object.fromEntries(
  Object.entries(BASENAME).map(([uid, base]) => [base, uid]),
);

const cls = (uid: string, label: string, superUid?: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
  ...(superUid ? { exo__Class_superClass: [`[[${superUid}]]`] } : {}),
});

const FM: Record<string, IFrontmatter> = {
  [EXO_CLASS]: {
    exo__Asset_uid: EXO_CLASS,
    exo__Asset_label: "exo__Class",
    exo__Instance_class: [`[[${EXO_CLASS}]]`],
  },
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
  [READ]: {
    exo__Asset_uid: READ,
    exo__Instance_class: [`[[${EXO_CLASS}]]`],
    exo__Class_superClass: [`[[${TASK}]]`],
  },
  [CYC_A]: cls(CYC_A, "ems__CycA", CYC_B),
  [CYC_B]: cls(CYC_B, "ems__CycB", CYC_A),
  [PAGE]: cls(PAGE, "Page"),
  [CYC_R]: {
    exo__Asset_uid: CYC_R,
    exo__Instance_class: [`[[${EXO_CLASS}]]`],
    exo__Class_superClass: [`[[${CYC_S}]]`],
  },
  [CYC_S]: cls(CYC_S, "ems__CycS", CYC_R),
  [URL_CLS]: cls(URL_CLS, "https://example.com/page.md", PAGE),
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

const fileOf = (uid: string): IFile => {
  const base = BASENAME[uid] ?? uid;
  return {
    path: `tbox/${base}.md`,
    basename: base,
    name: `${base}.md`,
    parent: null,
  };
};

function makeVault(): IVaultAdapter {
  return {
    getFrontmatter: jest.fn(
      (file: IFile) =>
        FM[UID_BY_BASENAME[file.basename] ?? file.basename] ?? null,
    ),
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

const depthsOf = (
  rows: Array<{ ref: string; depth: number }>,
): Record<string, number> =>
  Object.fromEntries(rows.map((r) => [r.ref, r.depth]));

describe("symbolic label lookup over a converter-built store (issue #4354)", () => {
  let store: InMemoryTripleStore;

  beforeAll(async () => {
    store = await buildStore();
  });

  it("[L0] premise: the converter emits a prefix__Local label as a term IRI, a human label as a Literal", async () => {
    const label = async (uid: string) =>
      (
        await store.match(
          new IRI(`obsidian://vault/tbox/${uid}.md`),
          undefined,
          undefined,
        )
      )
        .filter((t) => t.predicate.value.endsWith("exo#Asset_label"))
        .map((t) => t.object.constructor.name);
    expect(await label(TASK)).toEqual(["IRI"]);
    expect(await label(PROTEUS)).toEqual(["IRI"]);
    expect(await label(HUMAN)).toEqual(["Literal"]);
  });

  it("[L1] findUidByAssetLabel finds a class by its prefix__Local label (term-IRI form)", async () => {
    expect(await findUidByAssetLabel(store, "ems__Task")).toBe(TASK);
    expect(
      await findUidByAssetLabel(store, "tbank-public__ProteusReport"),
    ).toBe(PROTEUS);
  });

  it("[L2] findUidByAssetLabel still finds a human label (Literal form) and returns null for an unknown one", async () => {
    expect(await findUidByAssetLabel(store, "Мой класс задач")).toBe(HUMAN);
    expect(await findUidByAssetLabel(store, "ems__NoSuchClass")).toBeNull();
    expect(await findUidByAssetLabel(store, "No such label")).toBeNull();
  });

  it("[A1] the ancestor walk climbs through hyphen-prefixed symbolic superclasses to the root", async () => {
    const d = depthsOf(
      await new CommandResolver(store).getClassAncestorsWithDepth(ATLAS),
    );
    expect(d["tbank-public__ProteusReport"]).toBe(1);
    expect(d[PROTEUS]).toBe(1);
    expect(d["lit__WebPage"]).toBe(2);
    expect(d[WEBPAGE]).toBe(2);
    expect(d["exo__Asset"]).toBe(3);
  });

  it("[A2] a symbolic seed (ems__Meeting) resolves and walks ems__Task → ems__Effort → exo__Asset", async () => {
    const d = depthsOf(
      await new CommandResolver(store).getClassAncestorsWithDepth(
        "ems__Meeting",
      ),
    );
    expect(d["ems__Task"]).toBe(1);
    expect(d[TASK]).toBe(1);
    expect(d["ems__Effort"]).toBe(2);
    expect(d["exo__Asset"]).toBe(3);
  });

  it("[L3] findUidByAssetLabel finds a label-less class by its class-shaped file name (Literal fallback)", async () => {
    expect(await findUidByAssetLabel(store, "kitelev__ReadArticleTask")).toBe(
      READ,
    );
  });

  it("[A3] a Literal-labelled class seeded by UID walks through its symbolic superclass", async () => {
    const d = depthsOf(
      await new CommandResolver(store).getClassAncestorsWithDepth(HUMAN),
    );
    expect(d["ems__Task"]).toBe(1);
    expect(d["ems__Effort"]).toBe(2);
  });

  it("[A4] a label-less class named by its file (symbolic seed) resolves through the Literal fallback", async () => {
    const d = depthsOf(
      await new CommandResolver(store).getClassAncestorsWithDepth(
        "kitelev__ReadArticleTask",
      ),
    );
    expect(d["ems__Task"]).toBe(1);
  });

  it("[A5] a cyclic chain (A ⊑ B ⊑ A) is walked but never lists the seed as its own ancestor", async () => {
    const d = depthsOf(
      await new CommandResolver(store).getClassAncestorsWithDepth(CYC_A),
    );
    expect(d[CYC_B]).toBe(1); // B resolved; mutant M2 (4361 spec) proves the walk continued past it
    expect(d["ems__CycA"]).toBeUndefined();
    expect(d[CYC_A]).toBeUndefined();
  });

  it("[A6] a Literal label that merely looks like a URL does not exclude a genuine ancestor", async () => {
    // The seed's label folds (by string shape) to `page` — the basename of its
    // real superclass file. Folding a Literal would drop that ancestor.
    const d = depthsOf(
      await new CommandResolver(store).getClassAncestorsWithDepth(URL_CLS),
    );
    expect(d["page"]).toBe(1);
  });

  it("[A7] a cycle through a label-less class (Literal basename label) never lists the seed as its own ancestor", async () => {
    // The converter gives a label-less file named `prefix__Name` a LITERAL
    // label from its basename (live: kitelev__ReadArticleTask) — the Literal
    // branch of the seed-label fold is what keeps this seed out of its ancestors.
    const d = depthsOf(
      await new CommandResolver(store).getClassAncestorsWithDepth(CYC_R),
    );
    expect(d[CYC_S]).toBe(1);
    expect(d["kitelev__CycR"]).toBeUndefined();
    expect(d[CYC_R]).toBeUndefined();
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
    const grounding = await new CommandResolver(store).loadGroundingByUid(
      GROUNDING,
    );
    expect(grounding).not.toBeNull();
    expect(grounding?.targetClass).toBe(TASK);
  });

  // Issue #4361 — resolveLabelByUID reads the label as a NODE: a term IRI is
  // folded to its key form (#4007), a Literal is returned as written.
  it("[R1] resolveLabelByUID returns a Literal label that looks like a URL verbatim (#4361)", async () => {
    expect(await new CommandResolver(store).resolveLabelByUID(URL_CLS)).toBe(
      "https://example.com/page.md",
    );
  });

  it("[R2] resolveLabelByUID folds a term-IRI label back to its key form (#4007)", async () => {
    const resolver = new CommandResolver(store);
    expect(await resolver.resolveLabelByUID(TASK)).toBe("ems__Task");
    expect(await resolver.resolveLabelByUID(PROTEUS)).toBe(
      "tbank-public__ProteusReport",
    );
  });

  it("[R3] resolveLabelByUID returns a human Literal label verbatim", async () => {
    expect(await new CommandResolver(store).resolveLabelByUID(HUMAN)).toBe(
      "Мой класс задач",
    );
  });
});

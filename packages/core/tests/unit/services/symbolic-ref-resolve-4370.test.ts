import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GROUNDING_TYPE_UIDS } from "../../../src/domain/constants/GroundingTypeUIDs";

/**
 * Issue #4370 — a canonical `[[uid]]` reference to an asset whose
 * `exo__Asset_label` is `prefix__Local` is emitted by the converter as that
 * label's TERM IRI, not the target's file IRI. The term IRI has no
 * `exo__Asset_uid` of its own, so every CommandResolver loader that took it as
 * the subject read nothing: the precondition vanished (the button showed
 * UNGATED), the grounding vanished (the whole command disappeared), the style
 * fell back to inline, the binding's command / overrides became `exocmd#Local`
 * strings, and composite steps / property defaults / inheritance rules were
 * dropped.
 *
 * The store is built by the REAL `NoteToRDFConverter`. Every reference below is
 * the canonical `[[uid]]`; every target carries a `prefix__Local` label. One
 * axis per resolution site; H1 / H2 are controls with human-labelled targets.
 */

const U = (n: number): string =>
  `43700000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const EXO_CLASS = U(1);
const CMD_CLASS = U(2); // exocmd__Command
const BINDING_CLASS = U(3); // exocmd__CommandBinding
const GT_CREATE = GROUNDING_TYPE_UIDS[GroundingType.CREATE_INSTANCE];
const GT_COMPOSITE = GROUNDING_TYPE_UIDS[GroundingType.COMPOSITE];

// Targets — every one labelled `prefix__Local`.
const GRD_S = U(10);
const PRE_S = U(11);
const STY_S = U(12);
const CMD_S = U(13);
const BIND_T = U(14); // an overridden binding
const QRY_S = U(15);
const STEP_S = U(16);
const PD_S = U(17);
const VAL = U(18); // property-default value (human label)
const IR_S = U(19);

// Holders — human labels.
const GRD_H = U(20);
const GRD_PD = U(21);
const COMP = U(22);
const CMD_G = U(30);
const CMD_P = U(31);
const CMD_Q = U(32);
const PRE_Q = U(33);
const CMD_H = U(34);
const PRE_H = U(35);
const CMD_PH = U(36);
const BIND_C = U(40);
const BIND_S = U(41);
const BIND_O = U(42);
const PRE_ALL = U(50); // AllPrecondition over the symbolic PRE_S
const CMD_ALL = U(51);
const CMD_LBL = U(52); // precondition written by LABEL, not by uid
const GRD_DUP_A = U(60); // two groundings sharing one prefix__Local label
const GRD_DUP_B = U(61);
const CMD_DUP = U(62);
const GRD_TWIN = U(70); // ONE grounding mounted at two paths
const CMD_TWIN = U(71);

const ASK = "ASK { ?s ?p ?o }";

const cls = (uid: string, label: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
});

const createGrounding = (
  uid: string,
  label: string,
  extra: IFrontmatter = {},
): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exocmd__Grounding_type: `[[${GT_CREATE}]]`,
  exocmd__Grounding_targetClass: "ems__Task",
  ...extra,
});

const command = (
  uid: string,
  label: string,
  extra: IFrontmatter = {},
): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exo__Instance_class: [`[[${CMD_CLASS}]]`],
  exocmd__Command_grounding: `[[${GRD_H}]]`,
  ...extra,
});

const binding = (
  uid: string,
  label: string,
  extra: IFrontmatter = {},
): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exo__Instance_class: [`[[${BINDING_CLASS}]]`],
  exocmd__CommandBinding_command: `[[${CMD_H}]]`,
  exocmd__CommandBinding_targetClass: "ems__Task",
  ...extra,
});

const FM: Record<string, IFrontmatter> = {
  [EXO_CLASS]: cls(EXO_CLASS, "exo__Class"),
  [CMD_CLASS]: cls(CMD_CLASS, "exocmd__Command"),
  [BINDING_CLASS]: cls(BINDING_CLASS, "exocmd__CommandBinding"),
  [GT_CREATE]: {
    exo__Asset_uid: GT_CREATE,
    exo__Asset_label: "exocmd__GroundingTypeCreateInstance",
  },
  [GT_COMPOSITE]: {
    exo__Asset_uid: GT_COMPOSITE,
    exo__Asset_label: "exocmd__GroundingTypeComposite",
  },

  [GRD_S]: createGrounding(GRD_S, "exocmd__SymGrounding"),
  [PRE_S]: {
    exo__Asset_uid: PRE_S,
    exo__Asset_label: "exocmd__SymPrecondition",
    exocmd__Precondition_sparqlAsk: ASK,
  },
  [STY_S]: {
    exo__Asset_uid: STY_S,
    exo__Asset_label: "exocmd__SymStyle",
    exocmd__CommandBindingStyle_variant: "primary",
  },
  [CMD_S]: command(CMD_S, "exocmd__SymCommand"),
  [BIND_T]: binding(BIND_T, "exocmd__SymOverridden"),
  [QRY_S]: { exo__Asset_uid: QRY_S, exo__Asset_label: "exoql__SymQuery" },
  [STEP_S]: createGrounding(STEP_S, "exocmd__SymStep"),
  [PD_S]: {
    exo__Asset_uid: PD_S,
    exo__Asset_label: "exocmd__SymDefault",
    exocmd__PropertyDefault_property: "ems__Effort_status",
    exocmd__PropertyDefault_value: `[[${VAL}]]`,
  },
  [VAL]: { exo__Asset_uid: VAL, exo__Asset_label: "Default value" },
  [IR_S]: {
    exo__Asset_uid: IR_S,
    exo__Asset_label: "exocmd__SymRule",
    exocmd__InheritanceRule_sourceProperty: "ems__Effort_area",
    exocmd__InheritanceRule_targetProperty: "ems__Effort_area",
  },

  [GRD_H]: createGrounding(GRD_H, "Holder grounding"),
  [GRD_PD]: createGrounding(GRD_PD, "Grounding with defaults", {
    exocmd__Grounding_propertyDefault: [`[[${PD_S}]]`],
    exocmd__Grounding_inheritanceRule: [`[[${IR_S}]]`],
  }),
  [COMP]: {
    exo__Asset_uid: COMP,
    exo__Asset_label: "Holder composite",
    exocmd__Grounding_type: `[[${GT_COMPOSITE}]]`,
    exocmd__Grounding_steps: [`[[${STEP_S}]]`],
  },
  [CMD_G]: command(CMD_G, "Command via symbolic grounding", {
    exocmd__Command_grounding: `[[${GRD_S}]]`,
  }),
  [CMD_P]: command(CMD_P, "Command gated by symbolic precondition", {
    exocmd__Command_precondition: `[[${PRE_S}]]`,
  }),
  [PRE_Q]: {
    exo__Asset_uid: PRE_Q,
    exo__Asset_label: "Query precondition",
    exocmd__Precondition_query: `[[${QRY_S}]]`,
  },
  [CMD_Q]: command(CMD_Q, "Command gated by a query", {
    exocmd__Command_precondition: `[[${PRE_Q}]]`,
  }),
  [CMD_H]: command(CMD_H, "Holder command"),
  [PRE_H]: {
    exo__Asset_uid: PRE_H,
    exo__Asset_label: "Human precondition",
    exocmd__Precondition_sparqlAsk: ASK,
  },
  [CMD_PH]: command(CMD_PH, "Command gated by a human precondition", {
    exocmd__Command_precondition: `[[${PRE_H}]]`,
  }),
  [BIND_C]: binding(BIND_C, "Binding to a symbolic command", {
    exocmd__CommandBinding_command: `[[${CMD_S}]]`,
  }),
  [BIND_S]: binding(BIND_S, "Binding with a symbolic style", {
    exocmd__CommandBinding_style: `[[${STY_S}]]`,
  }),
  [PRE_ALL]: {
    exo__Asset_uid: PRE_ALL,
    exo__Asset_label: "All-of precondition",
    exocmd__AllPrecondition_preconditions: [`[[${PRE_S}]]`],
  },
  [CMD_ALL]: command(CMD_ALL, "Command gated by a composite", {
    exocmd__Command_precondition: `[[${PRE_ALL}]]`,
  }),
  [CMD_LBL]: command(CMD_LBL, "Command gated by a label-form reference", {
    exocmd__Command_precondition: "[[exocmd__SymPrecondition]]",
  }),
  [GRD_DUP_A]: createGrounding(GRD_DUP_A, "exocmd__DupGrounding"),
  [GRD_DUP_B]: createGrounding(GRD_DUP_B, "exocmd__DupGrounding"),
  [CMD_DUP]: command(CMD_DUP, "Command via an ambiguous label", {
    exocmd__Command_grounding: `[[${GRD_DUP_B}]]`,
  }),
  [GRD_TWIN]: createGrounding(GRD_TWIN, "exocmd__TwinGrounding"),
  [CMD_TWIN]: command(CMD_TWIN, "Command via a twice-mounted grounding", {
    exocmd__Command_grounding: `[[${GRD_TWIN}]]`,
  }),
  [BIND_O]: binding(BIND_O, "Binding overriding a symbolic binding", {
    exocmd__CommandBinding_overrides: [`[[${BIND_T}]]`],
  }),
};

const fileOf = (uid: string, dir = "tbox"): IFile => ({
  path: `${dir}/${uid}.md`,
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
  // The same asset mounted in a second assetspace: a second file IRI with the
  // same uid and the same `prefix__Local` label.
  await store.addAll(await converter.convertNote(fileOf(GRD_TWIN, "mount2")));
  return store;
}

describe("a [[uid]] reference to a prefix__Local-labelled asset resolves to that asset (issue #4370)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeAll(async () => {
    store = await buildStore();
  });

  beforeEach(() => {
    resolver = new CommandResolver(store);
  });

  const bindingById = async (id: string) =>
    (await resolver.findBindings("ems__Task")).find((b) => b.id === id);

  it("[Z0] premise: the reference is emitted as a term IRI that carries no Asset_uid", async () => {
    const refs = await store.match(
      new IRI(`obsidian://vault/tbox/${CMD_G}.md`),
      Namespace.EXOCMD.term("Command_grounding"),
      undefined,
    );
    expect(refs).toHaveLength(1);
    const ref = refs[0].object as IRI;
    expect(ref.value).toBe("https://exocortex.my/ontology/exocmd#SymGrounding");
    expect(
      await store.match(ref, Namespace.EXO.term("Asset_uid"), undefined),
    ).toHaveLength(0);
  });

  it("[G1] Command_grounding: the command loads with its grounding", async () => {
    const cmd = await resolver.loadCommand(CMD_G);
    expect(cmd?.grounding.label).toBe("exocmd__SymGrounding");
  });

  it("[P1] Command_precondition: the gate is loaded, not dropped", async () => {
    const cmd = await resolver.loadCommand(CMD_P);
    expect(cmd?.precondition?.label).toBe("exocmd__SymPrecondition");
    expect(cmd?.precondition?.sparqlAsk).toBe(ASK);
  });

  it("[Q1] Precondition_query: the query reference resolves to the query's UID", async () => {
    const cmd = await resolver.loadCommand(CMD_Q);
    expect(cmd?.precondition?.query).toBe(QRY_S);
  });

  it("[S1] CommandBinding_style: the style asset is loaded", async () => {
    const bind = await bindingById(BIND_S);
    expect(bind?.style?.label).toBe("exocmd__SymStyle");
  });

  it("[B1] CommandBinding_command: the command reference is the command's UID", async () => {
    const bind = await bindingById(BIND_C);
    expect(bind?.commandRef).toBe(CMD_S);
  });

  it("[O1] CommandBinding_overrides: the override is the overridden binding's UID", async () => {
    const bind = await bindingById(BIND_O);
    expect(bind?.overrides).toEqual([BIND_T]);
  });

  it("[C1] Grounding_steps: the composite keeps its step", async () => {
    const grd = await resolver.loadGroundingByUid(COMP);
    expect(grd?.steps?.map((s) => s.label)).toEqual(["exocmd__SymStep"]);
  });

  it("[D1] Grounding_propertyDefault: the default is resolved", async () => {
    const grd = await resolver.loadGroundingByUid(GRD_PD);
    expect(grd?.propertyDefault?.map((d) => d.propertyName)).toEqual([
      "ems__Effort_status",
    ]);
  });

  it("[R1] Grounding_inheritanceRule: the rule is resolved", async () => {
    const grd = await resolver.loadGroundingByUid(GRD_PD);
    expect(grd?.inheritanceRule?.map((r) => r.sourcePropertyName)).toEqual([
      "ems__Effort_area",
    ]);
  });

  it("[P2] AllPrecondition_preconditions: a symbolic child of a composite is loaded", async () => {
    const cmd = await resolver.loadCommand(CMD_ALL);
    const children = cmd?.precondition?.composite?.children ?? [];
    expect(children.map((c) => c.label)).toEqual(["exocmd__SymPrecondition"]);
    expect(children[0]?.sparqlAsk).toBe(ASK);
  });

  it("[P3] a label-form reference [[prefix__Local]] (emitted as the term IRI) resolves to the asset", async () => {
    const cmd = await resolver.loadCommand(CMD_LBL);
    expect(cmd?.precondition?.sparqlAsk).toBe(ASK);
  });

  it("[A1] an ambiguous label (two assets share it) is NOT resolved to either — the command stays unloaded as on main", async () => {
    expect(await resolver.loadCommand(CMD_DUP)).toBeNull();
  });

  it("[W1] the ambiguous-label warning fires ONCE per session — not per render, not after invalidateCache", async () => {
    const warn = jest.fn();
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn,
      error: jest.fn(),
    };
    const r = new CommandResolver(store, logger);
    await r.loadCommand(CMD_DUP);
    await r.loadCommand(CMD_DUP);
    r.invalidateCache();
    await r.loadCommand(CMD_DUP);
    const ambiguous = warn.mock.calls.filter((c) =>
      String(c[0]).includes("left unresolved"),
    );
    expect(ambiguous).toHaveLength(1);
  });

  it("[U1] one asset mounted at two paths is ONE bearer — the reference resolves", async () => {
    const bearers = await store.match(
      undefined,
      Namespace.EXO.term("Asset_label"),
      new IRI("https://exocortex.my/ontology/exocmd#TwinGrounding"),
    );
    expect(bearers).toHaveLength(2); // premise: two file IRIs bear the label
    const cmd = await resolver.loadCommand(CMD_TWIN);
    expect(cmd?.grounding.label).toBe("exocmd__TwinGrounding");
  });

  it("[H1] control: a human-labelled grounding reference loads as before", async () => {
    const cmd = await resolver.loadCommand(CMD_H);
    expect(cmd?.grounding.label).toBe("Holder grounding");
  });

  it("[H2] control: a human-labelled precondition reference loads as before", async () => {
    const cmd = await resolver.loadCommand(CMD_PH);
    expect(cmd?.precondition?.label).toBe("Human precondition");
  });
});

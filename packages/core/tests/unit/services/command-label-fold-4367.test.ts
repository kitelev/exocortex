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
 * Issue #4367 — every `exo__Asset_label` read in CommandResolver goes through
 * the node-type fold (`readAssetLabel`, #4364). The converter emits a
 * `prefix__Local` label as its TERM IRI; each loader must hand back the key
 * form (`exocmd__FoldCommand`), not `https://exocortex.my/ontology/exocmd#…`.
 *
 * The store is built by the REAL `NoteToRDFConverter`.
 *
 * Reachability — every one of the six sites has an axis:
 * - command name / binding label / grounding label by UID (C1 / B1 / G1) —
 *   canonical `[[uid]]` references;
 * - style / precondition (S1 S2 / P1 P2): NOT through the canonical `[[uid]]`
 *   — a wikilink to an asset whose label is `prefix__Local` is emitted as that
 *   label's SYMBOLIC IRI and the reference resolvers take it as the subject
 *   as-is, so nothing loads (a separate latent defect, #4370; the command and
 *   the binding below therefore point at human-labelled assets) — but through
 *   a PATH-form wikilink `[[tbox/<uid>]]` (not a bare UUID, so the converter
 *   emits the file IRI) and through a bare-UID Literal (resolved by UID);
 * - wikilink alias (A1 / A2): the converter recognises a wikilink only as the
 *   WHOLE value, so a Literal `isDefinedBy` with a trailing space or
 *   surrounding text keeps `[[uuid]]` inside a Literal, and
 *   `resolveWikilinkAlias`'s unanchored match aliases it.
 * The obsidian-like `getFirstLinkpathDest` below resolves a bare basename, a
 * folder path and an optional `.md`, as Obsidian does.
 */

const U = (n: number): string =>
  `43670000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const EXO_CLASS = U(1);
const CMD_CLASS = U(2); // exocmd__Command
const BINDING_CLASS = U(3); // exocmd__CommandBinding
const CMD = U(10); // label exocmd__FoldCommand
const GRD_H = U(11); // human label — reachable through Command_grounding
const BIND = U(13); // label exocmd__FoldBinding
const GRD = U(15); // label exocmd__FoldGrounding, loaded by UID
const CMD_H = U(18); // control: human label
const STY = U(20); // style, label exocmd__FoldStyle
const PRE = U(21); // precondition, label exocmd__FoldPrecondition
const ONT = U(22); // isDefinedBy target, label exocmd__FoldOntology
const B_PATH = U(30); // binding → style via [[tbox/<uid>]]
const B_BARE = U(31); // binding → style via bare UID
const C_PATH = U(40); // command → precondition via [[tbox/<uid>]]
const C_BARE = U(41); // command → precondition via bare UID
const G_TRAIL = U(50); // isDefinedBy "[[uid]] " (trailing space)
const G_TEXT = U(51); // isDefinedBy "see [[uid]]"
const GT_CREATE = GROUNDING_TYPE_UIDS[GroundingType.CREATE_INSTANCE];

const cls = (uid: string, label: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
});

const grounding = (
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

const bindingWithStyle = (uid: string, style: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: `Styled binding ${uid.slice(-2)}`,
  exo__Instance_class: [`[[${BINDING_CLASS}]]`],
  exocmd__CommandBinding_command: `[[${CMD_H}]]`,
  exocmd__CommandBinding_targetClass: "ems__Task",
  exocmd__CommandBinding_style: style,
});

const commandWithPrecondition = (uid: string, pre: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: `Gated command ${uid.slice(-2)}`,
  exo__Instance_class: [`[[${CMD_CLASS}]]`],
  exocmd__Command_grounding: `[[${GRD_H}]]`,
  exocmd__Command_precondition: pre,
});

const FM: Record<string, IFrontmatter> = {
  [EXO_CLASS]: cls(EXO_CLASS, "exo__Class"),
  [CMD_CLASS]: cls(CMD_CLASS, "exocmd__Command"),
  [BINDING_CLASS]: cls(BINDING_CLASS, "exocmd__CommandBinding"),
  [GT_CREATE]: {
    exo__Asset_uid: GT_CREATE,
    exo__Asset_label: "exocmd__GroundingTypeCreateInstance",
  },
  [GRD_H]: grounding(GRD_H, "Fold grounding"),
  [GRD]: grounding(GRD, "exocmd__FoldGrounding"),
  [CMD]: {
    exo__Asset_uid: CMD,
    exo__Asset_label: "exocmd__FoldCommand",
    exo__Instance_class: [`[[${CMD_CLASS}]]`],
    exocmd__Command_grounding: `[[${GRD_H}]]`,
  },
  [CMD_H]: {
    exo__Asset_uid: CMD_H,
    exo__Asset_label: "Fold command",
    exo__Instance_class: [`[[${CMD_CLASS}]]`],
    exocmd__Command_grounding: `[[${GRD_H}]]`,
  },
  [BIND]: {
    exo__Asset_uid: BIND,
    exo__Asset_label: "exocmd__FoldBinding",
    exo__Instance_class: [`[[${BINDING_CLASS}]]`],
    exocmd__CommandBinding_command: `[[${CMD_H}]]`,
    exocmd__CommandBinding_targetClass: "ems__Task",
  },
  [STY]: {
    exo__Asset_uid: STY,
    exo__Asset_label: "exocmd__FoldStyle",
    exocmd__CommandBindingStyle_variant: "primary",
  },
  [PRE]: {
    exo__Asset_uid: PRE,
    exo__Asset_label: "exocmd__FoldPrecondition",
    exocmd__Precondition_sparqlAsk: "ASK { ?s ?p ?o }",
  },
  [ONT]: { exo__Asset_uid: ONT, exo__Asset_label: "exocmd__FoldOntology" },
  [B_PATH]: bindingWithStyle(B_PATH, `[[tbox/${STY}]]`),
  [B_BARE]: bindingWithStyle(B_BARE, STY),
  [C_PATH]: commandWithPrecondition(C_PATH, `[[tbox/${PRE}]]`),
  [C_BARE]: commandWithPrecondition(C_BARE, PRE),
  [G_TRAIL]: grounding(G_TRAIL, "Trailing-space ontology ref", {
    exocmd__Grounding_isDefinedBy: `[[${ONT}]] `,
  }),
  [G_TEXT]: grounding(G_TEXT, "Prose ontology ref", {
    exocmd__Grounding_isDefinedBy: `see [[${ONT}]]`,
  }),
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
      const base = linkpath
        .split("|")[0]
        .replace(/\.md$/, "")
        .split("/")
        .pop() as string;
      return FM[base] ? fileOf(base) : null;
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

describe("prefix__Local labels come back in key form from CommandResolver loaders (issue #4367)", () => {
  let store: InMemoryTripleStore;

  beforeAll(async () => {
    store = await buildStore();
  });

  it("[C0] premise: the converter emits the command's prefix__Local label as a term IRI", async () => {
    const labels = await store.match(
      new IRI(`obsidian://vault/tbox/${CMD}.md`),
      Namespace.EXO.term("Asset_label"),
      undefined,
    );
    expect(labels.map((t) => t.object.constructor.name)).toEqual(["IRI"]);
  });

  it("[C1] loadCommand: a prefix__Local command label is the command name in key form", async () => {
    const cmd = await new CommandResolver(store).loadCommand(CMD);
    expect(cmd).not.toBeNull();
    expect(cmd?.name).toBe("exocmd__FoldCommand");
  });

  it("[B1] findBindings: a prefix__Local binding label comes back in key form", async () => {
    const bindings = await new CommandResolver(store).findBindings("ems__Task");
    const bind = bindings.find((b) => b.id === BIND);
    expect(bind).toBeDefined();
    expect(bind?.label).toBe("exocmd__FoldBinding");
  });

  it("[G1] loadGroundingByUid: a prefix__Local grounding label comes back in key form", async () => {
    const grd = await new CommandResolver(store).loadGroundingByUid(GRD);
    expect(grd?.label).toBe("exocmd__FoldGrounding");
  });

  const styleLabel = async (bindingId: string): Promise<string | undefined> => {
    const bindings = await new CommandResolver(store).findBindings("ems__Task");
    return bindings.find((b) => b.id === bindingId)?.style?.label;
  };

  const preconditionLabel = async (
    commandId: string,
  ): Promise<string | undefined> =>
    (await new CommandResolver(store).loadCommand(commandId))?.precondition
      ?.label;

  it("[S1] loadStyleAsset: a style reached by a path-form wikilink comes back in key form", async () => {
    expect(await styleLabel(B_PATH)).toBe("exocmd__FoldStyle");
  });

  it("[S2] loadStyleAsset: a style reached by a bare UID comes back in key form", async () => {
    expect(await styleLabel(B_BARE)).toBe("exocmd__FoldStyle");
  });

  it("[P1] loadPreconditionSubject: a precondition reached by a path-form wikilink comes back in key form", async () => {
    expect(await preconditionLabel(C_PATH)).toBe("exocmd__FoldPrecondition");
  });

  it("[P2] loadPreconditionSubject: a precondition reached by a bare UID comes back in key form", async () => {
    expect(await preconditionLabel(C_BARE)).toBe("exocmd__FoldPrecondition");
  });

  it("[A1] resolveWikilinkAlias: a Literal isDefinedBy with a trailing space is aliased with the key form", async () => {
    const grd = await new CommandResolver(store).loadGroundingByUid(G_TRAIL);
    expect(grd?.isDefinedBy).toBe(`[[${ONT}|exocmd__FoldOntology]] `);
  });

  it("[A2] resolveWikilinkAlias: a Literal isDefinedBy with surrounding text is aliased with the key form", async () => {
    const grd = await new CommandResolver(store).loadGroundingByUid(G_TEXT);
    expect(grd?.isDefinedBy).toBe(`see [[${ONT}|exocmd__FoldOntology]]`);
  });

  it("[H1] control: a human command label is returned verbatim", async () => {
    const cmd = await new CommandResolver(store).loadCommand(CMD_H);
    expect(cmd?.name).toBe("Fold command");
  });
});

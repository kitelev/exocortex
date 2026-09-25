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
 * Reachability note — three of the six sites have an axis here (command name,
 * binding label, grounding label by UID). The other three are unreachable with
 * an IRI label through the converter today, so a mutant there is equivalent:
 * - precondition / style: a wikilink to an asset whose label is `prefix__Local`
 *   is emitted as that label's SYMBOLIC IRI, and the precondition / style
 *   reference resolvers take that IRI as the subject as-is, so the asset is not
 *   loaded through the reference at all (the command below therefore points at
 *   a grounding with a human label);
 * - wikilink alias: `getObsidianWikilinkValue` only aliases a LITERAL
 *   `[[uuid]]`, and the converter turns every `[[uuid]]` into an IRI — even an
 *   unresolved one (pathless `obsidian://vault/<uid>.md`).
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
const GT_CREATE = GROUNDING_TYPE_UIDS[GroundingType.CREATE_INSTANCE];

const cls = (uid: string, label: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
});

const grounding = (uid: string, label: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exocmd__Grounding_type: `[[${GT_CREATE}]]`,
  exocmd__Grounding_targetClass: "ems__Task",
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

  it("[H1] control: a human command label is returned verbatim", async () => {
    const cmd = await new CommandResolver(store).loadCommand(CMD_H);
    expect(cmd?.name).toBe("Fold command");
  });
});

import "reflect-metadata";
import * as fs from "fs";
import * as path from "path";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GROUNDING_TYPE_UIDS } from "../../../src/domain/constants/GroundingTypeUIDs";

/**
 * Issue #4382 — CommandResolver's loaders re-run on every button render and
 * after every `invalidateCache()` (each `.md` save). In the plugin `warn` is a
 * user-facing toast by default plus a log-file line, so a warning about one
 * malformed asset must fire ONCE per session, not per render (#3186 storm).
 *
 * W1–W3 drive the three sites the issue names through the real converter and
 * count the warnings over two passes + `invalidateCache()` + a third pass.
 * S0 locks the class: no `logger.warn` call is left outside `warnOnce`, so a
 * new site cannot slip back to per-render noise unnoticed.
 */

const U = (n: number): string =>
  `43820000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const EXO_CLASS = U(1);
const CMD_CLASS = U(2);
const BINDING_CLASS = U(3);
const GT_CREATE = GROUNDING_TYPE_UIDS[GroundingType.CREATE_INSTANCE];
const GRD = U(10); // grounding with a malformed default and a malformed rule
const PD_BAD = U(11); // PropertyDefault without PropertyDefault_property
const IR_BAD = U(12); // InheritanceRule without InheritanceRule_sourceProperty
const VAL = U(13);
const CMD = U(20);
const BIND = U(30); // binding whose style reference does not resolve
const MISSING_STYLE = U(99); // no such asset

const cls = (uid: string, label: string): IFrontmatter => ({
  exo__Asset_uid: uid,
  exo__Asset_label: label,
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
});

const FM: Record<string, IFrontmatter> = {
  [EXO_CLASS]: cls(EXO_CLASS, "exo__Class"),
  [CMD_CLASS]: cls(CMD_CLASS, "exocmd__Command"),
  [BINDING_CLASS]: cls(BINDING_CLASS, "exocmd__CommandBinding"),
  [GT_CREATE]: {
    exo__Asset_uid: GT_CREATE,
    exo__Asset_label: "exocmd__GroundingTypeCreateInstance",
  },
  [VAL]: { exo__Asset_uid: VAL, exo__Asset_label: "Default value" },
  [PD_BAD]: {
    exo__Asset_uid: PD_BAD,
    exo__Asset_label: "Default without a property",
    exocmd__PropertyDefault_value: `[[${VAL}]]`,
  },
  [IR_BAD]: {
    exo__Asset_uid: IR_BAD,
    exo__Asset_label: "Rule without a source property",
    exocmd__InheritanceRule_targetProperty: "ems__Effort_area",
  },
  [GRD]: {
    exo__Asset_uid: GRD,
    exo__Asset_label: "Grounding with malformed entries",
    exocmd__Grounding_type: `[[${GT_CREATE}]]`,
    exocmd__Grounding_targetClass: "ems__Task",
    exocmd__Grounding_propertyDefault: [`[[${PD_BAD}]]`],
    exocmd__Grounding_inheritanceRule: [`[[${IR_BAD}]]`],
  },
  [CMD]: {
    exo__Asset_uid: CMD,
    exo__Asset_label: "Command",
    exo__Instance_class: [`[[${CMD_CLASS}]]`],
    exocmd__Command_grounding: `[[${GRD}]]`,
  },
  [BIND]: {
    exo__Asset_uid: BIND,
    exo__Asset_label: "Binding with a dangling style",
    exo__Instance_class: [`[[${BINDING_CLASS}]]`],
    exocmd__CommandBinding_command: `[[${CMD}]]`,
    exocmd__CommandBinding_targetClass: "ems__Task",
    exocmd__CommandBinding_style: `[[${MISSING_STYLE}]]`,
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

describe("CommandResolver warns once per session, not per render (issue #4382)", () => {
  let store: InMemoryTripleStore;
  let warnings: string[];

  beforeAll(async () => {
    store = await buildStore();
  });

  /** Two passes, a save (`invalidateCache()`), a third pass — as the plugin does. */
  beforeAll(async () => {
    warnings = [];
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn((m: string) => {
        warnings.push(m);
      }),
      error: jest.fn(),
    };
    const resolver = new CommandResolver(store, logger);
    const pass = async (): Promise<void> => {
      await resolver.findBindings("ems__Task");
      await resolver.loadGroundingByUid(GRD);
    };
    await pass();
    await pass();
    resolver.invalidateCache();
    await pass();
  });

  const count = (needle: string): number =>
    warnings.filter((w) => w.includes(needle)).length;

  it("[W1] the unresolved-style warning fires exactly once", () => {
    expect(count("style reference unresolved")).toBe(1);
  });

  it("[W2] the PropertyDefault 'entry skipped' warning fires exactly once", () => {
    expect(count("missing exocmd__PropertyDefault_property")).toBe(1);
  });

  it("[W3] the InheritanceRule 'entry skipped' warning fires exactly once", () => {
    expect(count("exocmd__InheritanceRule_sourceProperty")).toBe(1);
  });

  it("[S0] every warning in CommandResolver goes through warnOnce — no direct logger.warn left elsewhere", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../../src/services/CommandResolver.ts"),
      "utf-8",
    );
    // The single allowed call lives inside warnOnce itself.
    expect(source.match(/this\.logger\.warn\(/g) ?? []).toHaveLength(1);
    expect(source).toMatch(
      /private warnOnce\(message: string\): void \{[^}]*this\.logger\.warn\(message\);/,
    );
  });
});

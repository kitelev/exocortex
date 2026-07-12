/**
 * exo-layout action button EXECUTION via structural exocmd commands — INTEGRATION
 * (#3654 Part 2 / #3777).
 *
 * Real engine end-to-end: a realistic in-memory Obsidian `App` (vault +
 * metadataCache holding actual markdown frontmatter) is parsed by the REAL
 * `SPARQLApi` (REAL `NoteToRDFConverter` → `InMemoryTripleStore`), then a REAL
 * `CommandResolver`, a REAL `PreconditionEvaluator`, and a REAL
 * `CommandExecutionFlow` drive the REAL
 * `LayoutCodeBlockProcessor.executeCommand` / `.checkCommandPrecondition`. Only
 * the LEAF `GroundingExecutor.execute` is mocked at the boundary — the
 * established seam from `DynamicCommandButtonGroupBuilder.test.ts`;
 * `GroundingExecutor` is exhaustively tested elsewhere and is unchanged by this
 * feature. The command is resolved from the store by its ACTUAL structural
 * grounding, not a synthetic shape (test-fixture-realism).
 *
 * Binds req 28731c06-b393-419b-b8ee-453ca6225b17.
 */
import { TFile } from "obsidian";
import type { App } from "obsidian";
import {
  CommandResolver,
  PreconditionEvaluator,
  GroundingType,
} from "@kitelev/exocortex-core";
import { SPARQLApi } from "../../../../src/application/api/SPARQLApi";
import { LayoutCodeBlockProcessor } from "../../../../src/application/processors/LayoutCodeBlockProcessor";
import type { CommandRef } from "../../../../src/domain/layout";
import type ExocortexPlugin from "../../../../src/ExocortexPlugin";

const EXO = "https://exocortex.my/ontology/exo#";
const REQ = "@req:28731c06-b393-419b-b8ee-453ca6225b17";

// Real GroundingType catalog UID (packages/core/src/domain/constants/GroundingTypeUIDs.ts).
const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";

const CMD_STRUCT = "aaaa0001-0000-0000-0000-000000000001";
const GROUNDING = "aaaa0001-0000-0000-0000-000000000002";
const CMD_GATED_TRUE = "aaaa0002-0000-0000-0000-000000000001";
const CMD_GATED_FALSE = "aaaa0003-0000-0000-0000-000000000001";
const PRECOND_TRUE = "aaaa0002-0000-0000-0000-000000000002";
const PRECOND_FALSE = "aaaa0003-0000-0000-0000-000000000002";
const CMD_RAW = "aaaa0004-0000-0000-0000-000000000001";

interface SeedFile {
  path: string;
  frontmatter: Record<string, unknown>;
}

function buildApp(seed: SeedFile[]): App {
  const files: TFile[] = [];
  const fmByPath = new Map<string, Record<string, unknown>>();
  const contentByPath = new Map<string, string>();
  const renderYaml = (fm: Record<string, unknown>): string =>
    "---\n" +
    Object.entries(fm)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n") +
    "\n---\n";
  for (const f of seed) {
    const tfile = new TFile(f.path);
    files.push(tfile);
    fmByPath.set(f.path, f.frontmatter);
    contentByPath.set(f.path, renderYaml(f.frontmatter));
  }
  const vault = {
    getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
    getAbstractFileByPath: (p: string) =>
      files.find((f) => f.path === p) ?? null,
    read: async (f: TFile) => contentByPath.get(f.path) ?? "",
    on: () => ({}) as unknown,
    off: () => {},
    offref: () => {},
  };
  const metadataCache = {
    getFileCache: (f: TFile) => {
      const fm = fmByPath.get(f.path);
      return fm ? { frontmatter: fm } : null;
    },
    getFirstLinkpathDest: (linkpath: string) => {
      const base = linkpath.replace(/\.md$/, "");
      return files.find((f) => f.basename === base) ?? null;
    },
    resolvedLinks: {},
  };
  return { vault, metadataCache } as unknown as App;
}

// A real asset whose vault path contains slashes (dual-IRI: encodeURI keeps `/`).
const TASK_ALPHA: SeedFile = {
  path: "assetspaces/ems/task-alpha.md",
  frontmatter: {
    exo__Asset_uid: "task-alpha-uid",
    exo__Asset_label: "Alpha Task",
    exo__Instance_class: ["[[ems__Task]]"],
  },
};

// A structural property_set grounding — a real typed grounding resolvable by
// CommandResolver.loadCommand (same shape as apply-mutation-parity fixtures).
// UID-canon filename (`<uid>.md` at root): the `exocmd__Command_grounding`
// wikilink `[[<uid>]]` emits the file-form IRI `obsidian://vault/<uid>.md`, which
// must equal this asset's own subject IRI for the resolver to follow the link
// (matches apply-mutation-parity's flat UID-named temp-vault fixtures).
const SET_STATUS_GROUNDING: SeedFile = {
  path: `${GROUNDING}.md`,
  frontmatter: {
    exo__Asset_uid: GROUNDING,
    exo__Asset_label: "Set status grounding",
    exo__Instance_class: ["[[exocmd__Grounding]]"],
    exocmd__Grounding_type: `[[${GT_PROPERTY_SET}]]`,
    exocmd__Grounding_targetProperty: "ems__Effort_status",
    exocmd__Grounding_targetValueLiteral: "done",
  },
};

// STRUCTURAL command (has exocmd__Command_grounding → typed grounding).
const SET_STATUS_CMD: SeedFile = {
  path: "assetspaces/exocmd/set-status-cmd.md",
  frontmatter: {
    exo__Asset_uid: CMD_STRUCT,
    exo__Asset_label: "Set Status Done",
    exo__Instance_class: ["[[exocmd__Command]]"],
    exocmd__Command_grounding: `[[${GROUNDING}|g]]`,
    exocmd__Command_successMessage: "Status set to done",
  },
};

// Structural precondition ASK that HOLDS for every asset (has a label).
const PRECOND_TRUE_FILE: SeedFile = {
  path: `${PRECOND_TRUE}.md`,
  frontmatter: {
    exo__Asset_uid: PRECOND_TRUE,
    exo__Asset_label: "Has a label",
    exo__Instance_class: ["[[exocmd__Precondition]]"],
    exocmd__Precondition_sparqlAsk: `PREFIX exo: <${EXO}> ASK { $target exo:Asset_label ?l }`,
  },
};

// Structural precondition ASK that does NOT hold (no such predicate).
const PRECOND_FALSE_FILE: SeedFile = {
  path: `${PRECOND_FALSE}.md`,
  frontmatter: {
    exo__Asset_uid: PRECOND_FALSE,
    exo__Asset_label: "Never",
    exo__Instance_class: ["[[exocmd__Precondition]]"],
    exocmd__Precondition_sparqlAsk: `PREFIX exo: <${EXO}> ASK { $target exo:DefinitelyNotAPredicate ?l }`,
  },
};

const CMD_GATED_TRUE_FILE: SeedFile = {
  path: "assetspaces/exocmd/cmd-gated-true.md",
  frontmatter: {
    exo__Asset_uid: CMD_GATED_TRUE,
    exo__Asset_label: "Gated (true)",
    exo__Instance_class: ["[[exocmd__Command]]"],
    exocmd__Command_grounding: `[[${GROUNDING}|g]]`,
    exocmd__Command_precondition: `[[${PRECOND_TRUE}|p]]`,
  },
};

const CMD_GATED_FALSE_FILE: SeedFile = {
  path: "assetspaces/exocmd/cmd-gated-false.md",
  frontmatter: {
    exo__Asset_uid: CMD_GATED_FALSE,
    exo__Asset_label: "Gated (false)",
    exo__Instance_class: ["[[exocmd__Command]]"],
    exocmd__Command_grounding: `[[${GROUNDING}|g]]`,
    exocmd__Command_precondition: `[[${PRECOND_FALSE}|p]]`,
  },
};

// A legacy RAW-only command (exo__Command_grounding, NOT exocmd__Command_grounding):
// CommandResolver.loadCommand returns null (no typed grounding) → the raw-SPARQL
// execution path was rejected in #3777 → the processor surfaces an honest notice.
const CMD_RAW_FILE: SeedFile = {
  path: "assetspaces/exocmd/cmd-raw.md",
  frontmatter: {
    exo__Asset_uid: CMD_RAW,
    exo__Asset_label: "Raw Command",
    exo__Instance_class: ["[[exocmd__Command]]"],
    exo__Command_grounding: "[[raw-grounding]]",
  },
};

interface ExecGate {
  executeCommand(
    cmd: CommandRef,
    assetUri: string,
    assetPath: string | undefined,
    refresh: () => Promise<void>,
  ): Promise<void>;
  checkCommandPrecondition(
    cmd: CommandRef,
    assetUri: string,
    assetPath?: string,
  ): Promise<boolean>;
}

describe(`LayoutCodeBlockProcessor — action button execution via structural exocmd commands [${REQ}]`, () => {
  let api: SPARQLApi;
  let processor: LayoutCodeBlockProcessor;
  let assetIri: string;
  let mockExecute: jest.Mock;
  let notifier: { error: jest.Mock; info: jest.Mock; success: jest.Mock };

  beforeEach(async () => {
    const app = buildApp([
      TASK_ALPHA,
      SET_STATUS_GROUNDING,
      SET_STATUS_CMD,
      PRECOND_TRUE_FILE,
      PRECOND_FALSE_FILE,
      CMD_GATED_TRUE_FILE,
      CMD_GATED_FALSE_FILE,
      CMD_RAW_FILE,
    ]);
    const apiPlugin = {
      app,
      settings: { excludedFolders: [] },
    } as unknown as ExocortexPlugin;
    api = new SPARQLApi(apiPlugin);

    // Warm up + fetch the store's REAL subject IRI for the task (the value
    // LayoutService threads into the row metadata, production-shape).
    const res = await api.query(
      `PREFIX exo: <${EXO}> SELECT ?s WHERE { ?s exo:Asset_label "Alpha Task" }`,
    );
    assetIri = String((res.bindings[0].get("s") as { value: unknown }).value);
    expect(assetIri).toBe("obsidian://vault/assetspaces/ems/task-alpha.md");

    const store = api.getTripleStore();
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const commandResolver = new CommandResolver(store, logger);
    const preconditionEvaluator = new PreconditionEvaluator(store);

    mockExecute = jest.fn().mockResolvedValue({ success: true });
    notifier = { error: jest.fn(), info: jest.fn(), success: jest.fn() };

    const procPlugin = {
      app,
      getSPARQLApi: () => api,
      sparql: api,
      commandResolver,
      preconditionEvaluator,
      groundingExecutor: { execute: mockExecute },
      notifier,
    } as unknown as ExocortexPlugin;
    processor = new LayoutCodeBlockProcessor(procPlugin);
  });

  afterEach(async () => {
    processor.cleanup();
    await api.dispose();
  });

  const exec = (
    cmd: CommandRef,
    refresh: () => Promise<void>,
    path: string | undefined = "assetspaces/ems/task-alpha.md",
  ): Promise<void> =>
    (processor as unknown as ExecGate).executeCommand(
      cmd,
      assetIri,
      path,
      refresh,
    );

  const checkPre = (cmd: CommandRef): Promise<boolean> =>
    (processor as unknown as ExecGate).checkCommandPrecondition(
      cmd,
      assetIri,
      "assetspaces/ems/task-alpha.md",
    );

  it(`clicking a structural-command layout action resolves it and runs the typed grounding through CommandExecutionFlow, targeting the row asset [${REQ}]`, async () => {
    const cmd: CommandRef = {
      uid: CMD_STRUCT,
      label: "Set Status Done",
      structural: true,
    };
    const refresh = jest.fn().mockResolvedValue(undefined);

    await exec(cmd, refresh);

    // GroundingExecutor.execute (the leaf) was invoked with the RESOLVED typed
    // grounding, the row's store subject IRI as targetIRI, and the row's path as
    // filePath — i.e. the command really ran through CommandExecutionFlow.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [grounding, targetIRI, filePath] = mockExecute.mock.calls[0];
    expect((grounding as { type?: string }).type).toBe(
      GroundingType.PROPERTY_SET,
    );
    expect(targetIRI).toBe(assetIri);
    expect(filePath).toBe("assetspaces/ems/task-alpha.md");
    // On success the layout block is refreshed (onComplete).
    expect(refresh).toHaveBeenCalledTimes(1);
    // No error notice on the happy path.
    expect(notifier.error).not.toHaveBeenCalled();
  });

  it(`a raw-only / unresolvable command surfaces an honest notice and does NOT execute or refresh [${REQ}]`, async () => {
    const cmd: CommandRef = { uid: CMD_RAW, label: "Raw Command" };
    const refresh = jest.fn().mockResolvedValue(undefined);

    await exec(cmd, refresh);

    // No structural grounding → loadCommand returns null → honest notice, not a
    // silent no-op (#3628); the raw-SPARQL-UPDATE engine was rejected (#3777).
    expect(mockExecute).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(notifier.error).toHaveBeenCalledTimes(1);
    expect(notifier.error.mock.calls[0][0]).toContain("Raw Command");
  });

  it(`a structural command whose precondition ASK holds is shown [${REQ}]`, async () => {
    const cmd: CommandRef = {
      uid: CMD_GATED_TRUE,
      label: "Gated (true)",
      structural: true,
    };
    await expect(checkPre(cmd)).resolves.toBe(true);
  });

  it(`a structural command whose precondition ASK does NOT hold is hidden [${REQ}]`, async () => {
    const cmd: CommandRef = {
      uid: CMD_GATED_FALSE,
      label: "Gated (false)",
      structural: true,
    };
    await expect(checkPre(cmd)).resolves.toBe(false);
  });

  it(`a structural command with NO precondition is shown (unified with Part 1) [${REQ}]`, async () => {
    const cmd: CommandRef = {
      uid: CMD_STRUCT,
      label: "Set Status Done",
      structural: true,
    };
    await expect(checkPre(cmd)).resolves.toBe(true);
  });
});

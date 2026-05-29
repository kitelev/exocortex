import { ExocmdCommandPaletteRegistrar } from "../../../../src/application/services/ExocmdCommandPaletteRegistrar";
import { InMemoryTripleStore } from "exocortex";
import { PreconditionEvaluator } from "exocortex";
import { registerDefaultHostFunctions } from "exocortex";

/**
 * Unit tests for `ExocmdCommandPaletteRegistrar` covering both code paths:
 *
 *  - **No-target shape** (RFC 1429fcd0 PR-2): commands without a precondition
 *    are wired as `addCommand({ callback })` — always visible in the Palette,
 *    invoked with `targetIRI: null, filePath: null`.
 *
 *  - **Active-target shape** (Issue #3292): commands with a `hostFunction`
 *    precondition are wired as `addCommand({ checkCallback })` — visibility
 *    is gated by synchronously evaluating the host function against the
 *    active file's metadata, and the active file's IRI is passed at exec
 *    time so service-call groundings (e.g. `duplicateAsset`) can resolve
 *    the source.
 *
 * The fakes mirror the real Obsidian + exocortex API contract per
 * `~/.claude/rules/test-fixture-realism.md` — `getFirstLinkpathDest`
 * semantics, frontmatter shape, and the `EvalContext` keys
 * (`fileBasename`, `currentFolder`, `assetUid`) that real host functions
 * use are all reproduced as they appear in production.
 */

type CommandShape = {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean;
};

function makePlugin(): {
  addCommand: jest.Mock;
  registered: CommandShape[];
} {
  const registered: CommandShape[] = [];
  const addCommand = jest.fn((c: CommandShape) => {
    registered.push(c);
  });
  return { addCommand, registered };
}

function makeCommandResolver(
  entries: Array<{
    command: unknown;
    paletteId: string;
  }>,
): unknown {
  return {
    findPaletteEnabledCommands: async () => entries,
  };
}

function makeFlow(): {
  run: jest.Mock;
} {
  return { run: jest.fn(async () => {}) };
}

function makeVaultSettings(owner: string | null): unknown {
  return { getOwnerIdentity: () => owner };
}

function makeLogger(): {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeApp(active: {
  path: string;
  basename: string;
  parentPath: string;
  frontmatter: Record<string, unknown> | undefined;
} | null): unknown {
  const file = active
    ? {
        path: active.path,
        basename: active.basename,
        parent: { path: active.parentPath },
      }
    : null;
  return {
    workspace: { getActiveFile: () => file },
    metadataCache: {
      getFileCache: (f: unknown) => {
        if (!file || f !== file) return undefined;
        return { frontmatter: active!.frontmatter };
      },
    },
  };
}

function makeEvaluator(): PreconditionEvaluator {
  const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());
  registerDefaultHostFunctions(evaluator);
  return evaluator;
}

describe("ExocmdCommandPaletteRegistrar — no-target commands (RFC 1429fcd0)", () => {
  it("registers always-visible callback command when command has no precondition", async () => {
    const plugin = makePlugin();
    const flow = makeFlow();
    const command = {
      id: "uid-1",
      name: "Create Note",
      grounding: {
        id: "g1",
        label: "g",
        type: "service_call",
      },
    };
    const resolver = makeCommandResolver([
      { command, paletteId: "create-note" },
    ]);

    await new ExocmdCommandPaletteRegistrar(
      plugin as never,
      resolver as never,
      flow as never,
      makeVaultSettings("[[!kitelev]]") as never,
      makeLogger() as never,
    ).init();

    expect(plugin.addCommand).toHaveBeenCalledTimes(1);
    const registered = plugin.registered[0];
    expect(registered.id).toBe("create-note");
    expect(registered.name).toBe("Create Note");
    expect(registered.callback).toBeDefined();
    expect(registered.checkCallback).toBeUndefined();

    // Invoking callback dispatches the flow with null target — matches
    // the RFC 1429fcd0 "no active file" contract.
    registered.callback!();
    expect(flow.run).toHaveBeenCalledWith(
      expect.objectContaining({ command }),
      expect.objectContaining({
        targetIRI: null,
        filePath: null,
        injectedUserInput: { ownerIdentity: "[[!kitelev]]" },
      }),
    );
  });
});

describe("ExocmdCommandPaletteRegistrar — active-target commands (Issue #3292)", () => {
  const HOST_FUNCTION_COMMAND = {
    id: "dup-1",
    name: "Duplicate current asset",
    grounding: { id: "g-dup", label: "Dup", type: "service_call" },
    precondition: {
      id: "pre-1",
      label: "Has UID filename",
      hostFunction: "hasUidFilename",
    },
  };

  it("uses checkCallback and gates visibility on the host-function precondition", async () => {
    const uid = "11111111-1111-4111-8111-111111111111";
    const plugin = makePlugin();
    const flow = makeFlow();
    const resolver = makeCommandResolver([
      { command: HOST_FUNCTION_COMMAND, paletteId: "duplicate-current-asset" },
    ]);

    await new ExocmdCommandPaletteRegistrar(
      plugin as never,
      resolver as never,
      flow as never,
      makeVaultSettings(null) as never,
      makeLogger() as never,
      makeApp({
        path: `inbox/${uid}.md`,
        basename: uid,
        parentPath: "inbox",
        frontmatter: { exo__Asset_uid: uid },
      }) as never,
      makeEvaluator(),
    ).init();

    const registered = plugin.registered[0];
    expect(registered.checkCallback).toBeDefined();
    expect(registered.callback).toBeUndefined();

    // checking=true on a UID-named asset with matching uid → visible
    expect(registered.checkCallback!(true)).toBe(true);
    // Flow not invoked during visibility check
    expect(flow.run).not.toHaveBeenCalled();

    // checking=false: invoke the flow with the active file's IRI + path
    registered.checkCallback!(false);
    expect(flow.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: HOST_FUNCTION_COMMAND }),
      expect.objectContaining({
        targetIRI: `obsidian://vault/inbox/${uid}.md`,
        filePath: `inbox/${uid}.md`,
      }),
    );
  });

  it("hides the command when active file is a daily note (basename != uid)", async () => {
    const uid = "22222222-2222-4222-8222-222222222222";
    const plugin = makePlugin();
    const flow = makeFlow();
    const resolver = makeCommandResolver([
      { command: HOST_FUNCTION_COMMAND, paletteId: "duplicate-current-asset" },
    ]);

    await new ExocmdCommandPaletteRegistrar(
      plugin as never,
      resolver as never,
      flow as never,
      makeVaultSettings(null) as never,
      makeLogger() as never,
      makeApp({
        path: "Daily/2026-05-29.md",
        basename: "2026-05-29",
        parentPath: "Daily",
        frontmatter: { exo__Asset_uid: uid },
      }) as never,
      makeEvaluator(),
    ).init();

    const registered = plugin.registered[0];
    expect(registered.checkCallback!(true)).toBe(false);
    expect(flow.run).not.toHaveBeenCalled();
  });

  it("hides the command when active file has no exo__Asset_uid (freeform .md)", async () => {
    const plugin = makePlugin();
    const flow = makeFlow();
    const resolver = makeCommandResolver([
      { command: HOST_FUNCTION_COMMAND, paletteId: "duplicate-current-asset" },
    ]);

    await new ExocmdCommandPaletteRegistrar(
      plugin as never,
      resolver as never,
      flow as never,
      makeVaultSettings(null) as never,
      makeLogger() as never,
      makeApp({
        path: "Notes/Freeform.md",
        basename: "Freeform",
        parentPath: "Notes",
        frontmatter: undefined,
      }) as never,
      makeEvaluator(),
    ).init();

    expect(plugin.registered[0].checkCallback!(true)).toBe(false);
  });

  it("hides the command when there is no active file (Cmd-P opened with no open file)", async () => {
    const plugin = makePlugin();
    const flow = makeFlow();
    const resolver = makeCommandResolver([
      { command: HOST_FUNCTION_COMMAND, paletteId: "duplicate-current-asset" },
    ]);

    await new ExocmdCommandPaletteRegistrar(
      plugin as never,
      resolver as never,
      flow as never,
      makeVaultSettings(null) as never,
      makeLogger() as never,
      makeApp(null) as never,
      makeEvaluator(),
    ).init();

    expect(plugin.registered[0].checkCallback!(true)).toBe(false);
  });

  it("hides the command when the host function is not registered (fail-closed signal)", async () => {
    const plugin = makePlugin();
    const flow = makeFlow();
    const command = {
      ...HOST_FUNCTION_COMMAND,
      precondition: {
        id: "pre-x",
        label: "x",
        hostFunction: "neverRegistered",
      },
    };
    const resolver = makeCommandResolver([
      { command, paletteId: "duplicate-current-asset" },
    ]);

    const uid = "33333333-3333-4333-8333-333333333333";
    await new ExocmdCommandPaletteRegistrar(
      plugin as never,
      resolver as never,
      flow as never,
      makeVaultSettings(null) as never,
      makeLogger() as never,
      makeApp({
        path: `f/${uid}.md`,
        basename: uid,
        parentPath: "f",
        frontmatter: { exo__Asset_uid: uid },
      }) as never,
      makeEvaluator(),
    ).init();

    expect(plugin.registered[0].checkCallback!(true)).toBe(false);
  });

  it("skips and warns for commands with non-host-function preconditions (SPARQL ASK)", async () => {
    const plugin = makePlugin();
    const flow = makeFlow();
    const command = {
      ...HOST_FUNCTION_COMMAND,
      precondition: {
        id: "pre-sparql",
        label: "sparql-only",
        sparqlAsk: "ASK { ?s ?p ?o }",
      },
    };
    const resolver = makeCommandResolver([
      { command, paletteId: "x" },
    ]);
    const logger = makeLogger();

    await new ExocmdCommandPaletteRegistrar(
      plugin as never,
      resolver as never,
      flow as never,
      makeVaultSettings(null) as never,
      logger as never,
      makeApp(null) as never,
      makeEvaluator(),
    ).init();

    // SPARQL-only precondition: falls back to no-target callback (always visible),
    // logged at warn level so misconfiguration is observable.
    expect(plugin.registered[0].callback).toBeDefined();
    expect(plugin.registered[0].checkCallback).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "non-host-function precondition (sparqlAsk/exoql query)",
      ),
    );
  });

  it("falls back to no-target when app/preconditionEvaluator are not injected (backward compat)", async () => {
    const plugin = makePlugin();
    const flow = makeFlow();
    const resolver = makeCommandResolver([
      { command: HOST_FUNCTION_COMMAND, paletteId: "duplicate-current-asset" },
    ]);
    const logger = makeLogger();

    // Five-argument constructor — pre-#3292 caller shape.
    await new ExocmdCommandPaletteRegistrar(
      plugin as never,
      resolver as never,
      flow as never,
      makeVaultSettings(null) as never,
      logger as never,
    ).init();

    expect(plugin.registered[0].callback).toBeDefined();
    expect(plugin.registered[0].checkCallback).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("falling back to always-visible no-target"),
    );
  });
});

import { DynamicCommandButtonGroupBuilder } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { ExocmdBindingsCache } from "../../../../src/cache/ExocmdBindingsCache";
import {
  GroundingType,
  CommandExecutionFlow,
  type CommandPromptAdapter,
  type UserInput,
  type ResolvedCommand,
} from "exocortex";

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

class TestPromptAdapter implements CommandPromptAdapter {
  async confirm(): Promise<boolean> {
    return true;
  }
  async promptInputSchema(): Promise<UserInput | null> {
    return null;
  }
}

const mockGroundingExecutor = {
  execute: jest.fn(),
  substituteVariables: jest.fn(),
};

const mockNotificationService = {
  info: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  confirm: jest.fn().mockResolvedValue(true),
};

function buildCommandExecutionFlow(): CommandExecutionFlow {
  return new CommandExecutionFlow(
    mockGroundingExecutor as any,
    mockNotificationService as any,
    mockLogger as any,
    new TestPromptAdapter(),
  );
}

function makeResolvedCommand(
  id: string,
  category?: string,
): ResolvedCommand {
  return {
    command: {
      id,
      name: `Command ${id}`,
      category,
      grounding: {
        id: `g-${id}`,
        label: `grounding ${id}`,
        type: GroundingType.PROPERTY_SET,
        targetProperty: "x",
        targetValue: "y",
      },
    },
    binding: {
      id: `b-${id}`,
      label: `binding ${id}`,
      commandRef: id,
      targetClass: "ems__Task",
    },
  };
}

function buildContext(metadataOverrides?: Record<string, unknown>) {
  return {
    app: {} as any,
    settings: {} as any,
    plugin: {} as any,
    file: {
      path: "test/file.md",
      parent: { path: "test" },
      basename: "file",
    } as any,
    metadata: {
      exo__Asset_uid: "obsidian://vault/test/file.md",
      exo__Instance_class: ["[[ems__Task]]"],
      ...metadataOverrides,
    },
    instanceClass: "ems__Task",
    visibilityContext: {
      instanceClass: "ems__Task",
      currentStatus: null,
      metadata: {},
      isArchived: false,
      currentFolder: "test",
      expectedFolder: "test",
      classIsPrototype: false,
    },
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any,
    refresh: jest.fn().mockResolvedValue(undefined),
  };
}

function inMemoryFs() {
  const files = new Map<string, string>();
  return {
    __files: files,
    async exists(path: string) {
      return files.has(path);
    },
    async read(path: string) {
      const content = files.get(path);
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    async write(path: string, content: string) {
      files.set(path, content);
    },
    async remove(path: string) {
      files.delete(path);
    },
    async rename(oldPath: string, newPath: string) {
      const content = files.get(oldPath);
      if (content === undefined) throw new Error("ENOENT");
      files.delete(oldPath);
      files.set(newPath, content);
    },
    async mkdir() {
      /* noop */
    },
  };
}

const mockResolveForAssetMulti = jest.fn();
const mockEvaluate = jest.fn();
const mockCommandResolver = {
  resolveForAsset: jest.fn(),
  resolveForAssetMulti: mockResolveForAssetMulti,
  loadCommand: jest.fn(),
  findBindings: jest.fn(),
  invalidateCache: jest.fn(),
};
const mockPreconditionEvaluator = {
  evaluate: mockEvaluate,
  registerHostFunction: jest.fn(),
  hasHostFunction: jest.fn(),
  substituteVariables: jest.fn(),
};

describe("DynamicCommandButtonGroupBuilder — Issue #3183 cache strategy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("serves buttons from the cache when a snapshot hit exists for the primary class", async () => {
    const fs = inMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );
    await cache.save({
      "ems__Task": {
        commands: [makeResolvedCommand("cached-cmd", "creation")],
        preconditions_signature: "fnv1a:12345678",
      },
    });
    await cache.load();

    const builder = new DynamicCommandButtonGroupBuilder({
      commandResolver: mockCommandResolver as any,
      preconditionEvaluator: mockPreconditionEvaluator as any,
      commandExecutionFlow: buildCommandExecutionFlow(),
      bindingsCache: cache,
    });

    const result = await builder.build(buildContext());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dynamic-cmd-cached-cmd");
    // Cache hit must short-circuit the full resolver path entirely.
    expect(mockResolveForAssetMulti).not.toHaveBeenCalled();
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it("falls through to the full path on cache miss (no snapshot loaded)", async () => {
    const fs = inMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );
    // No load() — snapshot stays null.

    mockResolveForAssetMulti.mockResolvedValue([
      makeResolvedCommand("full-cmd", "creation"),
    ]);
    mockEvaluate.mockResolvedValue(true);

    const builder = new DynamicCommandButtonGroupBuilder({
      commandResolver: mockCommandResolver as any,
      preconditionEvaluator: mockPreconditionEvaluator as any,
      commandExecutionFlow: buildCommandExecutionFlow(),
      bindingsCache: cache,
    });

    const result = await builder.build(buildContext());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dynamic-cmd-full-cmd");
    expect(mockResolveForAssetMulti).toHaveBeenCalledTimes(1);
  });

  it("falls through when the snapshot has no entry for any of the asset's classes", async () => {
    const fs = inMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );
    await cache.save({
      "ims__Concept": {
        commands: [makeResolvedCommand("other-cmd")],
        preconditions_signature: "x",
      },
    });
    await cache.load();

    mockResolveForAssetMulti.mockResolvedValue([
      makeResolvedCommand("full-cmd", "creation"),
    ]);
    mockEvaluate.mockResolvedValue(true);

    const builder = new DynamicCommandButtonGroupBuilder({
      commandResolver: mockCommandResolver as any,
      preconditionEvaluator: mockPreconditionEvaluator as any,
      commandExecutionFlow: buildCommandExecutionFlow(),
      bindingsCache: cache,
    });

    const result = await builder.build(buildContext());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dynamic-cmd-full-cmd");
    expect(mockResolveForAssetMulti).toHaveBeenCalledTimes(1);
  });

  it("preserves byte-identical button id between cache hit and full path for the same class", async () => {
    const fs = inMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );
    const cached = makeResolvedCommand("stable-cmd", "creation");
    await cache.save({
      "ems__Task": {
        commands: [cached],
        preconditions_signature: "fnv1a:11111111",
      },
    });
    await cache.load();

    const builderWithCache = new DynamicCommandButtonGroupBuilder({
      commandResolver: mockCommandResolver as any,
      preconditionEvaluator: mockPreconditionEvaluator as any,
      commandExecutionFlow: buildCommandExecutionFlow(),
      bindingsCache: cache,
    });
    const cachedResult = await builderWithCache.build(buildContext());

    // Fresh builder without cache, but full path produces the same resolved
    // command (by construction). Button id is derived from `command.id` only
    // — identical id ⇒ DOM-stable rerender (AC #3 zero unmount).
    mockResolveForAssetMulti.mockResolvedValue([cached]);
    mockEvaluate.mockResolvedValue(true);
    const builderNoCache = new DynamicCommandButtonGroupBuilder({
      commandResolver: mockCommandResolver as any,
      preconditionEvaluator: mockPreconditionEvaluator as any,
      commandExecutionFlow: buildCommandExecutionFlow(),
    });
    const fullResult = await builderNoCache.build(buildContext());

    expect(cachedResult.map((b) => b.id)).toEqual(fullResult.map((b) => b.id));
    expect(cachedResult.map((b) => b.label)).toEqual(
      fullResult.map((b) => b.label),
    );
  });

  it("emits a one-shot performance.mark on cache hit across multiple build() calls", async () => {
    const fs = inMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );
    await cache.save({
      "ems__Task": {
        commands: [makeResolvedCommand("c", "creation")],
        preconditions_signature: "x",
      },
    });
    await cache.load();

    // jsdom does not implement Web Performance API marks/measures; swap
    // the stubs from `setup-reflect-metadata.ts` with jest spies so we
    // can assert the one-shot guard.
    const perfRecord = performance as unknown as Record<string, unknown>;
    const originalMark = perfRecord["mark"];
    const originalMeasure = perfRecord["measure"];
    const originalGet = perfRecord["getEntriesByName"];
    const markSpy = jest.fn();
    perfRecord["mark"] = markSpy;
    perfRecord["measure"] = jest.fn();
    perfRecord["getEntriesByName"] = jest
      .fn()
      .mockReturnValue([{ name: "exocmd-cache-read-start" }]);

    try {
      const builder = new DynamicCommandButtonGroupBuilder({
        commandResolver: mockCommandResolver as any,
        preconditionEvaluator: mockPreconditionEvaluator as any,
        commandExecutionFlow: buildCommandExecutionFlow(),
        bindingsCache: cache,
      });
      await builder.build(buildContext());
      await builder.build(buildContext());

      const appliedCalls = markSpy.mock.calls.filter(
        ([label]) => label === "exocmd-cache-applied",
      );
      expect(appliedCalls).toHaveLength(1);
    } finally {
      perfRecord["mark"] = originalMark;
      perfRecord["measure"] = originalMeasure;
      perfRecord["getEntriesByName"] = originalGet;
    }
  });

  it("falls through cleanly when no bindingsCache is configured (legacy behaviour)", async () => {
    mockResolveForAssetMulti.mockResolvedValue([
      makeResolvedCommand("legacy-cmd", "creation"),
    ]);
    mockEvaluate.mockResolvedValue(true);

    const builder = new DynamicCommandButtonGroupBuilder({
      commandResolver: mockCommandResolver as any,
      preconditionEvaluator: mockPreconditionEvaluator as any,
      commandExecutionFlow: buildCommandExecutionFlow(),
    });
    const result = await builder.build(buildContext());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dynamic-cmd-legacy-cmd");
  });
});

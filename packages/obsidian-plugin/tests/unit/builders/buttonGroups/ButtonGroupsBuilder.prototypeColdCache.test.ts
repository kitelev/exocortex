/**
 * classIsPrototype under a COLD metadataCache — @req:c3072a80-5b1b-433e-b5b3-57006ff47682
 *
 * On a cold cache both of the old cache reads fail (`getFirstLinkpathDest` -> null,
 * then `getFileCache` -> null) and the fall-through yields `false`, so a prototype
 * silently renders the ORDINARY button set. These axes lock the fix: the class file
 * is located through the vault adapter (which falls back to the file registry, req
 * 7d00a60b) and its frontmatter is read with the adapter's disk fallback.
 *
 * ⛔ A mutant on `1bd848a6` that reduced BOTH copies of `resolveClassIsPrototype` to
 * `return false` left 18 suites / 275 tests green — the property was specified by
 * nothing. That is why these axes exist.
 */
import {
  setupButtonGroupsBuilderTest,
  ButtonGroupsBuilderTestContext,
  TFile,
} from "./ButtonGroupsBuilder.fixtures";

const PROTOTYPE_UID = "ebf717aa-4070-4b37-abde-10a700e354fc";

/** A class file whose frontmatter marks it as a prototype. */
const classFile = { path: "classes/Proto.md", basename: "Proto", name: "Proto.md" };

/**
 * An adapter whose cache is COLD: it resolves the class file (the file registry
 * still works) and only yields frontmatter through the disk fallback.
 */
function coldAdapter(opts: { withFallback?: boolean } = {}) {
  const withFallback = opts.withFallback !== false;
  const adapter: Record<string, unknown> = {
    getFirstLinkpathDest: jest.fn().mockReturnValue(classFile),
    // cold cache: the synchronous, cache-backed read yields nothing
    getFrontmatter: jest.fn().mockReturnValue(null),
  };
  if (withFallback) {
    adapter.getFrontmatterWithFallback = jest
      .fn()
      .mockResolvedValue({ exo__Instance_class: `[[${PROTOTYPE_UID}]]` });
  }
  return adapter;
}

/** Drive `build()` far enough to compute the visibility context, and capture it. */
async function captureContext(ctx: ButtonGroupsBuilderTestContext) {
  const captured: Record<string, unknown>[] = [];
  (ctx.builder as unknown as { builders: unknown[] }).builders = [
    {
      build: async (c: { visibilityContext: Record<string, unknown> }) => {
        captured.push(c.visibilityContext);
        return []; // no buttons — the group is dropped, we only want the context
      },
      getGroupId: () => "capture",
      getGroupTitle: () => "capture",
    },
  ];

  const file = { path: "n.md", parent: { path: "N" }, basename: "n" } as TFile;
  ctx.mockMetadataExtractor.extractMetadata.mockReturnValue({});
  ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue("[[Proto]]");
  ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
  ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
  ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(null);

  await ctx.builder.build(file);
  return captured[0];
}

describe("ButtonGroupsBuilder — classIsPrototype on a cold metadataCache", () => {
  let ctx: ButtonGroupsBuilderTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupButtonGroupsBuilderTest();
  });

  it("P1 resolves a prototype class from disk when the cache is cold", async () => {
    ctx.mockPlugin.vaultAdapter = coldAdapter();

    const result = await (
      ctx.builder as unknown as {
        resolveClassIsPrototype: (c: string) => Promise<boolean>;
      }
    ).resolveClassIsPrototype("[[Proto]]");

    expect(result).toBe(true);
  });

  it("P2 locates the class file through the ADAPTER, not the raw metadataCache", async () => {
    const adapter = coldAdapter();
    ctx.mockPlugin.vaultAdapter = adapter;

    await captureContext(ctx);

    expect(adapter.getFirstLinkpathDest).toHaveBeenCalled();
  });

  it("P3 reads the class frontmatter through the DISK fallback", async () => {
    const adapter = coldAdapter();
    ctx.mockPlugin.vaultAdapter = adapter;

    await captureContext(ctx);

    expect(adapter.getFrontmatterWithFallback).toHaveBeenCalled();
  });

  it("P4 puts a resolved BOOLEAN into the visibility context (locks the await)", async () => {
    ctx.mockPlugin.vaultAdapter = coldAdapter();

    const visibility = await captureContext(ctx);

    // ⛔ Without the `await` at the call site this is a Promise — truthy, so a
    // plain `toBe(true)` would NOT catch it. Assert the type as well.
    expect(typeof visibility.classIsPrototype).toBe("boolean");
    expect(visibility.classIsPrototype).toBe(true);
  });

  it("P5 degrades to the cached getFrontmatter when the adapter has no disk fallback", async () => {
    const adapter = coldAdapter({ withFallback: false });
    (adapter.getFrontmatter as jest.Mock).mockReturnValue({
      exo__Instance_class: `[[${PROTOTYPE_UID}]]`,
    });
    ctx.mockPlugin.vaultAdapter = adapter;

    const visibility = await captureContext(ctx);

    expect(adapter.getFrontmatter).toHaveBeenCalled();
    expect(visibility.classIsPrototype).toBe(true);
  });

  it("P6 keeps the legacy metadataCache path when no adapter is wired", async () => {
    ctx.mockPlugin.vaultAdapter = undefined;
    ctx.mockApp.metadataCache = {
      getFirstLinkpathDest: jest.fn().mockReturnValue(classFile),
      getFileCache: jest.fn().mockReturnValue({
        frontmatter: { exo__Instance_class: `[[${PROTOTYPE_UID}]]` },
      }),
    };

    const visibility = await captureContext(ctx);

    expect(ctx.mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalled();
    expect(visibility.classIsPrototype).toBe(true);
  });
});

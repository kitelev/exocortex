/**
 * Issue #3258 — unit tests for the vault-frontmatter-backed
 * {@link createVaultFrontmatterClassLabelResolver}.
 *
 * Why a fake `IFileSystemMetadataProvider` rather than a temp-fs adapter:
 * the resolver is a pure delegation over `findFilesByMetadata` +
 * `getFileMetadata`. Exercising the integration with the real
 * `NodeFsAdapter` happens in the CLI integration test
 * (`packages/cli/tests/integration/apply-class-resolver.integration.test.ts`)
 * which builds a real temp vault. These unit tests stay focused on the
 * branch matrix.
 */
import { createVaultFrontmatterClassLabelResolver } from "../../../src/services/VaultFrontmatterClassLabelResolver";
import type { IFileSystemMetadataProvider } from "../../../src/interfaces/IFileSystemAdapter";

function makeProvider(opts: {
  labelMatches?: Record<string, string[]>;
  aliasMatches?: Record<string, string[]>;
  frontmatters?: Record<string, Record<string, unknown>>;
}): IFileSystemMetadataProvider & {
  byLabelCalls: number;
  byAliasCalls: number;
} {
  const labelMatches = opts.labelMatches ?? {};
  const aliasMatches = opts.aliasMatches ?? {};
  const fms = opts.frontmatters ?? {};
  const tracker = { byLabelCalls: 0, byAliasCalls: 0 };

  return {
    ...tracker,
    async findFilesByMetadata(query: Record<string, unknown>): Promise<string[]> {
      if ("exo__Asset_label" in query) {
        tracker.byLabelCalls++;
        return labelMatches[String(query.exo__Asset_label)] ?? [];
      }
      if ("aliases" in query) {
        tracker.byAliasCalls++;
        return aliasMatches[String(query.aliases)] ?? [];
      }
      return [];
    },
    async getFileMetadata(path: string): Promise<Record<string, unknown>> {
      return fms[path] ?? {};
    },
    async findFileByUID(_uid: string): Promise<string | null> {
      return null;
    },
    get byLabelCalls() {
      return tracker.byLabelCalls;
    },
    get byAliasCalls() {
      return tracker.byAliasCalls;
    },
  } as IFileSystemMetadataProvider & {
    byLabelCalls: number;
    byAliasCalls: number;
  };
}

describe("createVaultFrontmatterClassLabelResolver (#3258)", () => {
  it("resolves a label-form ref by exo__Asset_label", async () => {
    const provider = makeProvider({
      labelMatches: { "ems__Task": ["1b20a8f0.md"] },
      frontmatters: {
        "1b20a8f0.md": {
          exo__Asset_label: "ems__Task",
          exo__Asset_uid: "1b20a8f0-d745-4e93-91db-4531b3df120e",
        },
      },
    });
    const resolver = createVaultFrontmatterClassLabelResolver(provider);
    expect(await resolver("ems__Task")).toBe(
      "1b20a8f0-d745-4e93-91db-4531b3df120e",
    );
  });

  it("falls back to aliases when exo__Asset_label has no match", async () => {
    const provider = makeProvider({
      labelMatches: {},
      aliasMatches: { "ems__Task": ["1b20a8f0.md"] },
      frontmatters: {
        "1b20a8f0.md": {
          aliases: ["ems__Task"],
          exo__Asset_uid: "1b20a8f0-d745-4e93-91db-4531b3df120e",
        },
      },
    });
    const resolver = createVaultFrontmatterClassLabelResolver(provider);
    expect(await resolver("ems__Task")).toBe(
      "1b20a8f0-d745-4e93-91db-4531b3df120e",
    );
  });

  it("prefers exo__Asset_label match over aliases match (label is primary)", async () => {
    // Two different files: one wins by label, the other by alias.
    const provider = makeProvider({
      labelMatches: { foo: ["primary.md"] },
      aliasMatches: { foo: ["secondary.md"] },
      frontmatters: {
        "primary.md": { exo__Asset_uid: "primary-uid" },
        "secondary.md": { exo__Asset_uid: "secondary-uid" },
      },
    });
    const resolver = createVaultFrontmatterClassLabelResolver(provider);
    expect(await resolver("foo")).toBe("primary-uid");
    expect(provider.byAliasCalls).toBe(0); // short-circuited on label hit
  });

  it("returns null when neither label nor alias match", async () => {
    const provider = makeProvider({});
    const resolver = createVaultFrontmatterClassLabelResolver(provider);
    expect(await resolver("nonexistent")).toBeNull();
    expect(provider.byLabelCalls).toBe(1);
    expect(provider.byAliasCalls).toBe(1);
  });

  it("returns null for empty input without touching the filesystem", async () => {
    const provider = makeProvider({});
    const resolver = createVaultFrontmatterClassLabelResolver(provider);
    expect(await resolver("")).toBeNull();
    expect(provider.byLabelCalls).toBe(0);
    expect(provider.byAliasCalls).toBe(0);
  });

  it("returns null when matched file has no exo__Asset_uid", async () => {
    const provider = makeProvider({
      labelMatches: { orphan: ["orphan.md"] },
      frontmatters: {
        "orphan.md": { exo__Asset_label: "orphan" /* no uid */ },
      },
    });
    const resolver = createVaultFrontmatterClassLabelResolver(provider);
    // Falls through to alias lookup, which also misses → null.
    expect(await resolver("orphan")).toBeNull();
  });

  it("returns null when exo__Asset_uid is empty string", async () => {
    const provider = makeProvider({
      labelMatches: { foo: ["foo.md"] },
      frontmatters: { "foo.md": { exo__Asset_uid: "" } },
    });
    const resolver = createVaultFrontmatterClassLabelResolver(provider);
    expect(await resolver("foo")).toBeNull();
  });

  it("returns null when exo__Asset_uid is not a string", async () => {
    const provider = makeProvider({
      labelMatches: { foo: ["foo.md"] },
      frontmatters: { "foo.md": { exo__Asset_uid: 12345 } },
    });
    const resolver = createVaultFrontmatterClassLabelResolver(provider);
    expect(await resolver("foo")).toBeNull();
  });
});

import type { App } from "obsidian";

import { LocalSecretsStore } from "../../src/infrastructure/adapters/LocalSecretsStore";

function makeFakeApp(): { app: App; files: Map<string, string> } {
  const files = new Map<string, string>();
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => {
          const v = files.get(p);
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
        write: async (p: string, d: string) => {
          files.set(p, d);
        },
      },
    },
  } as unknown as App;
  return { app, files };
}

const DEFAULT_PATH = ".obsidian/plugins/exocortex/data.local.json";

describe("LocalSecretsStore.readAll", () => {
  it("returns empty record when file does not exist", async () => {
    const { app } = makeFakeApp();
    const store = new LocalSecretsStore({ app });
    expect(await store.readAll()).toEqual({});
  });

  it("returns parsed secrets from file", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, JSON.stringify({ pat: "ghp_AAAA", other: "val" }));
    const store = new LocalSecretsStore({ app });
    expect(await store.readAll()).toEqual({ pat: "ghp_AAAA", other: "val" });
  });

  it("returns empty on malformed JSON", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, "{ not json");
    const store = new LocalSecretsStore({ app });
    expect(await store.readAll()).toEqual({});
  });

  it("skips non-string values", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, JSON.stringify({ pat: "ghp_X", count: 42, flag: true, nested: { foo: "bar" } }));
    const store = new LocalSecretsStore({ app });
    expect(await store.readAll()).toEqual({ pat: "ghp_X" });
  });
});

describe("LocalSecretsStore.getSecret / setSecret", () => {
  it("returns null for missing key", async () => {
    const { app } = makeFakeApp();
    const store = new LocalSecretsStore({ app });
    expect(await store.getSecret("pat")).toBeNull();
  });

  it("sets and reads back a secret", async () => {
    const { app } = makeFakeApp();
    const store = new LocalSecretsStore({ app });
    await store.setSecret("pat", "ghp_AAAA");
    expect(await store.getSecret("pat")).toBe("ghp_AAAA");
  });

  it("overwrites existing secret value", async () => {
    const { app } = makeFakeApp();
    const store = new LocalSecretsStore({ app });
    await store.setSecret("pat", "ghp_AAAA");
    await store.setSecret("pat", "ghp_BBBB");
    expect(await store.getSecret("pat")).toBe("ghp_BBBB");
  });

  it("deletes entry when value is null", async () => {
    const { app } = makeFakeApp();
    const store = new LocalSecretsStore({ app });
    await store.setSecret("pat", "ghp_AAAA");
    await store.setSecret("pat", null);
    expect(await store.getSecret("pat")).toBeNull();
    expect(await store.readAll()).toEqual({});
  });

  it("deletes entry when value is empty string", async () => {
    const { app } = makeFakeApp();
    const store = new LocalSecretsStore({ app });
    await store.setSecret("pat", "ghp_AAAA");
    await store.setSecret("pat", "");
    expect(await store.getSecret("pat")).toBeNull();
  });

  it("setting one secret preserves others", async () => {
    const { app } = makeFakeApp();
    const store = new LocalSecretsStore({ app });
    await store.setSecret("pat", "ghp_AAAA");
    await store.setSecret("other", "VAL");
    expect(await store.readAll()).toEqual({ pat: "ghp_AAAA", other: "VAL" });
  });
});

describe("LocalSecretsStore.clearAll", () => {
  it("removes all secrets", async () => {
    const { app } = makeFakeApp();
    const store = new LocalSecretsStore({ app });
    await store.setSecret("a", "1");
    await store.setSecret("b", "2");
    await store.clearAll();
    expect(await store.readAll()).toEqual({});
  });

  it("preserves non-string sibling-store keys (Issue #3327 cross-store)", async () => {
    const { app, files } = makeFakeApp();
    // Sibling store (e.g. PluginLocalDataStore) wrote a boolean key first.
    files.set(
      DEFAULT_PATH,
      JSON.stringify({ pat: "ghp_BEFORE", _switchInProgress: true }),
    );
    const store = new LocalSecretsStore({ app });
    await store.clearAll();
    // Secrets gone, sibling-store boolean preserved.
    const parsed = JSON.parse(files.get(DEFAULT_PATH) ?? "{}");
    expect(parsed.pat).toBeUndefined();
    expect(parsed._switchInProgress).toBe(true);
  });
});

describe("LocalSecretsStore cross-store coexistence (Issue #3327 Item #3)", () => {
  it("setSecret preserves non-string sibling-store keys (RMW lossless)", async () => {
    const { app, files } = makeFakeApp();
    // Pre-seed file simulating PluginLocalDataStore having written booleans + null.
    files.set(
      DEFAULT_PATH,
      JSON.stringify({
        _switchInProgress: true,
        activeProfileUid: null,
      }),
    );
    const store = new LocalSecretsStore({ app });
    await store.setSecret("pat", "ghp_NEW");
    const parsed = JSON.parse(files.get(DEFAULT_PATH) ?? "{}");
    expect(parsed.pat).toBe("ghp_NEW");
    // Sibling-store keys preserved across the RMW.
    expect(parsed._switchInProgress).toBe(true);
    expect(parsed.activeProfileUid).toBeNull();
  });

  it("setSecret null also preserves non-string sibling-store keys", async () => {
    const { app, files } = makeFakeApp();
    files.set(
      DEFAULT_PATH,
      JSON.stringify({
        pat: "ghp_TO_BE_CLEARED",
        _switchInProgress: true,
      }),
    );
    const store = new LocalSecretsStore({ app });
    await store.setSecret("pat", null);
    const parsed = JSON.parse(files.get(DEFAULT_PATH) ?? "{}");
    expect(parsed.pat).toBeUndefined();
    expect(parsed._switchInProgress).toBe(true);
  });
});

describe("LocalSecretsStore.mask", () => {
  it("returns empty string for null/empty input", () => {
    expect(LocalSecretsStore.mask(null)).toBe("");
    expect(LocalSecretsStore.mask("")).toBe("");
  });

  it("masks short strings entirely (≤8 chars)", () => {
    expect(LocalSecretsStore.mask("abc")).toBe("***");
    expect(LocalSecretsStore.mask("12345678")).toBe("********");
  });

  it("shows last 4 chars for typical PAT-length secrets", () => {
    const pat = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 40 chars
    const masked = LocalSecretsStore.mask(pat);
    expect(masked.endsWith("AAAA")).toBe(true);
    expect(masked.startsWith("*")).toBe(true);
    expect(masked.length).toBe(pat.length);
  });
});

describe("LocalSecretsStore custom path", () => {
  it("honours custom path", async () => {
    const { app, files } = makeFakeApp();
    const store = new LocalSecretsStore({ app, path: "custom/secrets.json" });
    await store.setSecret("pat", "ghp_X");
    expect(files.has("custom/secrets.json")).toBe(true);
    expect(files.has(DEFAULT_PATH)).toBe(false);
  });
});

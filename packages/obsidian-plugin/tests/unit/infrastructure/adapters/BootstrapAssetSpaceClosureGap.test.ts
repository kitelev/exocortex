import {
  BootstrapAssetSpaceCommands,
  type BootstrapAssetSpaceCommandsDeps,
  type IRestBootstrapMount,
} from "../../../../src/infrastructure/adapters/BootstrapAssetSpaceCommands";
import type { AssetSpaceInfo } from "../../../../src/infrastructure/adapters/AssetSpaceManager";

// issue #3956 — the PLUGIN «Add AssetSpace by URL» command must warn SPECIFICALLY
// when the just-added AssetSpace's exo__AssetSpace_dependsOn-closure member (esp.
// the exocmd class-TBox) is not materialized — the exact subset-add gap that left
// the alpha tester's homoiconic command system silently dead.

const PUBLIC_URL = "https://github.com/kitelev/exoas-public";
const PUBLIC_UID = "aaaa1111-0000-0000-0000-000000000001";
const EXOCMD_UID = "bbbb2222-0000-0000-0000-000000000002";

function info(
  uid: string,
  namespace: string,
  git: string,
  dependsOn?: string[],
): AssetSpaceInfo {
  return {
    uid,
    git,
    namespace,
    folderName: `assetspaces/kitelev/exoas-${namespace}`,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

function makeAddHarness(opts: {
  closureInputs?: { infos: AssetSpaceInfo[]; materializedUids: Set<string> };
  wireDep?: boolean;
}): { cmds: BootstrapAssetSpaceCommands; notices: string[] } {
  const notices: string[] = [];
  const restMount: IRestBootstrapMount = {
    mount: jest.fn(async () => ({ sha: "abc1234" })),
    listMountedAssetSpaces: jest.fn(async () => []),
  };
  const wireDep = opts.wireDep ?? true;
  const deps: BootstrapAssetSpaceCommandsDeps = {
    restMount,
    vaultExists: async () => false,
    listFolder: async () => ({ files: [], folders: [] }),
    isGitVault: async () => false,
    validateUrl: () => undefined,
    deriveFolderName: (u) => u.split("/").pop()!.replace(/^exoas-/, ""),
    promptBootstrapUrls: async () => null,
    promptAddAssetSpaceUrl: async () => ({ url: PUBLIC_URL }),
    confirm: async () => true,
    notify: (m: string) => notices.push(m),
    getClosureCheckInputs:
      wireDep && opts.closureInputs !== undefined
        ? async () => opts.closureInputs!
        : undefined,
  };
  return { cmds: new BootstrapAssetSpaceCommands(deps), notices };
}

describe("BootstrapAssetSpaceCommands.invokeAddAssetSpace — dependsOn-closure gap (#3956)", () => {
  it("warns specifically, naming the unmounted TBox closure member (exocmd) — @req:69f13500-5a86-4ca5-a98c-1be0ff9c6aa6", async () => {
    const h = makeAddHarness({
      closureInputs: {
        infos: [
          info(PUBLIC_UID, "public", PUBLIC_URL, [EXOCMD_UID]),
          info(EXOCMD_UID, "exocmd", "https://github.com/kitelev/exoas-exocmd"),
        ],
        // exoas-public just added (materialized); exoas-exocmd NOT mounted.
        materializedUids: new Set([PUBLIC_UID]),
      },
    });

    await h.cmds.invokeAddAssetSpace();

    // The add succeeded (a notice was emitted) AND it names the missing member
    // + flags it as a TBox-provider + points to the remedy.
    const gap = h.notices.find((n) => /not mounted/.test(n));
    expect(gap).toBeDefined();
    expect(gap).toContain("depends on {exocmd}");
    expect(gap).toContain("class / command TBox");
    expect(gap).toMatch(/Apply profile.*Add AssetSpace by URL/);
    // The generic "dependencies are not auto-resolved" advisory is REPLACED by
    // the specific warning (no double-advisory).
    expect(gap).not.toContain("dependencies are not auto-resolved");
  });

  it("emits NO closure warning when the full closure is materialized (no false-positive)", async () => {
    const h = makeAddHarness({
      closureInputs: {
        infos: [
          info(PUBLIC_UID, "public", PUBLIC_URL, [EXOCMD_UID]),
          info(EXOCMD_UID, "exocmd", "https://github.com/kitelev/exoas-exocmd"),
        ],
        materializedUids: new Set([PUBLIC_UID, EXOCMD_UID]),
      },
    });

    await h.cmds.invokeAddAssetSpace();

    expect(h.notices.some((n) => /not mounted/.test(n))).toBe(false);
    // Add still completes with the success notice.
    expect(h.notices.some((n) => /AssetSpace added/.test(n))).toBe(true);
  });

  it("falls back to the generic advisory when the closure-inputs dep is not wired", async () => {
    const h = makeAddHarness({ wireDep: false });

    await h.cmds.invokeAddAssetSpace();

    expect(
      h.notices.some((n) => /dependencies are not auto-resolved/.test(n)),
    ).toBe(true);
    expect(h.notices.some((n) => /not mounted/.test(n))).toBe(false);
  });
});

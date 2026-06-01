import type { App } from "obsidian";

import {
  applyActiveProfileFilter,
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  TS_FLOOR_ASSETSPACE_UIDS,
  type IEffectiveOntologyAwareIndexer,
} from "../../src/infrastructure/adapters/FocusProfileOnloadWiring";
import {
  ASSET_SPACE_CLASS_UID,
} from "../../src/infrastructure/adapters/AssetSpaceManager";
import {
  FocusProfileSwitchManager,
} from "../../src/infrastructure/adapters/FocusProfileSwitchManager";
import type { ILogger } from "exocortex";

// ─── Fakes ────────────────────────────────────────────────────────────────

interface FakeFile {
  path: string;
  basename: string;
}

function makeApp(
  files: { file: FakeFile; fm: Record<string, unknown> | null }[],
): App {
  const fileList = files.map((f) => f.file);
  const fmByPath = new Map(files.map((f) => [f.file.path, f.fm]));
  return {
    vault: {
      getMarkdownFiles: () => fileList,
      adapter: {
        exists: async () => false,
        read: async () => "",
        write: async () => undefined,
      },
    },
    metadataCache: {
      getFileCache: (file: FakeFile) => {
        const fm = fmByPath.get(file.path);
        return fm !== undefined && fm !== null ? { frontmatter: fm } : null;
      },
    },
  } as unknown as App;
}

function makeIndexerStub(): IEffectiveOntologyAwareIndexer & {
  effective: ReadonlySet<string> | null;
  folderMap: ReadonlyMap<string, string> | null;
} {
  const stub = {
    effective: null as ReadonlySet<string> | null,
    folderMap: null as ReadonlyMap<string, string> | null,
    setEffectiveOntologies(set: ReadonlySet<string> | null): void {
      stub.effective = set;
    },
    setAssetSpaceFolderToUid(map: ReadonlyMap<string, string> | null): void {
      stub.folderMap = map;
    },
  };
  return stub;
}

function makeLogger(): ILogger & {
  warns: string[];
  infos: string[];
} {
  const warns: string[] = [];
  const infos: string[] = [];
  return {
    warns,
    infos,
    debug: () => undefined,
    info: (msg: string) => {
      infos.push(msg);
    },
    warn: (msg: string) => {
      warns.push(msg);
    },
    error: () => undefined,
  } as unknown as ILogger & { warns: string[]; infos: string[] };
}

function makeSwitchMgrStub(
  effectiveSet: Set<string> | Error,
): FocusProfileSwitchManager {
  return {
    resolveEffectiveSet: async (_uid: string) => {
      if (effectiveSet instanceof Error) throw effectiveSet;
      return effectiveSet;
    },
  } as unknown as FocusProfileSwitchManager;
}

// Helper: standard AssetSpace frontmatter shape — uid + containsOntology[]
function asFrontmatter(uid: string, containsOntology: string[]): Record<string, unknown> {
  return {
    exo__Asset_uid: uid,
    exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
    exo__AssetSpace_containsOntology: containsOntology.map((o) => `[[${o}]]`),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("applyActiveProfileFilter", () => {
  it("returns no-profile and wipes prior state when activeProfileUid=null", async () => {
    const app = makeApp([]);
    const indexer = makeIndexerStub();
    indexer.setEffectiveOntologies(new Set(["stale"]));
    indexer.setAssetSpaceFolderToUid(new Map([["stale-folder", "stale-uid"]]));
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set());

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: null,
      logger,
    });

    expect(result.outcome).toBe("no-profile");
    expect(result.effective).toBeNull();
    expect(result.folderMap).toBeNull();
    expect(indexer.effective).toBeNull();
    expect(indexer.folderMap).toBeNull();
  });

  it("translates Ontology UIDs to AS UIDs via containsOntology and wires filter", async () => {
    const ontologyExo = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";
    const ontologyEms = "d9bd496e-86cf-496d-b2da-e5f68cc3e7bc";
    const asExo = TS_FLOOR_AS_UID_EXO;
    const asEms = "f0f674da-a31b-47e1-b0e8-f984b018bf75";

    const app = makeApp([
      {
        file: { path: "assetspaces/exo/49fd2e56.md", basename: "exo" },
        fm: asFrontmatter(asExo, [ontologyExo]),
      },
      {
        file: { path: "assetspaces/ems/f0f674da.md", basename: "ems" },
        fm: asFrontmatter(asEms, [ontologyEms]),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set([ontologyExo, ontologyEms]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    expect(indexer.effective).not.toBeNull();
    expect(indexer.effective!.has(asExo)).toBe(true);
    expect(indexer.effective!.has(asEms)).toBe(true);
    // Ontology UIDs themselves should NOT leak into the effective set.
    expect(indexer.effective!.has(ontologyExo)).toBe(false);
    expect(indexer.folderMap!.get("assetspaces/exo")).toBe(asExo);
    expect(indexer.folderMap!.get("assetspaces/ems")).toBe(asEms);
  });

  it("layers TS-floor AS UIDs into the effective set on engagement", async () => {
    const ontologyExo = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";
    const ontologyEms = "d9bd496e-86cf-496d-b2da-e5f68cc3e7bc";
    const asEms = "f0f674da-a31b-47e1-b0e8-f984b018bf75";

    // Vault has ALL three AS so the TS-floor UIDs land in folderMap and
    // engagement can verify overlap. Profile declares only EMS Ontology —
    // floor adds $exo/$exocmd/$shared-identities anyway.
    const app = makeApp([
      {
        file: { path: "assetspaces/exo/exo.md", basename: "exo" },
        fm: asFrontmatter(TS_FLOOR_AS_UID_EXO, [ontologyExo]),
      },
      {
        file: { path: "assetspaces/exocmd/exocmd.md", basename: "exocmd" },
        fm: asFrontmatter(TS_FLOOR_AS_UID_EXOCMD, []),
      },
      {
        file: { path: "assetspaces/shared-identities/si.md", basename: "si" },
        fm: asFrontmatter(TS_FLOOR_AS_UID_SHARED_IDENTITIES, []),
      },
      {
        file: { path: "assetspaces/ems/ems.md", basename: "ems" },
        fm: asFrontmatter(asEms, [ontologyEms]),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set([ontologyEms]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    expect(indexer.effective!.has(asEms)).toBe(true);
    for (const floor of TS_FLOOR_ASSETSPACE_UIDS) {
      expect(indexer.effective!.has(floor)).toBe(true);
    }
  });

  it("passes through entries that are already AS UIDs without translation", async () => {
    const asExo = TS_FLOOR_AS_UID_EXO;
    const app = makeApp([
      {
        file: { path: "assetspaces/exo/exo.md", basename: "exo" },
        fm: asFrontmatter(asExo, []),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    // Profile declares the AS UID directly (future-proof shape).
    const switchMgr = makeSwitchMgrStub(new Set([asExo]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    expect(indexer.effective!.has(asExo)).toBe(true);
  });

  it("degrades to no-filter and logs WARN when zero folder overlap", async () => {
    // Profile declares an Ontology UID with no `containsOntology` declaration
    // anywhere — translation fails for every entry, TS-floor УIDs land but the
    // vault has none of the TS-floor AssetSpaces, so overlap is empty.
    const unknownOntology = "d1195402-73a5-45ed-965f-3a435a553e6a";
    const someOtherAs = "feedface-feed-face-feed-facefeedface";

    const app = makeApp([
      {
        file: { path: "assetspaces/other/other.md", basename: "other" },
        // AS frontmatter but does NOT declare unknownOntology in containsOntology.
        fm: asFrontmatter(someOtherAs, []),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set([unknownOntology]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("degraded");
    expect(indexer.effective).toBeNull();
    expect(indexer.folderMap).toBeNull();
    expect(logger.warns.length).toBeGreaterThan(0);
    expect(logger.warns[0]).toMatch(/zero AssetSpace folder overlap/);
  });

  it("degrades when switchMgr.resolveEffectiveSet throws", async () => {
    const app = makeApp([]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Error("boom"));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("error");
    expect(indexer.effective).toBeNull();
    expect(indexer.folderMap).toBeNull();
    expect(logger.warns[0]).toMatch(/resolveEffectiveSet/);
  });

  it("skips files lacking AssetSpace Instance_class in folderMap scan", async () => {
    const asExo = TS_FLOOR_AS_UID_EXO;
    const ontologyExo = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";

    const app = makeApp([
      // Genuine AssetSpace declaration.
      {
        file: { path: "assetspaces/exo/exo.md", basename: "exo" },
        fm: asFrontmatter(asExo, [ontologyExo]),
      },
      // Unrelated asset in the same folder (e.g. an ABox node) — should NOT
      // overwrite the folder map entry from the AssetSpace declaration.
      {
        file: { path: "assetspaces/exo/random.md", basename: "random" },
        fm: {
          exo__Asset_uid: "deadbeef",
          exo__Instance_class: ["[[other-class]]"],
        },
      },
      // File outside assetspaces — irrelevant.
      {
        file: { path: "Notes/foo.md", basename: "foo" },
        fm: { exo__Asset_uid: "note-uid" },
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set([ontologyExo]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    expect(indexer.folderMap!.size).toBe(1);
    expect(indexer.folderMap!.get("assetspaces/exo")).toBe(asExo);
  });

  it("handles single-string containsOntology (not just array form)", async () => {
    const ontologyExo = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";
    const asExo = TS_FLOOR_AS_UID_EXO;
    const app = makeApp([
      {
        file: { path: "assetspaces/exo/exo.md", basename: "exo" },
        fm: {
          exo__Asset_uid: asExo,
          exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}]]`],
          // String, not array — Obsidian parser may produce either shape.
          exo__AssetSpace_containsOntology: `[[${ontologyExo}]]`,
        },
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set([ontologyExo]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    expect(indexer.effective!.has(asExo)).toBe(true);
  });
});

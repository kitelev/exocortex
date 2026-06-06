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

// Helper: standard AssetSpace frontmatter shape — uid + containsOntology[].
// RFC 01a83de8 Phase 1b T3 — discovery is class-based + `derivePath(_source)`,
// the path-prefix branch is gone. So every AssetSpace fixture MUST declare a
// `_source` (now SHACL-required) for the discovery scan to map it. `repo`
// defaults to `uid` (any unique URL yields a derived folder entry); pass an
// explicit repo when the test asserts a specific `folderMap` key.
function asFrontmatter(
  uid: string,
  containsOntology: string[],
  repo: string = uid,
): Record<string, unknown> {
  return {
    exo__Asset_uid: uid,
    exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
    exo__AssetSpace_source: `https://github.com/kitelev/exoas-${repo}`,
    exo__AssetSpace_containsOntology: containsOntology.map((o) => `[[${o}]]`),
  };
}

/** Derived mount folder for a given repo — `derivePath` of the helper's source. */
function derivedFolder(repo: string): string {
  return `assetspaces/kitelev/exoas-${repo}`;
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
        fm: asFrontmatter(asExo, [ontologyExo], "exo"),
      },
      {
        file: { path: "assetspaces/ems/f0f674da.md", basename: "ems" },
        fm: asFrontmatter(asEms, [ontologyEms], "ems"),
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
    expect(indexer.folderMap!.get(derivedFolder("exo"))).toBe(asExo);
    expect(indexer.folderMap!.get(derivedFolder("ems"))).toBe(asEms);
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
    // Use a NON-TS-floor AS UID so the assertion exercises the pass-through
    // branch genuinely — if we asserted on a TS-floor UID, the floor injection
    // would mask removal of the pass-through logic (revert-fail/restore-pass
    // discipline per `~/.claude/rules/integration-test-revert-verify.md`).
    const asEms = "f0f674da-a31b-47e1-b0e8-f984b018bf75";
    const app = makeApp([
      {
        file: { path: "assetspaces/ems/ems.md", basename: "ems" },
        // Note: empty containsOntology — so translation cannot inject asEms.
        // The only way asEms lands in `effectiveAsUids` is via pass-through.
        fm: asFrontmatter(asEms, []),
      },
      // TS-floor exo AS provides folder-map overlap so engagement succeeds.
      {
        file: { path: "assetspaces/exo/exo.md", basename: "exo" },
        fm: asFrontmatter(TS_FLOOR_AS_UID_EXO, []),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    // Profile declares the AS UID directly (future-proof shape).
    const switchMgr = makeSwitchMgrStub(new Set([asEms]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    expect(indexer.effective!.has(asEms)).toBe(true);
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
        fm: asFrontmatter(asExo, [ontologyExo], "exo"),
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
    expect(indexer.folderMap!.get(derivedFolder("exo"))).toBe(asExo);
  });

  it("handles single-string containsOntology (not just array form)", async () => {
    // Asserts on a non-TS-floor AS UID so the assertion genuinely exercises
    // the array/string normalisation path (per the revert-fail discipline —
    // a TS-floor AS UID would land via floor injection regardless of whether
    // the string-shape was parsed correctly).
    const ontologyEms = "d9bd496e-86cf-496d-b2da-e5f68cc3e7bc";
    const asEms = "f0f674da-a31b-47e1-b0e8-f984b018bf75";
    const app = makeApp([
      {
        file: { path: "assetspaces/ems/ems.md", basename: "ems" },
        fm: {
          exo__Asset_uid: asEms,
          exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}]]`],
          exo__AssetSpace_source: "https://github.com/kitelev/exoas-ems",
          // String, not array — Obsidian parser may produce either shape.
          exo__AssetSpace_containsOntology: `[[${ontologyEms}]]`,
        },
      },
      // TS-floor exo AS for folder-map overlap (engagement gate).
      {
        file: { path: "assetspaces/exo/exo.md", basename: "exo" },
        fm: asFrontmatter(TS_FLOOR_AS_UID_EXO, []),
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
  });

  it("degrades gracefully when activeProfileUid is empty string (defensive)", async () => {
    // VaultProfileResolver.resolve short-circuits on empty UID → resolveEffectiveSet
    // returns just TS-floor URIs (no profile-derived entries). Translation would
    // pass-through-translate any AS UIDs (URIs don't match folder values), then
    // TS-floor injection adds the floor AS UIDs. Empty-string activeProfileUid
    // (legacy data.json shape) must not throw and must engage iff floor overlaps.
    const ontologyExo = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";
    const app = makeApp([
      {
        file: { path: "assetspaces/exo/exo.md", basename: "exo" },
        fm: asFrontmatter(TS_FLOOR_AS_UID_EXO, [ontologyExo]),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    // Empty set models VaultProfileResolver.resolve("") returning null →
    // FocusProfileSwitchManager.resolveEffectiveSet emits empty + TS-floor URIs.
    const switchMgr = makeSwitchMgrStub(new Set());

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "",
      logger,
    });

    // Engages on TS-floor alone (overlap satisfied by the exo AS file present).
    expect(result.outcome).toBe("engaged");
    expect(indexer.effective!.has(TS_FLOOR_AS_UID_EXO)).toBe(true);
  });

  it("surfaces untranslated UIDs in the engagement info log", async () => {
    // Mix: ontologyEms translates → asEms; unknownOntology fails translation.
    // TS-floor AS files present so engagement succeeds and we land in the
    // info log path that reports the partial breakdown.
    const ontologyEms = "d9bd496e-86cf-496d-b2da-e5f68cc3e7bc";
    const asEms = "f0f674da-a31b-47e1-b0e8-f984b018bf75";
    const unknownOntology = "deadbeef-dead-beef-dead-beefdeadbeef";

    const app = makeApp([
      {
        file: { path: "assetspaces/ems/ems.md", basename: "ems" },
        fm: asFrontmatter(asEms, [ontologyEms]),
      },
      {
        file: { path: "assetspaces/exo/exo.md", basename: "exo" },
        fm: asFrontmatter(TS_FLOOR_AS_UID_EXO, []),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(
      new Set([ontologyEms, unknownOntology]),
    );

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    expect(logger.infos.length).toBeGreaterThan(0);
    expect(logger.infos[0]).toMatch(/wired/);
    expect(logger.infos[0]).toMatch(/declared UIDs failed translation/);
    expect(logger.infos[0]).toContain(unknownOntology);
  });
});

// ─── RFC 01a83de8 v10 T3 — derive-path discovery union ──────────────────────

/**
 * AssetSpace frontmatter that declares a clone URL. `source` populates the new
 * `exo__AssetSpace_source`; `git` populates the legacy `exo__AssetSpace_git`.
 * Pass either or both to exercise the dual-read precedence.
 */
function asFrontmatterWithSource(
  uid: string,
  opts: { source?: string; git?: string; containsOntology?: string[] },
): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    exo__Asset_uid: uid,
    exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
  };
  if (opts.source !== undefined) fm["exo__AssetSpace_source"] = opts.source;
  if (opts.git !== undefined) fm["exo__AssetSpace_git"] = opts.git;
  if (opts.containsOntology !== undefined) {
    fm["exo__AssetSpace_containsOntology"] = opts.containsOntology.map(
      (o) => `[[${o}]]`,
    );
  }
  return fm;
}

describe("applyActiveProfileFilter — derive-path discovery union (RFC v10 T3)", () => {
  // Registry-model descriptor: the descriptor FILE lives in the registry
  // (`assetspaces/kitelev/exoas-kitelev-registry/core/`) but the AssetSpace it
  // describes mounts at `derivePath(_source)` = `assetspaces/kitelev/exoas-testlib`.
  const TESTLIB_AS_UID = "11111111-2222-3333-4444-555555555555";
  const TESTLIB_SOURCE = "https://github.com/kitelev/exoas-testlib";
  const TESTLIB_DERIVED = "assetspaces/kitelev/exoas-testlib";
  const REGISTRY_FOLDER =
    "assetspaces/kitelev/exoas-kitelev-registry/core";

  it("maps the DERIVED mount path (not the descriptor's own folder) to the AS UID", async () => {
    const app = makeApp([
      {
        file: {
          path: `${REGISTRY_FOLDER}/desc.md`,
          basename: "desc",
        },
        fm: asFrontmatterWithSource(TESTLIB_AS_UID, {
          source: TESTLIB_SOURCE,
        }),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    // Profile declares the test AssetSpace UID directly (pass-through). The
    // derived-path mapping is the ONLY thing that puts this UID into folderMap
    // values, so engagement (hasFolderMatch) proves the derive-path branch ran.
    const switchMgr = makeSwitchMgrStub(new Set([TESTLIB_AS_UID]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    // Derived mount path → AS UID (the registry model).
    expect(indexer.folderMap!.get(TESTLIB_DERIVED)).toBe(TESTLIB_AS_UID);
    // RFC 01a83de8 Phase 1b T3 — path-prefix branch REMOVED. The descriptor's
    // own folder (the registry) is NO LONGER mapped: discovery is class-based +
    // derivePath-only. Only the derived mount path is in folderMap.
    expect(indexer.folderMap!.get(REGISTRY_FOLDER)).toBeUndefined();
    expect(indexer.folderMap!.size).toBe(1);
  });

  it("dual-read: `_source` takes precedence over legacy `_git`", async () => {
    const app = makeApp([
      {
        file: { path: `${REGISTRY_FOLDER}/desc.md`, basename: "desc" },
        fm: asFrontmatterWithSource(TESTLIB_AS_UID, {
          source: TESTLIB_SOURCE,
          // A stale legacy value that MUST be ignored when _source is present.
          git: "https://github.com/kitelev/legacy-stale-repo",
        }),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set([TESTLIB_AS_UID]));

    await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    // _source wins → testlib derived path present.
    expect(indexer.folderMap!.get(TESTLIB_DERIVED)).toBe(TESTLIB_AS_UID);
    // _git fallback NOT used → legacy-stale derived path absent.
    expect(
      indexer.folderMap!.get("assetspaces/kitelev/legacy-stale-repo"),
    ).toBeUndefined();
  });

  it("dual-read fallback: legacy `_git`-only descriptor still derives a mapping", async () => {
    const LEGACY_AS_UID = "99999999-8888-7777-6666-555555555555";
    const app = makeApp([
      {
        // Legacy live descriptor: file lives inside the AssetSpace it
        // describes; only `_git` declared (no `_source` yet — pre-1b).
        file: { path: "assetspaces/exo/49fd2e56.md", basename: "exo" },
        fm: asFrontmatterWithSource(LEGACY_AS_UID, {
          git: "https://github.com/kitelev/exocortex-exo-ontology",
        }),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set([LEGACY_AS_UID]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    expect(result.outcome).toBe("engaged");
    // RFC 01a83de8 Phase 1b T3 — path-prefix branch REMOVED. The descriptor's
    // own folder is no longer mapped; discovery resolves the AS folder purely
    // from `derivePath(_source ?? _git)`. Dual-read fallback: a `_git`-only
    // descriptor still derives its mount mapping.
    expect(indexer.folderMap!.get("assetspaces/exo")).toBeUndefined();
    expect(
      indexer.folderMap!.get("assetspaces/kitelev/exocortex-exo-ontology"),
    ).toBe(LEGACY_AS_UID);
  });

  it("no source/git → NO folder mapping (path-prefix branch removed in T3)", async () => {
    // RFC 01a83de8 Phase 1b T3 — discovery is derivePath-only. A descriptor with
    // neither `_source` nor `_git` cannot resolve a mount folder, so it produces
    // NO folderMap entry (previously the path-prefix branch would map its own
    // folder). With zero folder overlap the filter degrades to no-filter rather
    // than self-bricking. `_source` is SHACL-required (T4) so this is defensive.
    const PLAIN_AS_UID = "abcdabcd-1234-5678-9abc-def012345678";
    const app = makeApp([
      {
        file: { path: "assetspaces/ems/plain.md", basename: "plain" },
        fm: asFrontmatterWithSource(PLAIN_AS_UID, {}),
      },
    ]);
    const indexer = makeIndexerStub();
    const logger = makeLogger();
    const switchMgr = makeSwitchMgrStub(new Set([PLAIN_AS_UID]));

    const result = await applyActiveProfileFilter({
      app,
      switchMgr,
      indexer,
      activeProfileUid: "profile-test",
      logger,
    });

    // No derived entry → zero folder overlap → safe-degrade to no-filter.
    expect(result.outcome).toBe("degraded");
    expect(indexer.folderMap).toBeNull();
  });
});

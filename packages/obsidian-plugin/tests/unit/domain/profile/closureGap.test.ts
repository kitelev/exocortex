import {
  assertHardDependenciesSatisfied,
  detectUnmountedClosureMembers,
  formatClosureGapWarning,
  OmittedHardDependencyError,
} from "../../../../src/domain/profile/closureGap";
import {
  DEPENDENCY_KIND_REFERENCE_UID,
  DEPENDENCY_KIND_TBOX_UID,
} from "../../../../src/domain/profile/dependencyKind";
import type { AssetSpaceInfo } from "../../../../src/infrastructure/adapters/AssetSpaceManager";

const HARD = `[[${DEPENDENCY_KIND_TBOX_UID}]]`;
const SOFT = `[[${DEPENDENCY_KIND_REFERENCE_UID}]]`;

/** Minimal AssetSpaceInfo fixture (only the fields the helper reads). */
function info(
  uid: string,
  namespace: string,
  dependsOn?: string[],
  dependsOnKind?: string,
): AssetSpaceInfo {
  return {
    uid,
    git: `https://github.com/kitelev/exoas-${namespace}`,
    namespace,
    folderName: `assetspaces/kitelev/exoas-${namespace}`,
    ...(dependsOn ? { dependsOn } : {}),
    ...(dependsOnKind ? { dependsOnKind } : {}),
  };
}

const PUBLIC = "aaaa1111-0000-0000-0000-000000000001";
const EXOCMD = "bbbb2222-0000-0000-0000-000000000002";
const EXO = "cccc3333-0000-0000-0000-000000000003";
const W3C = "dddd4444-0000-0000-0000-000000000004";

describe("detectUnmountedClosureMembers (#3956)", () => {
  // exoas-public --dependsOn--> {exoas-exocmd, exoas-w3c}; exoas-exocmd --> exoas-exo.
  // req 18ecf16f — the kind now comes from each descriptor, not from a
  // namespace allow-list: exocmd/exo are marked HARD, w3c SOFT.
  const catalogue: AssetSpaceInfo[] = [
    info(PUBLIC, "public", [EXOCMD, W3C], HARD),
    info(EXOCMD, "exocmd", [EXO], HARD),
    info(EXO, "exo", undefined, HARD),
    info(W3C, "w3c", undefined, SOFT),
  ];

  it("reports the unmaterialized closure members of a root (the subset-add gap)", () => {
    // Only exoas-public itself is materialized (subset add).
    const missing = detectUnmountedClosureMembers(
      [PUBLIC],
      catalogue,
      new Set([PUBLIC]),
    );
    const uids = missing.map((m) => m.uid).sort();
    expect(uids).toEqual([EXO, EXOCMD, W3C].sort());
  });

  it("flags the TBox-provider closure members, not the rest (AC3)", () => {
    const missing = detectUnmountedClosureMembers(
      [PUBLIC],
      catalogue,
      new Set([PUBLIC]),
    );
    const byUid = new Map(missing.map((m) => [m.uid, m]));
    expect(byUid.get(EXOCMD)?.providesTBox).toBe(true);
    expect(byUid.get(EXO)?.providesTBox).toBe(true);
    expect(byUid.get(W3C)?.providesTBox).toBe(false);
    // The member label = its namespace (user-legible).
    expect(byUid.get(EXOCMD)?.label).toBe("exocmd");
  });

  it("emits NO gap when the full closure is materialized (no false-positive)", () => {
    const missing = detectUnmountedClosureMembers(
      [PUBLIC],
      catalogue,
      new Set([PUBLIC, EXOCMD, EXO, W3C]),
    );
    expect(missing).toEqual([]);
  });

  it("skips a materialized root but still reports its unmounted deps", () => {
    const missing = detectUnmountedClosureMembers(
      [PUBLIC],
      catalogue,
      new Set([PUBLIC, EXO, W3C]), // only exocmd missing
    );
    expect(missing.map((m) => m.uid)).toEqual([EXOCMD]);
    expect(missing[0].providesTBox).toBe(true);
  });

  it("reports a closure member with no scanned descriptor using its short UID", () => {
    // exoas-public depends on a UID that has no descriptor in the catalogue.
    const orphan = "ffff9999-0000-0000-0000-000000000099";
    const cat = [info(PUBLIC, "public", [orphan], HARD)];
    const missing = detectUnmountedClosureMembers(
      [PUBLIC],
      cat,
      new Set([PUBLIC]),
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].uid).toBe(orphan);
    expect(missing[0].label).toBe(orphan.slice(0, 8)); // no namespace known
    // req 18ecf16f — DELIBERATE change from `false`: an unscannable member can
    // never be materialized, so calling it "harmless content" is the one
    // direction that loses class types silently.
    expect(missing[0].providesTBox).toBe(true);
  });

  it("returns [] when a root has no dependsOn edges (nothing to check)", () => {
    const missing = detectUnmountedClosureMembers(
      [W3C],
      catalogue,
      new Set([W3C]),
    );
    expect(missing).toEqual([]);
  });

  // ---- req 18ecf16f: providesTBox comes from the GRAPH, not from a namespace list ----

  it("marks a NON-floor namespace as a TBox provider when the graph says so @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // Decisive against the removed allow-list: "public" was never in {exo, exocmd},
    // so under the hardcode this could only have been false. Measured on the real
    // registry, exoas-public supplies class definitions to 13478 cross-boundary
    // assets — the allow-list was not merely non-homoiconic, it was wrong.
    const root = "eeee5555-0000-0000-0000-000000000005";
    const cat = [
      info(root, "my", [PUBLIC], HARD),
      info(PUBLIC, "public", undefined, HARD),
    ];
    const missing = detectUnmountedClosureMembers(
      [root],
      cat,
      new Set([root]),
    );
    expect(missing.map((m) => m.uid)).toEqual([PUBLIC]);
    expect(missing[0].providesTBox).toBe(true);
  });

  it("marks a FLOOR namespace as NOT a provider when the graph says so @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // The mirror axis, and the one the hardcode structurally could not express:
    // namespace "exo" was unconditionally true. The graph is now authoritative.
    const root = "eeee5555-0000-0000-0000-000000000005";
    const cat = [
      info(root, "my", [EXO], HARD),
      info(EXO, "exo", undefined, SOFT),
    ];
    const missing = detectUnmountedClosureMembers([root], cat, new Set([root]));
    expect(missing.map((m) => m.uid)).toEqual([EXO]);
    expect(missing[0].providesTBox).toBe(false);
  });

  it("treats a descriptor with NO kind as a provider (safe default) @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    const root = "eeee5555-0000-0000-0000-000000000005";
    const cat = [
      info(root, "my", [W3C], HARD),
      info(W3C, "w3c"), // no dependsOnKind at all
    ];
    const missing = detectUnmountedClosureMembers([root], cat, new Set([root]));
    expect(missing[0].providesTBox).toBe(true);
  });
});

describe("assertHardDependenciesSatisfied (req 18ecf16f)", () => {
  const MY = "eeee5555-0000-0000-0000-000000000005";
  const SHARED_PRIVATE = "aaaa6666-0000-0000-0000-000000000006";

  /** The P5 topology: a leaf that pulls a class provider in transitively. */
  function p5Catalogue(kind?: string): AssetSpaceInfo[] {
    return [
      info(MY, "my", [SHARED_PRIVATE], HARD),
      info(SHARED_PRIVATE, "shared-private", undefined, kind),
    ];
  }

  it("REFUSES when a HARD-edge closure member is omitted from the effective set @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // The exact shape that produced the two sh:class violations in the parent
    // project's P5 spike: the provider is dropped, and today nothing stops it.
    expect(() =>
      assertHardDependenciesSatisfied(
        [MY, SHARED_PRIVATE],
        new Set([MY]),
        p5Catalogue(HARD),
      ),
    ).toThrow(OmittedHardDependencyError);
  });

  it("names the omitted provider and the remedy in the error @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    let caught: unknown;
    try {
      assertHardDependenciesSatisfied(
        [MY, SHARED_PRIVATE],
        new Set([MY]),
        p5Catalogue(HARD),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OmittedHardDependencyError);
    const err = caught as OmittedHardDependencyError;
    expect(err.omitted.map((m) => m.uid)).toEqual([SHARED_PRIVATE]);
    expect(err.message).toContain("shared-private");
    expect(err.message).toContain("exo__DependencyKindReference");
  });

  it("ALLOWS the same omission when the edge is SOFT @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // The whole point of typing: a content-only pack may be left out.
    expect(() =>
      assertHardDependenciesSatisfied(
        [MY, SHARED_PRIVATE],
        new Set([MY]),
        p5Catalogue(SOFT),
      ),
    ).not.toThrow();
  });

  it("REFUSES when the omitted member has NO kind at all (safe default) @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // AC4 — the branch that would otherwise never execute: "kind not set" must
    // read as hard, not as "no kind ⇒ parkable".
    expect(() =>
      assertHardDependenciesSatisfied(
        [MY, SHARED_PRIVATE],
        new Set([MY]),
        p5Catalogue(undefined),
      ),
    ).toThrow(OmittedHardDependencyError);
  });

  it("REFUSES when the omitted member has NO scanned descriptor @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // The silent-drop path: resolveDeclaredAndEffective keeps only closure
    // members that have a descriptor, so this one vanished without a word.
    const orphan = "ffff9999-0000-0000-0000-000000000099";
    expect(() =>
      assertHardDependenciesSatisfied(
        [MY, orphan],
        new Set([MY]),
        [info(MY, "my", [orphan], HARD)],
      ),
    ).toThrow(OmittedHardDependencyError);
  });

  it("does NOT throw when the whole closure is in the effective set @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // No false-positive: the normal apply must stay byte-identical in behaviour.
    expect(() =>
      assertHardDependenciesSatisfied(
        [MY, SHARED_PRIVATE],
        new Set([MY, SHARED_PRIVATE]),
        p5Catalogue(HARD),
      ),
    ).not.toThrow();
  });

  it("does NOT throw on an empty closure @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    expect(() =>
      assertHardDependenciesSatisfied([], new Set(), []),
    ).not.toThrow();
  });
});

describe("formatClosureGapWarning (#3956)", () => {
  it("returns null for an empty gap (no warning)", () => {
    expect(formatClosureGapWarning([], "public")).toBeNull();
  });

  it("names the members + the TBox note + the remedy", () => {
    const w = formatClosureGapWarning(
      [
        { uid: EXOCMD, label: "exocmd", providesTBox: true },
        { uid: W3C, label: "w3c", providesTBox: false },
      ],
      "public",
    );
    expect(w).not.toBeNull();
    expect(w).toContain("public depends on {exocmd, w3c}");
    expect(w).toContain("are not mounted");
    // TBox note names only the TBox providers.
    expect(w).toContain("exocmd provide the class / command TBox");
    expect(w).not.toContain("w3c provide the class");
    // Remedy.
    expect(w).toMatch(/Apply profile.*Add AssetSpace by URL/);
  });

  it("uses the singular form for one member + omits the TBox note when none", () => {
    const w = formatClosureGapWarning(
      [{ uid: W3C, label: "w3c", providesTBox: false }],
      "public",
    );
    expect(w).toContain("{w3c} which is not mounted");
    expect(w).not.toContain("provide the class / command TBox");
    expect(w).toContain("add it via «Add AssetSpace by URL»");
  });
});

import {
  detectUnmountedClosureMembers,
  formatClosureGapWarning,
} from "../../../../src/domain/profile/closureGap";
import type { AssetSpaceInfo } from "../../../../src/infrastructure/adapters/AssetSpaceManager";

/** Minimal AssetSpaceInfo fixture (only the fields the helper reads). */
function info(
  uid: string,
  namespace: string,
  dependsOn?: string[],
): AssetSpaceInfo {
  return {
    uid,
    git: `https://github.com/kitelev/exoas-${namespace}`,
    namespace,
    folderName: `assetspaces/kitelev/exoas-${namespace}`,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

const PUBLIC = "aaaa1111-0000-0000-0000-000000000001";
const EXOCMD = "bbbb2222-0000-0000-0000-000000000002";
const EXO = "cccc3333-0000-0000-0000-000000000003";
const W3C = "dddd4444-0000-0000-0000-000000000004";

describe("detectUnmountedClosureMembers (#3956)", () => {
  // exoas-public --dependsOn--> {exoas-exocmd, exoas-w3c}; exoas-exocmd --> exoas-exo.
  const catalogue: AssetSpaceInfo[] = [
    info(PUBLIC, "public", [EXOCMD, W3C]),
    info(EXOCMD, "exocmd", [EXO]),
    info(EXO, "exo"),
    info(W3C, "w3c"),
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

  it("flags the TBox-provider closure members (exo + exocmd), not the rest (AC3)", () => {
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
    const cat = [info(PUBLIC, "public", [orphan])];
    const missing = detectUnmountedClosureMembers(
      [PUBLIC],
      cat,
      new Set([PUBLIC]),
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].uid).toBe(orphan);
    expect(missing[0].label).toBe(orphan.slice(0, 8)); // no namespace known
    expect(missing[0].providesTBox).toBe(false);
  });

  it("returns [] when a root has no dependsOn edges (nothing to check)", () => {
    const missing = detectUnmountedClosureMembers(
      [W3C],
      catalogue,
      new Set([W3C]),
    );
    expect(missing).toEqual([]);
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

import {
  DEPENDENCY_KIND_REFERENCE_UID,
  DEPENDENCY_KIND_TBOX_UID,
} from "../../../../src/domain/profile/dependencyKind";
import {
  assessUnmountRisk,
  countIncomingLinks,
  findDependentMountedAssetSpaces,
  formatUnmountRiskWarning,
  type ResolvedLinks,
} from "../../../../src/domain/profile/unmountSafety";
import type { AssetSpaceInfo } from "../../../../src/infrastructure/adapters/AssetSpaceManager";

/**
 * req d5bc68f6 — the pure blast-radius assessment behind the «Remove knowledge
 * pack» confirmation.
 *
 * The catalogue below mirrors the REAL vault-my `dependsOn` graph measured by
 * the project's falsification gate (task 8b8466bb, 2026-08-02):
 *
 *   my → shared-private, shared-identities, shared-kalashnikova
 *   shared-private → public
 *   shared-identities → public
 *   public → exo, exocmd
 *   exocmd → exo
 *
 * That shape is what makes the check non-trivial: `public` is reachable from
 * `my` only TRANSITIVELY, and `exo`/`exocmd` only at depth 3-4 — a direct-edge
 * check would miss every one of them.
 */
const UID = {
  my: "10000000-0000-0000-0000-000000000001",
  sharedPrivate: "10000000-0000-0000-0000-000000000002",
  sharedIdentities: "10000000-0000-0000-0000-000000000003",
  public: "10000000-0000-0000-0000-000000000004",
  exocmd: "10000000-0000-0000-0000-000000000005",
  exo: "10000000-0000-0000-0000-000000000006",
  detached: "10000000-0000-0000-0000-000000000007",
  collab: "10000000-0000-0000-0000-000000000008",
} as const;

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
    ...(dependsOn === undefined ? {} : { dependsOn }),
    ...(dependsOnKind === undefined ? {} : { dependsOnKind }),
  };
}

/**
 * req 18ecf16f — the kinds below are the ones actually marked on the live
 * registry 2026-08-06, by measured cross-boundary class-definition supply:
 * public/exo/exocmd/shared-private/shared-identities are HARD (13478 / 3625 /
 * 268 / 954 / 652 cross-boundary references respectively); a seed-empty
 * collaborator space supplies none and is SOFT. `my` is nobody's dependency, so
 * it carries no kind — and therefore defaults to HARD.
 */
const HARD = `[[${DEPENDENCY_KIND_TBOX_UID}]]`;
const SOFT = `[[${DEPENDENCY_KIND_REFERENCE_UID}]]`;

const CATALOGUE: AssetSpaceInfo[] = [
  info(UID.my, "my", [UID.sharedPrivate, UID.sharedIdentities, UID.collab]),
  info(UID.sharedPrivate, "shared-private", [UID.public], HARD),
  info(UID.sharedIdentities, "shared-identities", [UID.public], HARD),
  info(UID.public, "public", [UID.exo, UID.exocmd], HARD),
  info(UID.exocmd, "exocmd", [UID.exo], HARD),
  info(UID.exo, "exo", undefined, HARD),
  info(UID.collab, "shared-kalashnikova", undefined, SOFT),
  info(UID.detached, "detached", undefined, SOFT),
];

const ALL_MOUNTED = Object.values(UID);

describe("findDependentMountedAssetSpaces", () => {
  it("reports every mounted pack that reaches the target TRANSITIVELY", () => {
    // `public` is a direct dependency of neither `my` nor the shared packs'
    // callers — it is reached at depth 2 from `my`.
    expect(
      findDependentMountedAssetSpaces(UID.public, ALL_MOUNTED, CATALOGUE),
    ).toEqual(["my", "shared-identities", "shared-private"]);
  });

  it("reaches the deepest member (exo, depth 3-4 from my)", () => {
    expect(
      findDependentMountedAssetSpaces(UID.exo, ALL_MOUNTED, CATALOGUE),
    ).toEqual([
      "exocmd",
      "my",
      "public",
      "shared-identities",
      "shared-private",
    ]);
  });

  it("a leaf nothing depends on has no dependents", () => {
    expect(
      findDependentMountedAssetSpaces(UID.my, ALL_MOUNTED, CATALOGUE),
    ).toEqual([]);
  });

  it("an UNMOUNTED dependent is not reported (it cannot break)", () => {
    // Only `detached` is mounted; it declares nothing.
    expect(
      findDependentMountedAssetSpaces(UID.public, [UID.detached], CATALOGUE),
    ).toEqual([]);
  });

  it("never reports the target as its own dependent", () => {
    expect(
      findDependentMountedAssetSpaces(UID.exocmd, ALL_MOUNTED, CATALOGUE),
    ).not.toContain("exocmd");
  });

  it("a dependent with no scanned descriptor falls back to its short UID", () => {
    const orphanUid = "99999999-aaaa-bbbb-cccc-dddddddddddd";
    const catalogue = [
      ...CATALOGUE,
      { ...info(orphanUid, "", [UID.exo]), namespace: "" },
    ];
    expect(
      findDependentMountedAssetSpaces(UID.exo, [orphanUid], catalogue),
    ).toEqual(["99999999"]);
  });

  it("an empty target uid yields nothing (degenerate input, never a false alarm)", () => {
    expect(findDependentMountedAssetSpaces("", ALL_MOUNTED, CATALOGUE)).toEqual(
      [],
    );
  });
});

describe("countIncomingLinks", () => {
  const PACK = "assetspaces/kitelev/exoas-shared-private";
  const LINKS: ResolvedLinks = {
    // Two notes that STAY BEHIND, linking into the pack.
    "assetspaces/kitelev/exoas-my/notes/a.md": {
      [`${PACK}/concepts/x.md`]: 3,
      [`${PACK}/concepts/y.md`]: 1,
      "assetspaces/kitelev/exoas-my/notes/b.md": 5, // unrelated target
    },
    "assetspaces/kitelev/exoas-my/notes/b.md": {
      [`${PACK}/concepts/x.md`]: 2,
    },
    // A note INSIDE the pack — it is removed together with its target.
    [`${PACK}/concepts/y.md`]: {
      [`${PACK}/concepts/x.md`]: 9,
    },
    // A note that stays behind but links nowhere near the pack.
    "assetspaces/kitelev/exoas-my/notes/c.md": {
      "assetspaces/kitelev/exoas-my/notes/a.md": 1,
    },
  };

  it("counts links from OUTSIDE into the pack, and the distinct files holding them", () => {
    expect(countIncomingLinks(PACK, LINKS)).toEqual({ links: 6, files: 2 });
  });

  it("ignores links whose SOURCE is inside the pack (both ends leave together)", () => {
    const onlyInternal: ResolvedLinks = {
      [`${PACK}/concepts/y.md`]: { [`${PACK}/concepts/x.md`]: 9 },
    };
    expect(countIncomingLinks(PACK, onlyInternal)).toEqual({
      links: 0,
      files: 0,
    });
  });

  it("does not match a sibling folder sharing the pack's prefix", () => {
    // `exoas-shared-private-concepts` must NOT be treated as inside
    // `exoas-shared-private` — the trailing separator is what prevents it.
    const sibling: ResolvedLinks = {
      "assetspaces/kitelev/exoas-my/n.md": {
        "assetspaces/kitelev/exoas-shared-private-concepts/z.md": 4,
      },
    };
    expect(countIncomingLinks(PACK, sibling)).toEqual({ links: 0, files: 0 });
  });

  it("tolerates a trailing slash on the mount path", () => {
    expect(countIncomingLinks(`${PACK}/`, LINKS)).toEqual({
      links: 6,
      files: 2,
    });
  });

  it("an empty mount path counts nothing (never a vault-wide false alarm)", () => {
    expect(countIncomingLinks("", LINKS)).toEqual({ links: 0, files: 0 });
  });
});

describe("assessUnmountRisk + formatUnmountRiskWarning", () => {
  const target = (uid: string, namespace: string) => ({
    uid,
    submodulePath: `assetspaces/kitelev/exoas-${namespace}`,
    namespace,
  });

  it("both axes at risk → one line naming the dependents and the dangling links", () => {
    const links: ResolvedLinks = {
      "assetspaces/kitelev/exoas-my/a.md": {
        "assetspaces/kitelev/exoas-public/c.md": 2,
      },
    };
    const risk = assessUnmountRisk(
      target(UID.public, "public"),
      ALL_MOUNTED,
      CATALOGUE,
      links,
    );

    expect(risk.dependents).toEqual([
      "my",
      "shared-identities",
      "shared-private",
    ]);
    expect(risk.incomingLinks).toBe(2);
    expect(risk.linkingFiles).toBe(1);
    // req 18ecf16f — DELIBERATE flip from `false`. Under the removed namespace
    // allow-list `{exo, exocmd}` this could only ever be false; the graph says
    // `public` IS a provider (13478 cross-boundary class references, the largest
    // supplier in the registry), and the graph is now authoritative.
    expect(risk.providesTBox).toBe(true);

    const warning = formatUnmountRiskWarning(risk, "public");
    expect(warning).toContain("my, shared-identities, shared-private");
    expect(warning).toContain("are still mounted and declare a dependency");
    expect(warning).toContain("2 links from 1 file outside it");
    expect(warning).toContain("class / command TBox");
  });

  it("omits the TBox note for a SOFT pack that is still at risk @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // The coverage the flip above moved off `public`: risk WITHOUT the TBox note.
    // A seed-empty collaborator pack supplies no class definitions, so removing
    // it costs reachability (dependents + dangling links) but never types — and
    // the warning must not claim otherwise.
    const links: ResolvedLinks = {
      "assetspaces/kitelev/exoas-my/a.md": {
        "assetspaces/kitelev/exoas-shared-kalashnikova/c.md": 2,
      },
    };
    const risk = assessUnmountRisk(
      target(UID.collab, "shared-kalashnikova"),
      ALL_MOUNTED,
      CATALOGUE,
      links,
    );

    expect(risk.dependents).toEqual(["my"]);
    expect(risk.incomingLinks).toBe(2);
    expect(risk.providesTBox).toBe(false);

    const warning = formatUnmountRiskWarning(risk, "shared-kalashnikova");
    expect(warning).toContain("my is still mounted and declares a dependency");
    expect(warning).not.toContain("class / command TBox");
  });

  it("removing a TBox provider says so explicitly (exocmd is NOT floor-protected)", () => {
    const risk = assessUnmountRisk(
      target(UID.exocmd, "exocmd"),
      ALL_MOUNTED,
      CATALOGUE,
      {},
    );

    expect(risk.providesTBox).toBe(true);
    const warning = formatUnmountRiskWarning(risk, "exocmd");
    expect(warning).toContain("class / command TBox");
    expect(warning).toContain("break silently");
  });

  it("nothing at risk → null (the caller then leaves the wording untouched)", () => {
    const risk = assessUnmountRisk(
      target(UID.my, "my"),
      ALL_MOUNTED,
      CATALOGUE,
      {},
    );

    expect(risk.dependents).toEqual([]);
    expect(risk.incomingLinks).toBe(0);
    expect(formatUnmountRiskWarning(risk, "my")).toBeNull();
  });

  it("a TBox provider nothing depends on still yields null — the note is not a reason on its own", () => {
    const risk = assessUnmountRisk(
      target(UID.exo, "exo"),
      [UID.exo], // nothing else mounted
      CATALOGUE,
      {},
    );

    expect(risk.providesTBox).toBe(true);
    expect(formatUnmountRiskWarning(risk, "exo")).toBeNull();
  });

  it("singular wording for exactly one dependent and one link", () => {
    const links: ResolvedLinks = {
      "assetspaces/kitelev/exoas-my/a.md": {
        "assetspaces/kitelev/exoas-exo/c.md": 1,
      },
    };
    const risk = assessUnmountRisk(
      target(UID.exo, "exo"),
      [UID.exocmd],
      CATALOGUE,
      links,
    );

    const warning = formatUnmountRiskWarning(risk, "exo");
    expect(warning).toContain(
      "exocmd is still mounted and declares a dependency",
    );
    expect(warning).toContain("1 link from 1 file outside it");
  });
});

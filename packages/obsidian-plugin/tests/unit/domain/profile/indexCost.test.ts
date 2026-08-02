import {
  computeClosureIndexCost,
  formatAssetSpaceIndexCost,
  formatIndexCost,
} from "../../../../src/domain/profile/indexCost";
import { ProfileFuzzyModal } from "../../../../src/infrastructure/adapters/ProfileFuzzyModal";
import type { ProfileChoice } from "../../../../src/infrastructure/adapters/ProfileCommands";
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

const MY = "aaaa1111-0000-0000-0000-000000000001";
const SHARED_PRIVATE = "bbbb2222-0000-0000-0000-000000000002";
const PUBLIC = "cccc3333-0000-0000-0000-000000000003";
const EXO = "dddd4444-0000-0000-0000-000000000004";

// The real vault-my shape the P0 measurement found (task 8b8466bb):
//   my -> shared-private -> public -> exo
// i.e. mounting the personal leaf force-mounts everything beneath it.
const CATALOGUE: AssetSpaceInfo[] = [
  info(MY, "my", [SHARED_PRIVATE]),
  info(SHARED_PRIVATE, "shared-private", [PUBLIC]),
  info(PUBLIC, "public", [EXO]),
  info(EXO, "exo"),
];

const ALL_COUNTED = new Map<string, number>([
  [MY, 3],
  [SHARED_PRIVATE, 5],
  [PUBLIC, 2],
  [EXO, 1],
]);

describe("computeClosureIndexCost (req 6171f443)", () => {
  it("@req:6171f443-a57f-4d3a-bad6-8d964decb308 prices a profile over its whole dependsOn CLOSURE, not the declared leaf alone", () => {
    // AC1 — the picker must show what a profile actually costs to mount.
    const cost = computeClosureIndexCost([MY], CATALOGUE, ALL_COUNTED);

    expect(cost.files).toBe(11); // 3 + 5 + 2 + 1 — NOT the 3 files of `my`
    expect(cost.closureSize).toBe(4);
    expect(cost.countedAssetSpaces).toBe(4);
    expect(cost.uncountedAssetSpaces).toBe(0);
    expect(formatIndexCost(cost)).toBe("11 files · 4 assetspaces");
  });

  it("@req:6171f443-a57f-4d3a-bad6-8d964decb308 marks the total a LOWER BOUND when a closure member is not mounted (uncountable)", () => {
    // `exo` is not materialized ⇒ its files cannot be walked ⇒ unknown, not zero.
    const partial = new Map<string, number>([
      [MY, 3],
      [SHARED_PRIVATE, 5],
      [PUBLIC, 2],
    ]);
    const cost = computeClosureIndexCost([MY], CATALOGUE, partial);

    expect(cost.files).toBe(10);
    expect(cost.uncountedAssetSpaces).toBe(1);
    expect(formatIndexCost(cost)).toBe(
      "≥ 10 files · 4 assetspaces (1 not mounted, uncounted)",
    );
  });

  it("@req:6171f443-a57f-4d3a-bad6-8d964decb308 renders NOTHING when no closure member is countable (zero-regression path)", () => {
    const cost = computeClosureIndexCost([MY], CATALOGUE, new Map());

    expect(cost.countedAssetSpaces).toBe(0);
    expect(formatIndexCost(cost)).toBeNull();
  });

  it("is cycle-safe and idempotent on a malformed dependsOn DAG", () => {
    const cyclic: AssetSpaceInfo[] = [
      info(MY, "my", [SHARED_PRIVATE]),
      info(SHARED_PRIVATE, "shared-private", [MY]),
    ];
    const cost = computeClosureIndexCost(
      [MY],
      cyclic,
      new Map([
        [MY, 3],
        [SHARED_PRIVATE, 5],
      ]),
    );

    expect(cost.closureSize).toBe(2);
    expect(cost.files).toBe(8);
  });

  it("prices a dependency-free AssetSpace as itself only", () => {
    const cost = computeClosureIndexCost([EXO], CATALOGUE, ALL_COUNTED);

    expect(cost.closureSize).toBe(1);
    // Both units are pluralised — a lone AssetSpace reads `1 file · 1 assetspace`.
    expect(formatIndexCost(cost)).toBe("1 file · 1 assetspace");
  });
});

describe("formatAssetSpaceIndexCost (req 6171f443)", () => {
  it("@req:6171f443-a57f-4d3a-bad6-8d964decb308 shows a pack's OWN size AND what its closure costs", () => {
    // AC2 — own size alone is the misleading number; the closure is the honest one.
    const line = formatAssetSpaceIndexCost(
      ALL_COUNTED.get(PUBLIC),
      computeClosureIndexCost([PUBLIC], CATALOGUE, ALL_COUNTED),
    );

    expect(line).toBe("2 files · with dependencies: 3 files · 2 assetspaces");
  });

  it("omits the dependency suffix for a pack that depends on nothing", () => {
    const line = formatAssetSpaceIndexCost(
      ALL_COUNTED.get(EXO),
      computeClosureIndexCost([EXO], CATALOGUE, ALL_COUNTED),
    );

    expect(line).toBe("1 file");
  });

  it("renders nothing when the pack is uncountable and so is its closure", () => {
    const line = formatAssetSpaceIndexCost(
      undefined,
      computeClosureIndexCost([PUBLIC], CATALOGUE, new Map()),
    );

    expect(line).toBeNull();
  });
});

describe("ProfileFuzzyModal renders the index cost (req 6171f443)", () => {
  function renderRow(choice: ProfileChoice): HTMLElement {
    const modal = new ProfileFuzzyModal(
      {} as never,
      [choice],
      "Apply profile",
      () => undefined,
    );
    const el = document.createElement("div");
    modal.renderSuggestion(
      { item: choice, match: { score: 0, matches: [] } },
      el,
    );
    return el;
  }

  it("@req:6171f443-a57f-4d3a-bad6-8d964decb308 surfaces the cost line in the picker row, before anything is applied", () => {
    const el = renderRow({
      uid: "profile-uid",
      label: "$$kitelev-my",
      indexCost: "11 files · 4 assetspaces",
    });

    expect(
      el.querySelector(".exocortex-profile-suggestion__cost"),
    ).not.toBeNull();
    expect(el.textContent).toContain("11 files · 4 assetspaces");
    // The human label is still the primary line (never replaced by the cost).
    expect(el.textContent).toContain("$$kitelev-my");
  });

  it("@req:6171f443-a57f-4d3a-bad6-8d964decb308 renders no cost node at all when the cost is unknown (zero-regression)", () => {
    const el = renderRow({ uid: "profile-uid", label: "$$kitelev-my" });

    expect(el.querySelector(".exocortex-profile-suggestion__cost")).toBeNull();
    expect(el.textContent).toBe("$$kitelev-my");
  });
});

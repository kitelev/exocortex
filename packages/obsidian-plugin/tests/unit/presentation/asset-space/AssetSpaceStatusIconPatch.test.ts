import { AssetSpaceStatusIconPatch } from "../../../../src/presentation/asset-space/AssetSpaceStatusIconPatch";
import { ASSET_SPACE_CLASS_UID } from "../../../../src/infrastructure/adapters/AssetSpaceManager";
import type { AssetSpaceMaterializationTracker } from "../../../../src/infrastructure/adapters/AssetSpaceMaterializationTracker";
import { MarkdownView, WorkspaceLeaf } from "obsidian";

describe("AssetSpaceStatusIconPatch (RFC 22b50a17 Phase 4)", () => {
  let patch: AssetSpaceStatusIconPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockLeaf: any;
  let mockView: any;
  let mockTracker: jest.Mocked<AssetSpaceMaterializationTracker>;
  let containerEl: HTMLElement;
  let titleEl: HTMLElement;
  let frontmatter: Record<string, unknown> | null = null;

  beforeEach(() => {
    containerEl = document.createElement("div");
    titleEl = document.createElement("div");
    titleEl.className = "inline-title";
    titleEl.textContent = "kitelev/exoas-ems";
    containerEl.appendChild(titleEl);

    mockView = {
      file: { path: "assetspaces/shared-identities/uid-ems.md" },
      containerEl,
    };
    Object.setPrototypeOf(mockView, MarkdownView.prototype);

    mockLeaf = { view: mockView };

    mockApp = {
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([mockLeaf]),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
      metadataCache: {
        getFileCache: jest.fn(() =>
          frontmatter === null ? null : { frontmatter },
        ),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
    };

    mockPlugin = {
      app: mockApp,
      registerEvent: jest.fn(),
    };

    mockTracker = {
      isMaterialized: jest.fn(),
      getMaterializedSet: jest.fn(),
      getStatuses: jest.fn(),
      refresh: jest.fn(),
    } as unknown as jest.Mocked<AssetSpaceMaterializationTracker>;

    patch = new AssetSpaceStatusIconPatch(mockPlugin, mockTracker);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
  });

  it("registers workspace + metadataCache events on enable", () => {
    patch.enable();
    expect(mockApp.workspace.on).toHaveBeenCalledWith(
      "active-leaf-change",
      expect.any(Function),
    );
    expect(mockApp.workspace.on).toHaveBeenCalledWith(
      "layout-change",
      expect.any(Function),
    );
    expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
      "changed",
      expect.any(Function),
    );
  });

  it("renders ✅ materialized badge when tracker reports materialized", () => {
    frontmatter = {
      "exo__Asset_uid": "uid-ems",
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    };
    mockTracker.isMaterialized.mockReturnValue(true);

    patch.enable();

    const badge = containerEl.querySelector(".exo-assetspace-status-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("✅");
    expect(
      badge!.classList.contains("exo-assetspace-status-materialized"),
    ).toBe(true);
    expect(badge!.classList.contains("exo-assetspace-status-available")).toBe(
      false,
    );
    expect(mockTracker.isMaterialized).toHaveBeenCalledWith("uid-ems");
  });

  it("renders ⏸ available badge when tracker reports not-materialized", () => {
    frontmatter = {
      "exo__Asset_uid": "uid-kpc",
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    };
    mockTracker.isMaterialized.mockReturnValue(false);

    patch.enable();

    const badge = containerEl.querySelector(".exo-assetspace-status-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("⏸");
    expect(badge!.classList.contains("exo-assetspace-status-available")).toBe(
      true,
    );
    expect(
      badge!.classList.contains("exo-assetspace-status-materialized"),
    ).toBe(false);
  });

  it("does NOT render badge for non-AssetSpace assets", () => {
    frontmatter = {
      "exo__Asset_uid": "uid-task",
      // Different class — NOT AssetSpace
      "exo__Instance_class": ["[[deadbeef-dead-beef-dead-beefdeadbeef]]"],
    };

    patch.enable();

    const badge = containerEl.querySelector(".exo-assetspace-status-badge");
    expect(badge).toBeNull();
  });

  it("removes badge when frontmatter loses AssetSpace class membership", () => {
    frontmatter = {
      "exo__Asset_uid": "uid-ems",
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    };
    mockTracker.isMaterialized.mockReturnValue(true);
    patch.enable();
    expect(containerEl.querySelector(".exo-assetspace-status-badge")).not.toBeNull();

    // Simulate class change away from AssetSpace.
    frontmatter = {
      "exo__Asset_uid": "uid-ems",
      "exo__Instance_class": ["[[some-other-class]]"],
    };
    patch.onTrackerRefreshed();
    expect(containerEl.querySelector(".exo-assetspace-status-badge")).toBeNull();
  });

  it("is idempotent — repeated refresh adds at most one badge per title", () => {
    frontmatter = {
      "exo__Asset_uid": "uid-ems",
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    };
    mockTracker.isMaterialized.mockReturnValue(true);

    patch.enable();
    patch.onTrackerRefreshed();
    patch.onTrackerRefreshed();
    patch.onTrackerRefreshed();

    const badges = containerEl.querySelectorAll(".exo-assetspace-status-badge");
    expect(badges.length).toBe(1);
  });

  it("updates badge class when status flips from materialized → available", () => {
    frontmatter = {
      "exo__Asset_uid": "uid-ems",
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    };
    mockTracker.isMaterialized.mockReturnValue(true);
    patch.enable();

    let badge = containerEl.querySelector(".exo-assetspace-status-badge")!;
    expect(badge.classList.contains("exo-assetspace-status-materialized")).toBe(
      true,
    );

    // Apply destroys this AS — flip flag.
    mockTracker.isMaterialized.mockReturnValue(false);
    patch.onTrackerRefreshed();

    badge = containerEl.querySelector(".exo-assetspace-status-badge")!;
    expect(badge.classList.contains("exo-assetspace-status-available")).toBe(true);
    expect(badge.textContent).toBe("⏸");
  });

  it("cleanup() removes all rendered badges", () => {
    frontmatter = {
      "exo__Asset_uid": "uid-ems",
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    };
    mockTracker.isMaterialized.mockReturnValue(true);
    patch.enable();
    expect(containerEl.querySelector(".exo-assetspace-status-badge")).not.toBeNull();

    patch.cleanup();
    expect(containerEl.querySelector(".exo-assetspace-status-badge")).toBeNull();
  });
});

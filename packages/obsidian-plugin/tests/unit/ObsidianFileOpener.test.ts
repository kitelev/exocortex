import { ObsidianFileOpener } from "../../src/infrastructure/services/ObsidianFileOpener";
import { TFile } from "obsidian";

describe("ObsidianFileOpener — RFC ce27e55d openInSameTab plumbing", () => {
  let mockApp: any;
  let mockLeaf: any;
  let mockTFile: TFile;
  let getLeafCalls: Array<false | "tab" | "split" | "window" | undefined>;

  beforeEach(() => {
    mockTFile = new TFile("01 Inbox/instance-uuid.md");

    mockLeaf = {
      openFile: jest.fn().mockResolvedValue(undefined),
    };

    // Track-by-call: per `test-fixture-realism.md`, the fake MUST distinguish
    // sameTab=true vs absent by recording the actual argument used.
    getLeafCalls = [];

    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn().mockReturnValue(mockTFile),
      },
      workspace: {
        getLeaf: jest.fn((arg?: false | "tab" | "split" | "window") => {
          getLeafCalls.push(arg);
          return mockLeaf;
        }),
        setActiveLeaf: jest.fn(),
        openLinkText: jest.fn().mockResolvedValue(undefined),
      },
    };
  });

  it("default (no opts) uses getLeaf(\"tab\") — new tab", async () => {
    const opener = new ObsidianFileOpener(mockApp);

    await opener.open("01 Inbox/instance-uuid.md");

    expect(getLeafCalls).toEqual(["tab"]);
    expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
    expect(mockApp.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, {
      focus: true,
    });
  });

  it("opts.sameTab=false uses getLeaf(\"tab\") — explicit default", async () => {
    const opener = new ObsidianFileOpener(mockApp);

    await opener.open("01 Inbox/instance-uuid.md", { sameTab: false });

    expect(getLeafCalls).toEqual(["tab"]);
  });

  it("opts.sameTab=true uses getLeaf(false) — current active leaf", async () => {
    const opener = new ObsidianFileOpener(mockApp);

    await opener.open("01 Inbox/instance-uuid.md", { sameTab: true });

    // Obsidian getLeaf(false) requests the CURRENT active leaf.
    expect(getLeafCalls).toEqual([false]);
    expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
    expect(mockApp.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, {
      focus: true,
    });
  });

  it("opts.sameTab=undefined uses getLeaf(\"tab\") — same as no opts", async () => {
    const opener = new ObsidianFileOpener(mockApp);

    await opener.open("01 Inbox/instance-uuid.md", { sameTab: undefined });

    expect(getLeafCalls).toEqual(["tab"]);
  });

  it("returns early on empty path without calling getLeaf", async () => {
    const opener = new ObsidianFileOpener(mockApp);

    await opener.open("");

    expect(getLeafCalls).toEqual([]);
    expect(mockApp.vault.getAbstractFileByPath).not.toHaveBeenCalled();
  });

  it("falls back to openLinkText when TFile lookup misses (vault cache lag)", async () => {
    mockApp.vault.getAbstractFileByPath = jest.fn().mockReturnValue(null);
    const opener = new ObsidianFileOpener(mockApp);

    await opener.open("unresolved.md", { sameTab: true });

    expect(getLeafCalls).toEqual([]);
    expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
      "unresolved.md",
      "",
    );
  });
});

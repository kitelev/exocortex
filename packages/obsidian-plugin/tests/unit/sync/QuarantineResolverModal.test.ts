import { App } from "obsidian";
import type {
  ConflictDetail,
  ResolvableConflict,
  ResolveChoice,
} from "@kitelev/exocortex-core";
import { QuarantineResolverModal } from "../../../src/infrastructure/adapters/QuarantineResolverModal";
import type { ResolverModalContext } from "../../../src/infrastructure/adapters/QuarantineResolverCommands";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makeConflict(p: Partial<ResolvableConflict> = {}): ResolvableConflict {
  return {
    repoKey: "repo",
    path: "note.md",
    uid: "uid-1",
    hasLocal: true,
    hasRemote: true,
    ...p,
  };
}

interface Harness {
  modal: QuarantineResolverModal;
  ctx: ResolverModalContext;
  resolveOne: jest.Mock;
  loadConflict: jest.Mock;
  onClose: jest.Mock;
  notify: jest.Mock;
  body: HTMLElement;
}

function buildHarness(
  detail: ConflictDetail,
  conflicts: ResolvableConflict[] = [makeConflict()],
): Harness {
  const resolveOne = jest.fn().mockResolvedValue({
    repoKey: detail.repoKey,
    path: detail.path,
    resolvedTo: "local",
  });
  const loadConflict = jest.fn().mockResolvedValue(detail);
  const onClose = jest.fn();
  const notify = jest.fn();
  const ctx: ResolverModalContext = {
    resolver: {} as never,
    specByRepoKey: new Map(),
    conflicts,
    loadConflict,
    resolveOne,
    notify,
    onClose,
  };
  const modal = new QuarantineResolverModal(new App(), ctx);
  return {
    modal,
    ctx,
    resolveOne,
    loadConflict,
    onClose,
    notify,
    body: modal.contentEl,
  };
}

/** Open the modal and drill into the first conflict's detail view. */
async function openDetail(h: Harness): Promise<void> {
  h.modal.onOpen();
  const row = h.body.querySelector<HTMLButtonElement>(".exosync-resolver-row");
  expect(row).not.toBeNull();
  row!.click();
  await flush();
}

describe("QuarantineResolverModal — 3-pane detail view", () => {
  const conflictDetail: ConflictDetail = {
    repoKey: "repo",
    path: "note.md",
    uid: "uid-1",
    hasLocal: true,
    hasRemote: true,
    base: "x",
    local: "L",
    remote: "R",
  };

  it("renders three panes (Local | Merge | Remote) in a grid", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    expect(h.body.querySelector(".exosync-resolver-3pane")).not.toBeNull();
    const panes = h.body.querySelectorAll(".exosync-resolver-pane");
    expect(panes).toHaveLength(3);
    expect(
      h.body.querySelector(".exosync-resolver-pane--local"),
    ).not.toBeNull();
    expect(
      h.body.querySelector(".exosync-resolver-pane--merge"),
    ).not.toBeNull();
    expect(
      h.body.querySelector(".exosync-resolver-pane--remote"),
    ).not.toBeNull();
  });

  it("colours diverging lines as conflict on both side panes", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    const local = h.body.querySelector(".exosync-resolver-pane--local")!;
    const remote = h.body.querySelector(".exosync-resolver-pane--remote")!;
    expect(
      local.querySelector(".exosync-diff-conflict")?.textContent,
    ).toContain("L");
    expect(
      remote.querySelector(".exosync-diff-conflict")?.textContent,
    ).toContain("R");
  });

  it("seeds the centre merge textarea with the auto-merge (conflict → local)", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    const area = h.body.querySelector<HTMLTextAreaElement>(
      ".exosync-resolver-merge-area",
    );
    expect(area).not.toBeNull();
    expect(area!.value).toBe("L");
  });

  it("per-hunk 'use remote' rebuilds the merge text from the remote side", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    const remotePane = h.body.querySelector(".exosync-resolver-pane--remote")!;
    const useRemote = remotePane.querySelector<HTMLButtonElement>(
      ".exosync-resolver-hunk-btn",
    );
    expect(useRemote?.textContent).toContain("use remote");
    useRemote!.click();

    const area = h.body.querySelector<HTMLTextAreaElement>(
      ".exosync-resolver-merge-area",
    )!;
    expect(area.value).toBe("R");
  });

  it("Keep local resolves with {take:'local'}", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    const btn = [...h.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Keep local",
    )!;
    btn.click();
    await flush();
    expect(h.resolveOne).toHaveBeenCalledWith(
      expect.objectContaining({ path: "note.md" }),
      { take: "local" } as ResolveChoice,
    );
  });

  it("Keep remote resolves with {take:'remote'}", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    const btn = [...h.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Keep remote",
    )!;
    btn.click();
    await flush();
    expect(h.resolveOne).toHaveBeenCalledWith(
      expect.objectContaining({ path: "note.md" }),
      { take: "remote" } as ResolveChoice,
    );
  });

  it("Resolve with merge sends the current textarea content", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    // Flip the hunk to remote first, then resolve-with-merge.
    h.body
      .querySelector<HTMLButtonElement>(
        ".exosync-resolver-pane--remote .exosync-resolver-hunk-btn",
      )!
      .click();

    const btn = [...h.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Resolve with merge",
    )!;
    btn.click();
    await flush();
    expect(h.resolveOne).toHaveBeenCalledWith(
      expect.objectContaining({ path: "note.md" }),
      { take: "merged", content: "R" } as ResolveChoice,
    );
  });

  it("shows a navigation bar with the conflict-hunk counter", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    const nav = h.body.querySelector(".exosync-resolver-navbar");
    expect(nav).not.toBeNull();
    expect(
      h.body.querySelector(".exosync-resolver-nav-count")?.textContent,
    ).toContain("1 conflict hunk");
    const navBtns = nav!.querySelectorAll<HTMLButtonElement>(
      ".exosync-resolver-nav-btn",
    );
    expect(navBtns).toHaveLength(2);
    // Prev/Next are enabled when there is at least one conflict.
    expect(navBtns[0].hasAttribute("disabled")).toBe(false);
  });

  it("a non-conflicting addition shows a green line and disables nav", async () => {
    const detail: ConflictDetail = {
      repoKey: "repo",
      path: "note.md",
      uid: "uid-1",
      hasLocal: true,
      hasRemote: true,
      base: "a",
      local: "a\nb",
      remote: "a",
    };
    const h = buildHarness(detail);
    await openDetail(h);

    const local = h.body.querySelector(".exosync-resolver-pane--local")!;
    expect(local.querySelector(".exosync-diff-added")?.textContent).toContain(
      "b",
    );
    expect(
      h.body.querySelector(".exosync-resolver-nav-count")?.textContent,
    ).toContain("0 conflict hunks");
    const prev = h.body.querySelector<HTMLButtonElement>(
      ".exosync-resolver-nav-btn",
    );
    expect(prev!.hasAttribute("disabled")).toBe(true);
  });

  it("preserves a11y: panes are groups, buttons are labelled, diff meaning is not colour-only", async () => {
    const h = buildHarness(conflictDetail);
    await openDetail(h);

    for (const pane of h.body.querySelectorAll(".exosync-resolver-pane")) {
      expect(pane.getAttribute("role")).toBe("group");
      expect(pane.getAttribute("aria-label")).toBeTruthy();
    }
    for (const btn of h.body.querySelectorAll<HTMLButtonElement>("button")) {
      expect(btn.getAttribute("aria-label")).toBeTruthy();
    }
    // Screen-reader text conveys "conflict" without relying on colour.
    const srText = [...h.body.querySelectorAll(".exosync-visually-hidden")].map(
      (n) => n.textContent,
    );
    expect(srText.join(" ")).toContain("conflict");
  });

  it("a load failure surfaces an error and a back button (no crash)", async () => {
    const h = buildHarness(conflictDetail);
    h.loadConflict.mockRejectedValueOnce(new Error("offline"));
    await openDetail(h);

    expect(
      h.body.querySelector(".exosync-resolver-error")?.textContent,
    ).toContain("offline");
    expect(h.body.querySelector(".exosync-resolver-3pane")).toBeNull();
  });

  it("Next conflict marks the active hunk on both panes across multiple hunks", async () => {
    const twoHunks: ConflictDetail = {
      repoKey: "repo",
      path: "note.md",
      uid: "uid-1",
      hasLocal: true,
      hasRemote: true,
      base: "a\nb\nc\nd\ne",
      local: "a\nL1\nc\nL2\ne",
      remote: "a\nR1\nc\nR2\ne",
    };
    const h = buildHarness(twoHunks, [makeConflict()]);
    await openDetail(h);

    const next = [
      ...h.body.querySelectorAll<HTMLButtonElement>(
        ".exosync-resolver-nav-btn",
      ),
    ].find((b) => b.getAttribute("aria-label")?.includes("next"))!;

    // First Next → hunk 0 active on local + remote pane.
    next.click();
    const active1 = h.body.querySelectorAll(".is-active-conflict");
    expect(active1).toHaveLength(2); // one per pane
    expect([...active1].some((n) => n.textContent?.includes("L1"))).toBe(true);
    expect([...active1].some((n) => n.textContent?.includes("R1"))).toBe(true);

    // Second Next → hunk 1 active (and hunk 0 no longer active).
    next.click();
    const active2 = h.body.querySelectorAll(".is-active-conflict");
    expect(active2).toHaveLength(2);
    expect([...active2].some((n) => n.textContent?.includes("L2"))).toBe(true);
    expect([...active2].some((n) => n.textContent?.includes("L1"))).toBe(false);
  });

  it("whole-side add/delete disables nav (no line-level hunk to scroll)", async () => {
    const addDelete: ConflictDetail = {
      repoKey: "repo",
      path: "note.md",
      uid: "uid-1",
      hasLocal: false,
      hasRemote: true,
      base: "x",
      local: undefined,
      remote: "r1\nr2",
    };
    const h = buildHarness(addDelete, [makeConflict({ hasLocal: false })]);
    await openDetail(h);

    // The bottom action bar still resolves it; the nav arrows are inert → disabled.
    const navBtns = h.body.querySelectorAll<HTMLButtonElement>(
      ".exosync-resolver-nav-btn",
    );
    expect(navBtns).toHaveLength(2);
    expect(navBtns[0].hasAttribute("disabled")).toBe(true);
    expect(navBtns[1].hasAttribute("disabled")).toBe(true);
    // No per-hunk accept button is rendered for a whole-side add/delete.
    expect(h.body.querySelector(".exosync-resolver-hunk-btn")).toBeNull();
    // Local pane shows the deletion placeholder; remote pane is all-green.
    expect(
      h.body.querySelector(".exosync-resolver-pane--local")?.textContent,
    ).toContain("(deleted on this side)");
  });
});

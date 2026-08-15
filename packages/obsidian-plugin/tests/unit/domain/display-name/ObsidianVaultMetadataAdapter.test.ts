/**
 * req 5cd9fffe — the Obsidian half of `VaultMetadataPort`.
 *
 * Two callers with DIFFERENT original strictness now share this one method, and the review of
 * PR #4052 showed both differences are real rather than theoretical:
 *
 *   engine (req f17f7c57)          `if (!(file instanceof TFile)) return null`
 *   BlockerHelpers.isEffortBlocked `if (!blockerFile) return false`   ← truthy only
 *                                  `getFileCache(f)?.frontmatter || {}` ← EMPTY, not null
 *
 * These axes pin the resolution of both, so a future edit cannot quietly re-tighten (which broke
 * DailyTasksRenderer) or re-collapse the two empty outcomes (which turned a conservative
 * "unknown status still blocks" into a fail-open "not blocked").
 */
import { describe, it, expect } from "@jest/globals";
import { ObsidianVaultMetadataAdapter } from "@plugin/domain/display-name/ObsidianVaultMetadataAdapter";
import type { App } from "obsidian";

const REQ = "@req:5cd9fffe-1fa5-4fda-8e2a-bfe6d4c88379";

/** A minimal App whose metadataCache answers exactly what a test wants. */
function makeApp(opts: {
  dest?: unknown;
  destOnRetry?: unknown;
  frontmatter?: Record<string, unknown> | undefined;
}): { app: App; linkpaths: string[] } {
  const linkpaths: string[] = [];
  const app = {
    vault: { getMarkdownFiles: () => [] },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string) => {
        linkpaths.push(linkpath);
        return linkpath.endsWith(".md")
          ? (opts.destOnRetry ?? null)
          : (opts.dest ?? null);
      },
      getFileCache: () =>
        opts.frontmatter === undefined ? null : { frontmatter: opts.frontmatter },
    },
  } as unknown as App;
  return { app, linkpaths };
}

describe("ObsidianVaultMetadataAdapter", () => {
  it(`${REQ} returns null when the linkpath resolves to nothing`, () => {
    const { app } = makeApp({ dest: null, destOnRetry: null });
    expect(new ObsidianVaultMetadataAdapter(app).resolveLinkpathFrontmatter("nope")).toBeNull();
  });

  it(`${REQ} accepts a plain file-shaped object — the guard must NOT be an instanceof check`, () => {
    // Exactly what DailyTasksRenderer.core mocks. An `instanceof TFile` guard rejects it, which
    // is how the blocker path silently stopped resolving; this axis goes red if that returns.
    const file = { path: "b.md", basename: "b" };
    const { app } = makeApp({ dest: file, frontmatter: { ems__Effort_status: "x" } });

    expect(new ObsidianVaultMetadataAdapter(app).resolveLinkpathFrontmatter("b")).toEqual({
      ems__Effort_status: "x",
    });
  });

  it(`${REQ} still rejects a FOLDER — loosening the guard must not mean removing it`, () => {
    // ⛔ Shaped like a REAL Obsidian TFolder (`children: TAbstractFile[]`), not like the shared
    // test mock, whose TFolder carries no `children` at all and therefore cannot exercise this.
    // In production `getFirstLinkpathDest` is typed `TFile | null` so this is defence in depth —
    // but the guard's whole purpose is rejecting folders, and a guard nothing tests is a guard
    // nobody can safely edit.
    const folder = { path: "dir", name: "dir", children: [] };
    const { app } = makeApp({ dest: folder, frontmatter: { a: 1 } });

    expect(new ObsidianVaultMetadataAdapter(app).resolveLinkpathFrontmatter("dir")).toBeNull();
  });

  it(`${REQ} returns {} — not null — when the file resolves but carries no frontmatter`, () => {
    // The distinction the port contract now makes explicit. `isEffortBlocked` reads this as
    // "status unknown ⇒ still blocking", which is what the pre-move code did via `|| {}`.
    // Collapsing it to null flips a conservative fail-safe into a fail-open.
    const { app } = makeApp({ dest: { path: "b.md", basename: "b" }, frontmatter: undefined });

    const r = new ObsidianVaultMetadataAdapter(app).resolveLinkpathFrontmatter("b");
    expect(r).not.toBeNull();
    expect(r).toEqual({});
  });

  it(`${REQ} retries once with a .md suffix, and only then`, () => {
    const { app, linkpaths } = makeApp({
      dest: null,
      destOnRetry: { path: "b.md", basename: "b" },
      frontmatter: { ok: true },
    });

    expect(new ObsidianVaultMetadataAdapter(app).resolveLinkpathFrontmatter("b")).toEqual({
      ok: true,
    });
    expect(linkpaths).toEqual(["b", "b.md"]);
  });
});

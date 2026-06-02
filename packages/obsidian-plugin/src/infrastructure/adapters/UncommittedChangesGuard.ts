import type { GitSubmoduleOps } from "./GitSubmoduleOps";

/**
 * UncommittedChangesGuard — RFC 22b50a17 Vision Lock #5 mitigation.
 *
 * Before destroying any AssetSpace directory, verify that the user has no
 * uncommitted local changes inside that directory's working tree. Aborting
 * с a file list is much safer than blanket-destroying user edits that have
 * not been pushed yet.
 *
 * Scope: only the AssetSpaces about to be torn down. Other AssetSpaces'
 * dirty files are out-of-scope for THIS switch (Vision Lock #5 decision —
 * we don't penalise unrelated edits).
 */
export interface UncommittedResult {
  clean: boolean;
  /** Per-AS list of dirty files (vault-relative paths). */
  affectedFiles: ReadonlyArray<{
    asUid: string;
    submodulePath: string;
    files: ReadonlyArray<string>;
  }>;
}

export interface UncommittedChangesGuardOptions {
  gitOps: GitSubmoduleOps;
}

export class UncommittedChangesGuard {
  private readonly gitOps: GitSubmoduleOps;

  constructor(opts: UncommittedChangesGuardOptions) {
    if (!opts || !opts.gitOps) {
      throw new Error("UncommittedChangesGuard: gitOps is required");
    }
    this.gitOps = opts.gitOps;
  }

  /**
   * Run `git status --porcelain assetspaces/<as>/` for each to-destroy AS.
   * Parse the porcelain output into file paths. Returns aggregated result.
   *
   * porcelain format: `XY <path>` where XY = status code, e.g. ` M filename`.
   * For our purposes any non-empty line == dirty.
   */
  async check(
    toDestroy: ReadonlyArray<{ asUid: string; submodulePath: string }>,
  ): Promise<UncommittedResult> {
    const out: Array<{
      asUid: string;
      submodulePath: string;
      files: string[];
    }> = [];
    let clean = true;
    for (const target of toDestroy) {
      const porcelain = await this.gitOps.statusPorcelain(target.submodulePath);
      const files = porcelain
        .split("\n")
        .map((l) => l.replace(/\r+$/, ""))
        .filter((l) => l.length > 0)
        .map((line) => {
          // porcelain shape: `XY <path>` — 2-char status code + space + path.
          // Do NOT trim() — that would strip the leading-space staging code
          // and shift our slice off by one. Handle renames (`R  old -> new`)
          // by taking the post-arrow target.
          const path = line.length > 3 ? line.slice(3) : line;
          const arrowIdx = path.indexOf(" -> ");
          return arrowIdx >= 0 ? path.slice(arrowIdx + 4) : path;
        });
      if (files.length > 0) {
        clean = false;
        out.push({
          asUid: target.asUid,
          submodulePath: target.submodulePath,
          files,
        });
      }
    }
    return { clean, affectedFiles: out };
  }
}

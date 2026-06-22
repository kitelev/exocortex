/**
 * Unit tests for granular within-AS materialize progress (al-mount-observability).
 *
 * A large AssetSpace mount used to emit a single `materialize` sub-phase marker
 * and then go silent for ~100s on iPhone while {@link FileSystemPort.materialize}
 * wrote thousands of files in one batched call. The mount core now hands the
 * platform a per-file tick and re-emits it throttled — `(processed, total)` every
 * {@link MATERIALIZE_PROGRESS_INTERVAL} files — but ONLY for an AssetSpace with
 * more than {@link MATERIALIZE_PROGRESS_MIN_FILES} files (a small AS stays quiet).
 * This mirrors the indexing observability (`Indexing vault: N of M assets`).
 */

import { gzipSync } from "node:zlib";
import { createTar } from "nanotar";
import {
  mountAssetSpaceFiles,
  MATERIALIZE_PROGRESS_INTERVAL,
  MATERIALIZE_PROGRESS_MIN_FILES,
  type FileSystemPort,
  type AssetSpaceHttpClient,
  type MountProgressPhase,
  type MountFileProgress,
} from "../../../../src/index";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Gzipped GitHub-shape tarball with `count` flat `.md` files under the wrapper. */
function makeTarballWithNFiles(wrapper: string, count: number): Uint8Array {
  const files = Array.from({ length: count }, (_, i) => ({
    name: `${wrapper}/f${i}.md`,
    data: enc("x"),
  }));
  return gzipSync(Buffer.from(createTar(files)));
}

function fakeHttp(blob: Uint8Array): AssetSpaceHttpClient {
  return { async fetchTarball() { return blob; } };
}

/**
 * Fake FileSystemPort honouring the production contract: its `materialize`
 * invokes `onFileWritten(processed)` after EACH file (exactly as the REST + CLI
 * adapters do). The core owns the throttle, so this fake ticks every file.
 */
function tickingFs(): FileSystemPort {
  return {
    async exists() { return false; },
    async read() { throw new Error("not used"); },
    async write() { /* not used */ },
    async removeDir() { /* not used */ },
    async materialize(_targetPath, files, onFileWritten): Promise<number> {
      let n = 0;
      for (const _f of files) {
        n++;
        onFileWritten?.(n);
      }
      return n;
    },
  };
}

interface ProgressCapture {
  phase: MountProgressPhase;
  progress?: MountFileProgress;
}

async function mountAndCapture(fileCount: number): Promise<ProgressCapture[]> {
  const events: ProgressCapture[] = [];
  await mountAssetSpaceFiles({
    http: fakeHttp(makeTarballWithNFiles(`kitelev-exoas-x-abc1234`, fileCount)),
    fs: tickingFs(),
    owner: "kitelev",
    repo: "exoas-x",
    ref: "main",
    targetPath: "assetspaces/x",
    onProgress: (phase, progress) => events.push({ phase, progress }),
  });
  return events;
}

describe("mountAssetSpaceFiles materialize progress", () => {
  it("emits N-of-M file ticks every 200 files only for an AssetSpace with >500 files @req:eba100d5-503f-43e0-bd31-994dd6303c37", async () => {
    const total = 1000;
    const events = await mountAndCapture(total);

    // Baseline phase markers (no progress payload) always fire in order.
    const bareMaterialize = events.filter(
      (e) => e.phase === "materialize" && e.progress === undefined,
    );
    expect(events.map((e) => e.phase).slice(0, 3)).toEqual(["fetch", "extract", "materialize"]);
    expect(bareMaterialize).toHaveLength(1);

    // Throttled file ticks: every INTERVAL files, skipping the final tick.
    const ticks = events
      .filter((e) => e.phase === "materialize" && e.progress !== undefined)
      .map((e) => e.progress as MountFileProgress);
    // 1000 files, interval 200 → ticks at 200,400,600,800 (NOT 1000).
    expect(ticks.map((p) => p.processed)).toEqual([200, 400, 600, 800]);
    // Each tick carries the AS volume as `total`.
    expect(ticks.every((p) => p.total === total)).toBe(true);
    // No tick at the final file (completion is covered by the post-mount marker).
    expect(ticks.some((p) => p.processed === total)).toBe(false);
    // Cadence sanity — interval is the mirror of indexing's 200.
    expect(MATERIALIZE_PROGRESS_INTERVAL).toBe(200);
  });

  it("emits NO granular file tick for an AssetSpace at or below the 500-file threshold @req:eba100d5-503f-43e0-bd31-994dd6303c37", async () => {
    // Exactly the threshold (500) — guard is strictly greater-than, so silent.
    const events = await mountAndCapture(MATERIALIZE_PROGRESS_MIN_FILES);
    const ticks = events.filter((e) => e.phase === "materialize" && e.progress !== undefined);
    expect(ticks).toHaveLength(0);
    // The baseline sub-phase markers still fire so the AS isn't fully silent.
    expect(events.map((e) => e.phase)).toEqual(["fetch", "extract", "materialize"]);
  });

  it("starts emitting ticks once the volume exceeds the threshold (501 files)", async () => {
    const events = await mountAndCapture(MATERIALIZE_PROGRESS_MIN_FILES + 1); // 501
    const ticks = events
      .filter((e) => e.phase === "materialize" && e.progress !== undefined)
      .map((e) => (e.progress as MountFileProgress).processed);
    // 501 files → ticks at 200,400 (600 > 501 never reached).
    expect(ticks).toEqual([200, 400]);
  });
});

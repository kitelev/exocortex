/**
 * Issue #3486: iOS WebKit has no Node `Buffer` global. The base64 blob
 * decode in githubRepoReader (`getBlobText` / `getBlobBytes`) referenced
 * `Buffer` bare, so EVERY mobile sync cycle threw
 * `ReferenceError: Can't find variable: Buffer` (6/14 repos errored,
 * pushed 0 pulled 0 — the path went hot with v16.81.x: #3478 examined-head
 * tree GET + #3476 base-tree reads exercise remote reads each cycle).
 *
 * These tests run the exact production decode path with the `Buffer`
 * global removed (mirroring the iOS runtime) and require byte/text-exact
 * results. Pattern mirrors NoteToRDFConverter.no-process-env.test.ts
 * (Issue #3469 — same bug class for the `process` global).
 *
 * Empirically verified per
 * ~/dotfiles/.claude/rules/integration-test-revert-verify.md:
 * FAILS (ReferenceError) on the bare-Buffer implementation, PASSES with
 * the platform-neutral helpers.
 */
import {
  getBlobText,
  getBlobBytes,
} from "../../../../src/services/sync/githubRepoReader";
import type { RestCommitTransport } from "../../../../src/infrastructure/github/restCommit";

/** Transport stub returning a GitHub-shaped base64 blob response. */
function blobTransport(base64Content: string): RestCommitTransport {
  return async () => ({
    status: 200,
    json: { content: base64Content, encoding: "base64" },
  });
}

/** GitHub embeds newlines every 60 chars in blob base64 — reproduce that. */
function withGitHubNewlines(base64: string): string {
  return base64.replace(/(.{60})/g, "$1\n") + "\n";
}

async function withoutBufferGlobal<T>(fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.Buffer;
  try {
    delete (globalThis as { Buffer?: unknown }).Buffer;
    return await fn();
  } finally {
    (globalThis as { Buffer?: unknown }).Buffer = saved;
  }
}

describe("githubRepoReader without Buffer global (Issue #3486)", () => {
  it("getBlobText decodes a UTF-8 blob when the Buffer global is absent (iOS runtime)", async () => {
    const text = "exo__Asset_label: Задача 🚀\nems__Effort_status: Doing\n";
    const base64 = withGitHubNewlines(
      Buffer.from(text, "utf-8").toString("base64"),
    );

    const decoded = await withoutBufferGlobal(() =>
      getBlobText(blobTransport(base64), "kitelev", "exoas-exo", "deadbeef"),
    );

    expect(decoded).toBe(text);
  });

  it("getBlobBytes decodes a binary blob when the Buffer global is absent (iOS runtime)", async () => {
    const bytes = new Uint8Array(512);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + 5) % 256;
    const base64 = withGitHubNewlines(Buffer.from(bytes).toString("base64"));

    const decoded = await withoutBufferGlobal(() =>
      getBlobBytes(blobTransport(base64), "kitelev", "exoas-exo", "deadbeef"),
    );

    expect(decoded).toEqual(bytes);
  });

  it("no-Buffer decode matches the desktop (Buffer present) decode byte-for-byte", async () => {
    const text = "﻿BOM-prefixed файл with emoji 🧠";
    const base64 = withGitHubNewlines(
      Buffer.from(text, "utf-8").toString("base64"),
    );

    const desktop = await getBlobText(
      blobTransport(base64),
      "kitelev",
      "exoas-exo",
      "deadbeef",
    );
    const mobile = await withoutBufferGlobal(() =>
      getBlobText(blobTransport(base64), "kitelev", "exoas-exo", "deadbeef"),
    );

    expect(mobile).toBe(desktop);
    expect(mobile).toBe(text);
  });
});

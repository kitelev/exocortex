import { describe, it, expect } from "@jest/globals";
import {
  restCreateCommit,
  type CommitFileContent,
  type RestCommitRequest,
  type RestCommitResponse,
  type RestCommitTransport,
} from "../../../../src/infrastructure/github/restCommit";

/**
 * Production-shaped GitHub Git Data API responses. These mirror the real
 * payload shapes (https://docs.github.com/en/rest/git) — NOT stub-any —
 * so the test exercises the same JSON-navigation the core does in prod.
 */
const BASE_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const TREE_SHA = "0fedcba9876543210fedcba9876543210fedcba9";
const COMMIT_SHA = "9988776655443322110099887766554433221100";

function refResponse(sha: string): RestCommitResponse {
  return {
    status: 200,
    json: {
      ref: "refs/heads/main",
      node_id: "REF_kwDOabc",
      url: "https://api.github.com/repos/o/r/git/refs/heads/main",
      object: { sha, type: "commit", url: "https://api.github.com/..." },
    },
  };
}
function treeResponse(sha: string): RestCommitResponse {
  return {
    status: 201,
    json: {
      sha,
      url: "https://api.github.com/...",
      tree: [],
      truncated: false,
    },
  };
}
function commitResponse(sha: string): RestCommitResponse {
  return {
    status: 201,
    json: {
      sha,
      node_id: "C_kwDO",
      url: "https://api.github.com/...",
      message: "msg",
      tree: { sha: TREE_SHA },
      parents: [{ sha: BASE_SHA }],
    },
  };
}

/** Build a transport that returns queued responses and records every request. */
function sequencedTransport(responses: RestCommitResponse[]): {
  transport: RestCommitTransport;
  calls: RestCommitRequest[];
} {
  const calls: RestCommitRequest[] = [];
  let i = 0;
  const transport: RestCommitTransport = (req) => {
    calls.push(req);
    const resp = responses[i++];
    if (resp === undefined) {
      return Promise.reject(
        new Error(`unexpected call #${i}: ${req.method} ${req.url}`),
      );
    }
    return Promise.resolve(resp);
  };
  return { transport, calls };
}

const happyResponses = (): RestCommitResponse[] => [
  refResponse(BASE_SHA),
  treeResponse(TREE_SHA),
  commitResponse(COMMIT_SHA),
  refResponse(COMMIT_SHA), // PATCH returns object.sha === new commit
];

describe("restCreateCommit (transport-agnostic core)", () => {
  it("executes the 4-call Git Data API chain in order and returns the commit sha", async () => {
    const { transport, calls } = sequencedTransport(happyResponses());
    const files = new Map([
      ["docs/a.md", "hello"],
      ["docs/b.md", "world"],
    ]);

    const sha = await restCreateCommit(transport, {
      owner: "o",
      repo: "r",
      branch: "main",
      files,
      message: "test commit",
    });

    expect(sha).toBe(COMMIT_SHA);
    expect(calls).toHaveLength(4);

    // Step 1 — GET ref.
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: "https://api.github.com/repos/o/r/git/refs/heads/main",
    });
    expect(calls[0].body).toBeUndefined();

    // Step 2 — POST tree with base_tree + recursive blobs.
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/repos/o/r/git/trees",
      contentType: "application/json",
    });
    const treeBody = JSON.parse(calls[1].body as string);
    expect(treeBody.base_tree).toBe(BASE_SHA);
    expect(treeBody.tree).toHaveLength(2);
    expect(treeBody.tree[0]).toEqual({
      path: "docs/a.md",
      mode: "100644",
      type: "blob",
      content: "hello",
    });
    expect(treeBody.tree[1]).toEqual({
      path: "docs/b.md",
      mode: "100644",
      type: "blob",
      content: "world",
    });

    // Step 3 — POST commit referencing tree + base parent.
    expect(calls[2]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/repos/o/r/git/commits",
      contentType: "application/json",
    });
    const commitBody = JSON.parse(calls[2].body as string);
    expect(commitBody.message).toBe("test commit");
    expect(commitBody.tree).toBe(TREE_SHA);
    expect(commitBody.parents).toEqual([BASE_SHA]);

    // Step 4 — PATCH ref fast-forward (force:false).
    expect(calls[3]).toMatchObject({
      method: "PATCH",
      url: "https://api.github.com/repos/o/r/git/refs/heads/main",
      contentType: "application/json",
    });
    const patchBody = JSON.parse(calls[3].body as string);
    expect(patchBody.sha).toBe(COMMIT_SHA);
    expect(patchBody.force).toBe(false);
  });

  it("URL-encodes owner/repo/branch segments", async () => {
    const { transport, calls } = sequencedTransport([
      refResponse(BASE_SHA),
      treeResponse(TREE_SHA),
      commitResponse(COMMIT_SHA),
      refResponse(COMMIT_SHA),
    ]);
    await restCreateCommit(transport, {
      owner: "my org",
      repo: "re po",
      branch: "feat/x",
      files: new Map([["f", "c"]]),
      message: "m",
    });
    expect(calls[0].url).toContain(
      "/repos/my%20org/re%20po/git/refs/heads/feat%2Fx",
    );
  });

  it("honours a custom baseURL and strips its trailing slash", async () => {
    const { transport, calls } = sequencedTransport(happyResponses());
    await restCreateCommit(transport, {
      owner: "o",
      repo: "r",
      branch: "main",
      files: new Map([["f", "c"]]),
      message: "m",
      baseURL: "https://ghe.example.com/api/v3/",
    });
    expect(calls[0].url).toBe(
      "https://ghe.example.com/api/v3/repos/o/r/git/refs/heads/main",
    );
  });

  // ── validation ────────────────────────────────────────────────────
  it("rejects an empty owner", async () => {
    const { transport } = sequencedTransport([]);
    await expect(
      restCreateCommit(transport, {
        owner: "",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/owner is required/);
  });

  it("rejects an empty repo", async () => {
    const { transport } = sequencedTransport([]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/repo is required/);
  });

  it("rejects an empty branch", async () => {
    const { transport } = sequencedTransport([]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/branch is required/);
  });

  it("emits deletions as sha:null tree entries on top of base_tree (#3476)", async () => {
    const { transport, calls } = sequencedTransport(happyResponses());

    const sha = await restCreateCommit(transport, {
      owner: "o",
      repo: "r",
      branch: "main",
      files: new Map([["docs/a.md", "hello"]]),
      deletions: ["docs/old.md", "docs/gone.md"],
      message: "rename + delete",
    });

    expect(sha).toBe(COMMIT_SHA);
    const treeBody = JSON.parse(calls[1].body as string);
    expect(treeBody.base_tree).toBe(BASE_SHA);
    expect(treeBody.tree).toHaveLength(3);
    expect(treeBody.tree[0]).toEqual({
      path: "docs/a.md",
      mode: "100644",
      type: "blob",
      content: "hello",
    });
    expect(treeBody.tree[1]).toEqual({
      path: "docs/old.md",
      mode: "100644",
      type: "blob",
      sha: null,
    });
    expect(treeBody.tree[2]).toEqual({
      path: "docs/gone.md",
      mode: "100644",
      type: "blob",
      sha: null,
    });
  });

  it("allows a deletion-only commit (empty files map + non-empty deletions)", async () => {
    const { transport, calls } = sequencedTransport(happyResponses());

    const sha = await restCreateCommit(transport, {
      owner: "o",
      repo: "r",
      branch: "main",
      files: new Map(),
      deletions: ["docs/only-delete.md"],
      message: "delete only",
    });

    expect(sha).toBe(COMMIT_SHA);
    const treeBody = JSON.parse(calls[1].body as string);
    expect(treeBody.tree).toEqual([
      { path: "docs/only-delete.md", mode: "100644", type: "blob", sha: null },
    ]);
  });

  it("deduplicates repeated deletion paths (one sha:null entry per path)", async () => {
    const { transport, calls } = sequencedTransport(happyResponses());

    await restCreateCommit(transport, {
      owner: "o",
      repo: "r",
      branch: "main",
      files: new Map([["docs/a.md", "hello"]]),
      deletions: ["docs/old.md", "docs/old.md"],
      message: "duplicate deletions",
    });

    const treeBody = JSON.parse(calls[1].body as string);
    expect(treeBody.tree).toHaveLength(2); // 1 write + 1 deduped deletion
    expect(treeBody.tree[1]).toEqual({
      path: "docs/old.md",
      mode: "100644",
      type: "blob",
      sha: null,
    });
  });

  it("rejects a path that is both written and deleted (ambiguous)", async () => {
    const { transport } = sequencedTransport(happyResponses());
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["docs/a.md", "hello"]]),
        deletions: ["docs/a.md"],
        message: "ambiguous",
      }),
    ).rejects.toThrow(/both written and deleted/);
  });

  it("rejects an empty deletion path", async () => {
    const { transport } = sequencedTransport(happyResponses());
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["docs/a.md", "hello"]]),
        deletions: [""],
        message: "bad deletion",
      }),
    ).rejects.toThrow(/deletion path/);
  });

  it("rejects when files AND deletions are both empty", async () => {
    const { transport } = sequencedTransport(happyResponses());
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map(),
        deletions: [],
        message: "nothing",
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it("rejects an empty file map", async () => {
    const { transport } = sequencedTransport([]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map(),
        message: "m",
      }),
    ).rejects.toThrow(/files map must be non-empty/);
  });

  it("rejects a non-Map files value", async () => {
    const { transport } = sequencedTransport([]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        // @ts-expect-error — deliberately wrong type to exercise the guard
        files: { f: "c" },
        message: "m",
      }),
    ).rejects.toThrow(/files map must be non-empty/);
  });

  it("rejects an empty message", async () => {
    const { transport } = sequencedTransport([]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "",
      }),
    ).rejects.toThrow(/message is required/);
  });

  // ── structural response errors ────────────────────────────────────
  it("throws when the ref response is missing object.sha", async () => {
    const { transport } = sequencedTransport([{ status: 200, json: {} }]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/missing object\.sha for ref heads\/main/);
  });

  it("throws when object exists but sha is not a string", async () => {
    const { transport } = sequencedTransport([
      { status: 200, json: { object: { sha: 123 } } },
    ]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/missing object\.sha/);
  });

  it("throws when object is null", async () => {
    const { transport } = sequencedTransport([
      { status: 200, json: { object: null } },
    ]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/missing object\.sha/);
  });

  it("throws when json itself is null/undefined", async () => {
    const { transport } = sequencedTransport([{ status: 200 }]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/missing object\.sha/);
  });

  it("throws when the tree response is missing sha", async () => {
    const { transport } = sequencedTransport([
      refResponse(BASE_SHA),
      { status: 201, json: {} },
    ]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/tree create returned no sha/);
  });

  it("throws when the commit response is missing sha", async () => {
    const { transport } = sequencedTransport([
      refResponse(BASE_SHA),
      treeResponse(TREE_SHA),
      { status: 201, json: {} },
    ]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/commit create returned no sha/);
  });

  it("throws on ref update mismatch (PATCH returned a different sha)", async () => {
    const { transport } = sequencedTransport([
      refResponse(BASE_SHA),
      treeResponse(TREE_SHA),
      commitResponse(COMMIT_SHA),
      refResponse("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
    ]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/ref update mismatch \(expected .+, got deadbeef/);
  });

  // ── redaction + transport error propagation ───────────────────────
  it("applies the injected redact fn to structural error strings", async () => {
    const { transport } = sequencedTransport([{ status: 200, json: {} }]);
    const redact = (m: string): string => m.replace(/heads\/main/, "***");
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
        redact,
      }),
    ).rejects.toThrow(/missing object\.sha for ref \*\*\*/);
  });

  it("propagates a transport-thrown error (non-2xx is the transport's job)", async () => {
    const transport: RestCommitTransport = () =>
      Promise.reject(new Error("GitHub request GET ... → HTTP 404: Not Found"));
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["f", "c"]]),
        message: "m",
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  // ---- Phase C (ExoSync C2, VL#11): binary payloads as plain git blobs ----

  const BLOB_SHA = "1122334455667788990011223344556677889900";

  function blobResponse(sha: string): RestCommitResponse {
    return {
      status: 201,
      json: { sha, url: "https://api.github.com/repos/o/r/git/blobs/..." },
    };
  }

  it("uploads binary payloads via POST git/blobs and references them by sha in the tree", async () => {
    const { transport, calls } = sequencedTransport([
      refResponse(BASE_SHA),
      blobResponse(BLOB_SHA), // step 1.5 — binary blob upload
      treeResponse(TREE_SHA),
      commitResponse(COMMIT_SHA),
      refResponse(COMMIT_SHA),
    ]);
    const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]).toString(
      "base64",
    );

    const sha = await restCreateCommit(transport, {
      owner: "o",
      repo: "r",
      branch: "main",
      files: new Map<string, CommitFileContent>([
        ["docs/a.md", "hello"],
        ["img/pic.png", { base64: pngBase64 }],
      ]),
      message: "binary commit",
    });

    expect(sha).toBe(COMMIT_SHA);
    expect(calls).toHaveLength(5);

    // Step 1.5 — POST git/blobs with the base64 payload.
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/repos/o/r/git/blobs",
      contentType: "application/json",
    });
    expect(JSON.parse(calls[1].body as string)).toEqual({
      content: pngBase64,
      encoding: "base64",
    });

    // Step 2 — tree mixes inline text content with the blob-sha reference;
    // the binary entry must NOT carry inline `content` (UTF-8-only field).
    const treeBody = JSON.parse(calls[2].body as string);
    expect(treeBody.tree).toEqual([
      { path: "docs/a.md", mode: "100644", type: "blob", content: "hello" },
      { path: "img/pic.png", mode: "100644", type: "blob", sha: BLOB_SHA },
    ]);
  });

  it("fails loud when the blob upload returns no sha", async () => {
    const { transport } = sequencedTransport([
      refResponse(BASE_SHA),
      { status: 201, json: {} }, // malformed blob response
    ]);
    await expect(
      restCreateCommit(transport, {
        owner: "o",
        repo: "r",
        branch: "main",
        files: new Map([["img/pic.png", { base64: "AAAA" }]]),
        message: "m",
      }),
    ).rejects.toThrow(/blob create returned no sha for img\/pic\.png/);
  });
});

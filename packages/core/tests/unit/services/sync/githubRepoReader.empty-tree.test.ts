/**
 * Issue #4184 — an empty remote tree is an empty file list, not an error.
 *
 * A branch head may legitimately reference the canonical git empty tree
 * (`4b825dc6…`): the repo exists, the branch resolves, nothing is committed
 * yet. GitHub still answers **404** for `GET git/trees/4b825dc6…` even when
 * the repo is reachable and allowlisted — the 404 is a property of the
 * REQUEST, not of reachability. Every `getTree` caller that classifies 404 as
 * "repo unreachable" therefore misreports a healthy empty repo.
 *
 * Empirically revert-verified per
 * ~/dotfiles/.claude/rules/integration-test-revert-verify.md: removing the
 * short-circuit makes A1 RED (the stub throws the same 404 GitHub does) while
 * A2 stays GREEN, so A2 is the control proving A1 is not vacuous.
 */
import {
  EMPTY_TREE_SHA,
  getTree,
} from "../../../../src/services/sync/githubRepoReader";
import type {
  RestCommitRequest,
  RestCommitTransport,
} from "../../../../src/infrastructure/github/restCommit";

/**
 * Transport mirroring GitHub for tree reads: a known SHA yields blob entries,
 * anything else — including the empty tree — throws the 404 the real API
 * returns. Records every request so "no round trip" is observable.
 */
function treeTransport(known: Record<string, string>): {
  transport: RestCommitTransport;
  requests: RestCommitRequest[];
} {
  const requests: RestCommitRequest[] = [];
  const transport: RestCommitTransport = async (req) => {
    requests.push(req);
    const sha = /git\/trees\/([^/?]+)/.exec(req.url)?.[1];
    if (sha === undefined || known[sha] === undefined) {
      throw new Error(`GET ${req.url} failed: HTTP 404 Not Found`);
    }
    return {
      status: 200,
      json: {
        sha,
        truncated: false,
        tree: [
          { path: known[sha], type: "blob", mode: "100644", sha: "b1", size: 7 },
        ],
      },
    };
  };
  return { transport, requests };
}

describe("getTree — canonical empty tree (@req:029c90ee-e10b-4398-909e-c2784fed7ac9)", () => {
  it("A1: empty-tree SHA yields an empty entry list without any HTTP request", async () => {
    const { transport, requests } = treeTransport({});

    const entries = await getTree(
      transport,
      "test-owner",
      "empty-repo",
      EMPTY_TREE_SHA,
    );

    expect(entries).toEqual([]);
    // No round trip: an empty tree contains zero blobs by definition, and the
    // request GitHub would answer 404 is never issued.
    expect(requests).toHaveLength(0);
  });

  it("A2 (control): a populated tree SHA is still fetched and parsed", async () => {
    const { transport, requests } = treeTransport({ t1: "assets/a.md" });

    const entries = await getTree(transport, "test-owner", "live-repo", "t1");

    expect(entries).toEqual([
      { path: "assets/a.md", blobSha: "b1", size: 7 },
    ]);
    expect(requests).toHaveLength(1);
  });

  it("A3 (negative control): an unknown tree SHA still propagates the 404", async () => {
    const { transport, requests } = treeTransport({ t1: "assets/a.md" });

    await expect(
      getTree(transport, "test-owner", "dead-repo", "deadbeef"),
    ).rejects.toThrow(/HTTP 404/);
    // The short-circuit is keyed on the empty-tree SHA alone — it must not
    // swallow genuine 404s, which is how "stopped the false alarm" stays
    // distinguishable from "stopped detecting".
    expect(requests).toHaveLength(1);
  });

  it("A4: the exported constant is the canonical git empty tree", () => {
    expect(EMPTY_TREE_SHA).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  });
});

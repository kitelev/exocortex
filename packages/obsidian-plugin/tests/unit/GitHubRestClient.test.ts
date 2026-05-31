import type { App, RequestUrlResponse } from "obsidian";

jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
}));
jest.mock("nanotar", () => ({
  parseTarGzip: jest.fn(),
}));

// Import after jest.mock declarations so the mocked modules resolve.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GitHubRestClient } = require("../../src/infrastructure/adapters/GitHubRestClient");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const requestUrlMock: jest.Mock = require("obsidian").requestUrl;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parseTarGzipMock: jest.Mock = require("nanotar").parseTarGzip;

const FAKE_PAT = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 4 + 36 = 40 chars; synthetic, never real
const fakeApp = {} as App;

function ok(body: {
  json?: unknown;
  text?: string;
  arrayBuffer?: ArrayBuffer;
  headers?: Record<string, string>;
  status?: number;
}): RequestUrlResponse {
  return {
    status: body.status ?? 200,
    headers: body.headers ?? {},
    arrayBuffer: body.arrayBuffer ?? new ArrayBuffer(0),
    json: body.json ?? {},
    text: body.text ?? "",
  };
}

describe("GitHubRestClient", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
    parseTarGzipMock.mockReset();
  });

  // ─── constructor ──────────────────────────────────────────────────
  describe("constructor", () => {
    it("requires PAT", () => {
      expect(
        () => new GitHubRestClient({ pat: "", app: fakeApp }),
      ).toThrow(/PAT is required/);
    });

    it("requires App", () => {
      expect(
        () =>
          new GitHubRestClient({ pat: FAKE_PAT, app: undefined as unknown as obsidian.App }),
      ).toThrow(/App is required/);
    });

    it("defaults baseURL to api.github.com", async () => {
      requestUrlMock.mockResolvedValue(ok({ json: { commit: { sha: "abc" } } }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await c.getRepoHead("o", "r");
      expect(requestUrlMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://api.github.com/repos/o/r/branches/main",
        }),
      );
    });

    it("exposes app via getter for downstream consumers", () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      expect(c.app).toBe(fakeApp);
    });

    it("strips trailing slash from custom baseURL", async () => {
      requestUrlMock.mockResolvedValue(ok({ json: { commit: { sha: "abc" } } }));
      const c = new GitHubRestClient({
        pat: FAKE_PAT,
        app: fakeApp,
        baseURL: "https://ghe.example.com/api/v3/",
      });
      await c.getRepoHead("o", "r");
      expect(requestUrlMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://ghe.example.com/api/v3/repos/o/r/branches/main",
        }),
      );
    });
  });

  // ─── Security #4: URL allowlist ───────────────────────────────────
  describe("validateRepoURL (Security #4)", () => {
    it("accepts canonical github.com/owner/repo", () => {
      expect(() =>
        GitHubRestClient.validateRepoURL("https://github.com/kitelev/exocortex"),
      ).not.toThrow();
    });

    it("accepts repo names with dots and hyphens (real-world OK)", () => {
      expect(() =>
        GitHubRestClient.validateRepoURL("https://github.com/kitelev/my-repo.v2"),
      ).not.toThrow();
    });

    it.each([
      ["extra path", "https://github.com/foo/bar/baz"],
      ["query string", "https://github.com/foo/bar?ref=main"],
      ["fragment", "https://github.com/foo/bar#readme"],
      ["wrong host", "https://gitlab.com/foo/bar"],
      ["http scheme", "http://github.com/foo/bar"],
      ["www host", "https://www.github.com/foo/bar"],
      ["path traversal in repo", "https://github.com/foo/.."],
      ["path traversal in owner", "https://github.com/../etc"],
      ["scheme injection", "javascript:alert(1)"],
      ["data URL", "data:text/html;base64,PHNjcmlwdD4="],
      ["leading dot in repo", "https://github.com/foo/.hidden"],
      ["empty", ""],
      ["raw shell metachar", "https://github.com/foo/bar;rm"],
    ])("rejects %s", (_label, bad) => {
      expect(() => GitHubRestClient.validateRepoURL(bad)).toThrow();
    });

    it("rejects URLs exceeding 256 chars", () => {
      const longRepo = "a".repeat(300);
      expect(() =>
        GitHubRestClient.validateRepoURL(`https://github.com/owner/${longRepo}`),
      ).toThrow(/exceeds 256/);
    });

    it("rejects non-string input", () => {
      expect(() =>
        GitHubRestClient.validateRepoURL(null as unknown as string),
      ).toThrow();
    });
  });

  // ─── Security #3: PAT redaction ───────────────────────────────────
  describe("redact (Security #3)", () => {
    it("redacts ghp_ token in error message", () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const out = (c as any).redact(`Auth failed: ${FAKE_PAT}`);
      expect(out).toBe("Auth failed: ***REDACTED***");
      expect(out).not.toContain("ghp_");
    });

    it.each([
      ["gho_", "gho_OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO"],
      ["ghu_", "ghu_UUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUU"],
      ["ghs_", "ghs_SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS"],
      ["ghr_", "ghr_RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR"],
    ])("redacts %s token shape", (_label, token) => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      expect((c as any).redact(`leak: ${token}`)).toBe("leak: ***REDACTED***");
    });

    it("redacts multiple PATs in same message", () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const second = "ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
      const out = (c as any).redact(`x ${FAKE_PAT} y ${second} z`);
      expect(out).toBe("x ***REDACTED*** y ***REDACTED*** z");
    });

    it("leaves non-PAT text unchanged", () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      expect((c as any).redact("nothing sensitive here")).toBe(
        "nothing sensitive here",
      );
    });

    it("redacts PAT leaked through HTTP error response body", async () => {
      // Simulate GitHub returning the PAT echoed in error body (or a logger
      // that captured Authorization header). Must NOT reach caller as plaintext.
      requestUrlMock.mockResolvedValue(
        ok({
          status: 401,
          text: `{"message":"Bad credentials","token":"${FAKE_PAT}"}`,
        }),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.getRepoHead("o", "r")).rejects.toThrow(/\*\*\*REDACTED\*\*\*/);
      await expect(c.getRepoHead("o", "r")).rejects.not.toThrow(/ghp_/);
    });

    it("redact passes through non-string input safely", () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const out = (c as any).redact(undefined);
      expect(out).toBeUndefined();
    });
  });

  // ─── Security #10: rate-limit gate ────────────────────────────────
  describe("checkRateLimit + ensureRateLimit (Security #10)", () => {
    it("parses /rate_limit JSON body correctly", async () => {
      const resetEpoch = 1_780_300_000;
      requestUrlMock.mockResolvedValue(
        ok({
          json: {
            resources: {
              core: { limit: 5000, remaining: 4500, reset: resetEpoch, used: 500 },
            },
          },
        }),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const out = await c.checkRateLimit();
      expect(out.remaining).toBe(4500);
      expect(out.resetAt.getTime()).toBe(resetEpoch * 1000);
    });

    it("throws on malformed /rate_limit response", async () => {
      requestUrlMock.mockResolvedValue(ok({ json: { resources: {} } }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.checkRateLimit()).rejects.toThrow(/malformed/);
    });

    it("ensureRateLimit refuses when remaining < needed + 10", async () => {
      const futureEpoch = Math.floor(Date.now() / 1000) + 600;
      requestUrlMock.mockResolvedValue(
        ok({
          json: {
            resources: { core: { remaining: 5, reset: futureEpoch } },
          },
        }),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.ensureRateLimit(20)).rejects.toThrow(
        /Rate limit guard: 5 remaining < 30 needed/,
      );
    });

    it("ensureRateLimit resolves when remaining >= needed + 10", async () => {
      requestUrlMock.mockResolvedValue(
        ok({
          json: {
            resources: { core: { remaining: 100, reset: 1_780_300_000 } },
          },
        }),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.ensureRateLimit(20)).resolves.toBeUndefined();
    });

    it("ensureRateLimit rejects negative neededCalls", async () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.ensureRateLimit(-1)).rejects.toThrow(
        /non-negative number/,
      );
    });

    it("ensureRateLimit error reports seconds-to-reset", async () => {
      const futureEpoch = Math.floor(Date.now() / 1000) + 300;
      requestUrlMock.mockResolvedValue(
        ok({
          json: { resources: { core: { remaining: 0, reset: futureEpoch } } },
        }),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.ensureRateLimit(5)).rejects.toThrow(/resets in \d+s/);
    });
  });

  // ─── getRepoHead ──────────────────────────────────────────────────
  describe("getRepoHead", () => {
    it("returns commit.sha", async () => {
      requestUrlMock.mockResolvedValue(
        ok({ json: { commit: { sha: "abc123def456" } } }),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const out = await c.getRepoHead("kitelev", "exocortex", "main");
      expect(out).toEqual({ sha: "abc123def456" });
    });

    it("URL-encodes owner/repo/branch params", async () => {
      requestUrlMock.mockResolvedValue(ok({ json: { commit: { sha: "x" } } }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      // these owner/repo names would be rejected by requireOwnerRepo; use legal names
      await c.getRepoHead("owner", "repo.with.dots", "feature_x");
      expect(requestUrlMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://api.github.com/repos/owner/repo.with.dots/branches/feature_x",
        }),
      );
    });

    it("includes Authorization header with PAT", async () => {
      requestUrlMock.mockResolvedValue(ok({ json: { commit: { sha: "x" } } }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await c.getRepoHead("o", "r");
      const call = requestUrlMock.mock.calls[0][0];
      expect(call.headers.Authorization).toBe(`Bearer ${FAKE_PAT}`);
      expect(call.headers.Accept).toBe("application/vnd.github+json");
    });

    it("throws on missing commit.sha", async () => {
      requestUrlMock.mockResolvedValue(ok({ json: {} }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.getRepoHead("o", "r")).rejects.toThrow(/missing commit\.sha/);
    });

    it("throws on HTTP 404", async () => {
      requestUrlMock.mockResolvedValue(
        ok({ status: 404, text: "Not Found" }),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.getRepoHead("o", "r")).rejects.toThrow(/HTTP 404/);
    });

    it("rejects path-traversal owner/repo before issuing request", async () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.getRepoHead("..", "r")).rejects.toThrow(/Invalid GitHub owner/);
      await expect(c.getRepoHead("o", "..")).rejects.toThrow(/path-traversal/);
      expect(requestUrlMock).not.toHaveBeenCalled();
    });

    it("rejects shell-metacharacter owner", async () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.getRepoHead("owner;rm", "repo")).rejects.toThrow(
        /Invalid GitHub owner/,
      );
    });
  });

  // ─── pullTarball ──────────────────────────────────────────────────
  describe("pullTarball", () => {
    it("returns async iterable of tar items", async () => {
      const buf = new ArrayBuffer(8);
      requestUrlMock.mockResolvedValue(ok({ arrayBuffer: buf }));
      parseTarGzipMock.mockResolvedValue([
        { name: "a.md", data: new Uint8Array([1]) },
        { name: "b.md", data: new Uint8Array([2]) },
      ]);
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const iter = await c.pullTarball("o", "r", "HEAD");
      const names: string[] = [];
      for await (const item of iter) {
        names.push(item.name);
      }
      expect(names).toEqual(["a.md", "b.md"]);
      expect(parseTarGzipMock).toHaveBeenCalledWith(buf);
    });

    it("throws on missing arrayBuffer", async () => {
      requestUrlMock.mockResolvedValue({
        status: 200,
        headers: {},
        json: {},
        text: "",
        arrayBuffer: undefined,
      } as unknown as RequestUrlResponse);
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.pullTarball("o", "r")).rejects.toThrow(/missing arrayBuffer/);
    });

    it("redacts PAT if parse error message contains it", async () => {
      requestUrlMock.mockResolvedValue(ok({ arrayBuffer: new ArrayBuffer(8) }));
      parseTarGzipMock.mockRejectedValue(
        new Error(`parse failed with token ${FAKE_PAT}`),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(c.pullTarball("o", "r")).rejects.toThrow(/\*\*\*REDACTED\*\*\*/);
    });
  });

  // ─── createCommit ─────────────────────────────────────────────────
  describe("createCommit", () => {
    it("executes 4-call chain in order and returns commit sha", async () => {
      requestUrlMock
        .mockResolvedValueOnce(ok({ json: { object: { sha: "base-sha" } } }))
        .mockResolvedValueOnce(ok({ json: { sha: "tree-sha" } }))
        .mockResolvedValueOnce(ok({ json: { sha: "commit-sha" } }))
        .mockResolvedValueOnce(ok({ json: { object: { sha: "commit-sha" } } }));

      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const files = new Map([
        ["docs/a.md", "hello"],
        ["docs/b.md", "world"],
      ]);
      const sha = await c.createCommit("o", "r", "main", files, "test commit");
      expect(sha).toBe("commit-sha");

      const calls = requestUrlMock.mock.calls.map((c) => c[0]);
      expect(calls[0]).toMatchObject({
        method: "GET",
        url: expect.stringContaining("/git/refs/heads/main"),
      });
      expect(calls[1]).toMatchObject({
        method: "POST",
        url: expect.stringContaining("/git/trees"),
      });
      const treeBody = JSON.parse(calls[1].body);
      expect(treeBody.base_tree).toBe("base-sha");
      expect(treeBody.tree).toHaveLength(2);
      expect(treeBody.tree[0]).toMatchObject({
        path: "docs/a.md",
        mode: "100644",
        type: "blob",
        content: "hello",
      });

      expect(calls[2]).toMatchObject({
        method: "POST",
        url: expect.stringContaining("/git/commits"),
      });
      const commitBody = JSON.parse(calls[2].body);
      expect(commitBody.message).toBe("test commit");
      expect(commitBody.tree).toBe("tree-sha");
      expect(commitBody.parents).toEqual(["base-sha"]);

      expect(calls[3]).toMatchObject({
        method: "PATCH",
        url: expect.stringContaining("/git/refs/heads/main"),
      });
      const patchBody = JSON.parse(calls[3].body);
      expect(patchBody.sha).toBe("commit-sha");
      expect(patchBody.force).toBe(false);
    });

    it("rejects empty file map", async () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(
        c.createCommit("o", "r", "main", new Map(), "msg"),
      ).rejects.toThrow(/files map must be non-empty/);
    });

    it("rejects empty branch", async () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(
        c.createCommit("o", "r", "", new Map([["x", "y"]]), "msg"),
      ).rejects.toThrow(/branch is required/);
    });

    it("rejects empty message", async () => {
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(
        c.createCommit("o", "r", "main", new Map([["x", "y"]]), ""),
      ).rejects.toThrow(/message is required/);
    });

    it("throws when ref update returns mismatched sha", async () => {
      requestUrlMock
        .mockResolvedValueOnce(ok({ json: { object: { sha: "base" } } }))
        .mockResolvedValueOnce(ok({ json: { sha: "tree" } }))
        .mockResolvedValueOnce(ok({ json: { sha: "commit-A" } }))
        .mockResolvedValueOnce(ok({ json: { object: { sha: "commit-B" } } }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(
        c.createCommit("o", "r", "main", new Map([["x", "y"]]), "m"),
      ).rejects.toThrow(/ref update mismatch/);
    });

    it("throws when ref response is missing object.sha", async () => {
      requestUrlMock.mockResolvedValueOnce(ok({ json: {} }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(
        c.createCommit("o", "r", "main", new Map([["x", "y"]]), "m"),
      ).rejects.toThrow(/missing object\.sha/);
    });

    it("throws when tree response is missing sha", async () => {
      requestUrlMock
        .mockResolvedValueOnce(ok({ json: { object: { sha: "base" } } }))
        .mockResolvedValueOnce(ok({ json: {} }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(
        c.createCommit("o", "r", "main", new Map([["x", "y"]]), "m"),
      ).rejects.toThrow(/tree create returned no sha/);
    });

    it("throws when commit response is missing sha", async () => {
      requestUrlMock
        .mockResolvedValueOnce(ok({ json: { object: { sha: "base" } } }))
        .mockResolvedValueOnce(ok({ json: { sha: "tree" } }))
        .mockResolvedValueOnce(ok({ json: {} }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      await expect(
        c.createCommit("o", "r", "main", new Map([["x", "y"]]), "m"),
      ).rejects.toThrow(/commit create returned no sha/);
    });
  });

  // ─── network error path ──────────────────────────────────────────
  describe("network errors", () => {
    it("redacts PAT-shaped substrings in thrown error", async () => {
      requestUrlMock.mockRejectedValue(
        new Error(`socket hangup; ctx=${FAKE_PAT}`),
      );
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const err = await c.getRepoHead("o", "r").catch((e: Error) => e);
      expect(err.message).toContain("***REDACTED***");
      expect(err.message).not.toContain("ghp_");
    });

    it("truncates large error response bodies", async () => {
      const huge = "x".repeat(2000);
      requestUrlMock.mockResolvedValue(ok({ status: 500, text: huge }));
      const c = new GitHubRestClient({ pat: FAKE_PAT, app: fakeApp });
      const err = await c.getRepoHead("o", "r").catch((e: Error) => e);
      expect(err.message.length).toBeLessThan(500);
      expect(err.message).toContain("...");
    });
  });
});

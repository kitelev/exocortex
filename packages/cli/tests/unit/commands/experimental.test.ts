/**
 * @jest-environment node
 *
 * Unit tests for the `experimental rest-push` command logic (RFC 01a83de8
 * Phase 0). Exercises the pure `runRestPush` core with an injected fake
 * pusher + injected env/fs/gh-token — no process.exit, no network.
 */
import {
  runRestPush,
  parseRepoSlug,
  experimentalEnabled,
  type RestPushOptions,
  type RestPusher,
} from "../../../src/commands/experimental";

const FAKE_PAT = "ghp_" + "B".repeat(36);
const COMMIT_SHA = "1122334455667788990011223344556677889900";

function baseOptions(over: Partial<RestPushOptions> = {}): RestPushOptions {
  return {
    repo: "kitelev/exoas-restapi-poc",
    branch: "main",
    file: "poc.md",
    content: "hello from REST",
    message: "test: poc commit",
    token: FAKE_PAT,
    experimental: true,
    apiBase: "https://api.github.com",
    ...over,
  };
}

function fakePusher(): { pusher: RestPusher; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const pusher: RestPusher = {
    push: (...args) => {
      calls.push(args);
      return Promise.resolve(COMMIT_SHA);
    },
  };
  return { pusher, calls };
}

describe("experimental rest-push", () => {
  describe("experimentalEnabled gate", () => {
    it("is false by default (no flag, no env)", () => {
      expect(
        experimentalEnabled(baseOptions({ experimental: false }), {}),
      ).toBe(false);
    });
    it("is true via --experimental flag", () => {
      expect(experimentalEnabled(baseOptions({ experimental: true }), {})).toBe(
        true,
      );
    });
    it("is true via EXOCORTEX_EXPERIMENTAL_REST_PUSH=1 env", () => {
      expect(
        experimentalEnabled(baseOptions({ experimental: false }), {
          EXOCORTEX_EXPERIMENTAL_REST_PUSH: "1",
        }),
      ).toBe(true);
    });
  });

  describe("parseRepoSlug", () => {
    it("splits owner/repo", () => {
      expect(parseRepoSlug("kitelev/exoas-restapi-poc")).toEqual({
        owner: "kitelev",
        repo: "exoas-restapi-poc",
      });
    });
    it("rejects missing slash", () => {
      expect(() => parseRepoSlug("kitelev")).toThrow(/exactly <owner>\/<repo>/);
    });
    it("rejects three segments", () => {
      expect(() => parseRepoSlug("a/b/c")).toThrow(/exactly <owner>\/<repo>/);
    });
    it("rejects path-traversal", () => {
      expect(() => parseRepoSlug("../x")).toThrow(
        /invalid characters|path-traversal/,
      );
    });
    it("rejects flag-shaped owner", () => {
      expect(() => parseRepoSlug("-evil/repo")).toThrow(/path-traversal\/flag/);
    });
  });

  describe("runRestPush", () => {
    it("pushes inline --content and returns a structured result", async () => {
      const { pusher, calls } = fakePusher();
      const result = await runRestPush(baseOptions(), {
        serviceFactory: () => pusher,
        env: {},
      });
      expect(result).toEqual({
        ok: true,
        repo: "kitelev/exoas-restapi-poc",
        branch: "main",
        file: "poc.md",
        sha: COMMIT_SHA,
        url: `https://github.com/kitelev/exoas-restapi-poc/commit/${COMMIT_SHA}`,
        transport: "fetch",
        method: "git-data-api",
      });
      // Verify the file map carried path → content.
      const [, , , filesArg] = calls[0] as [
        string,
        string,
        string,
        Map<string, string>,
        string,
      ];
      expect(filesArg.get("poc.md")).toBe("hello from REST");
    });

    it("reads content from --content-file when --content absent", async () => {
      const { pusher } = fakePusher();
      const result = await runRestPush(
        baseOptions({ content: undefined, contentFile: "/tmp/whatever.md" }),
        {
          serviceFactory: () => pusher,
          readFileImpl: (p) => `from-file:${p}`,
          env: {},
        },
      );
      expect(result.sha).toBe(COMMIT_SHA);
    });

    it("resolves token via gh when --token-from-gh", async () => {
      const { pusher } = fakePusher();
      let capturedToken = "";
      const result = await runRestPush(
        baseOptions({ tokenFromGh: true, token: undefined }),
        {
          serviceFactory: (opts) => {
            capturedToken = opts.token;
            return pusher;
          },
          ghTokenRunner: () => `${FAKE_PAT}\n`,
          env: {},
        },
      );
      expect(result.sha).toBe(COMMIT_SHA);
      expect(capturedToken).toBe(FAKE_PAT);
    });

    it("falls back to GITHUB_TOKEN env when no flags", async () => {
      const { pusher } = fakePusher();
      let capturedToken = "";
      await runRestPush(baseOptions({ token: undefined }), {
        serviceFactory: (opts) => {
          capturedToken = opts.token;
          return pusher;
        },
        env: { GITHUB_TOKEN: FAKE_PAT },
      });
      expect(capturedToken).toBe(FAKE_PAT);
    });

    it("rejects when experimental gate is off", async () => {
      await expect(
        runRestPush(baseOptions({ experimental: false }), { env: {} }),
      ).rejects.toThrow(/experimental and opt-in/);
    });

    it("rejects both --content and --content-file", async () => {
      await expect(
        runRestPush(baseOptions({ content: "a", contentFile: "b" }), {
          env: {},
        }),
      ).rejects.toThrow(/exactly one of --content or --content-file/);
    });

    it("rejects when no content source is given", async () => {
      await expect(
        runRestPush(
          baseOptions({ content: undefined, contentFile: undefined }),
          {
            env: {},
          },
        ),
      ).rejects.toThrow(/Provide file content/);
    });

    it("rejects when no token can be resolved", async () => {
      await expect(
        runRestPush(baseOptions({ token: undefined }), { env: {} }),
      ).rejects.toThrow(/token is required to push/);
    });

    it("rejects an empty message", async () => {
      await expect(
        runRestPush(baseOptions({ message: "" }), { env: {} }),
      ).rejects.toThrow(/--message is required/);
    });

    it("rejects an empty file path", async () => {
      await expect(
        runRestPush(baseOptions({ file: "" }), { env: {} }),
      ).rejects.toThrow(/--file is required/);
    });
  });
});

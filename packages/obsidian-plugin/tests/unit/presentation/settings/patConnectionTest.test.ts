/**
 * Unit tests for the reusable PAT "Test connection" validate logic
 * (`patConnectionTest.ts`).
 *
 * The fakes here mirror the REAL contract of the slice of `GitHubRestClient`
 * the connection test exercises (test-fixture-realism):
 *   - `checkRateLimit()` RESOLVES `{ remaining, resetAt }` for an accepted token
 *     and THROWS (with a redacted message) for a rejected one — exactly how the
 *     real client behaves on HTTP 401 / network failure.
 *   - `listRepos()` RESOLVES a `full_name[]` array, returns `[]` when the token
 *     sees no repos, and THROWS when /user/repos fails.
 *
 * No stub-returning-any: every fake reproduces the resolve/throw branches the
 * production client takes, so the test exercises the orchestration's real paths.
 */
import { describe, it, expect } from "@jest/globals";
import {
  testPatConnection,
  describePatConnection,
  type PatTestClient,
  type PatConnectionResult,
} from "../../../../src/presentation/settings/patConnectionTest";

/** A contract-shaped fake of the GitHubRestClient slice used by the test. */
function fakeClient(
  over: Partial<{
    rate: { remaining: number; resetAt: Date };
    rateError: Error;
    repos: string[];
    reposError: Error;
  }> = {},
): PatTestClient {
  return {
    checkRateLimit: async () => {
      if (over.rateError) throw over.rateError;
      return over.rate ?? { remaining: 4999, resetAt: new Date(0) };
    },
    listRepos: async () => {
      if (over.reposError) throw over.reposError;
      return over.repos ?? [];
    },
  };
}

describe("testPatConnection — orchestration", () => {
  it("returns ok with rate-limit + repo sample when the token is accepted", async () => {
    const client = fakeClient({
      rate: { remaining: 4321, resetAt: new Date("2026-06-20T10:00:00.000Z") },
      repos: ["kitelev/exoas-exo", "kitelev/exoas-my"],
    });
    const result = await testPatConnection("github_pat_valid", () => client);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.remaining).toBe(4321);
    expect(result.resetAt.toISOString()).toBe("2026-06-20T10:00:00.000Z");
    expect(result.repos).toEqual(["kitelev/exoas-exo", "kitelev/exoas-my"]);
    expect(result.reposError).toBeUndefined();
  });

  it("trims the token before constructing the client", async () => {
    const seen: string[] = [];
    await testPatConnection("  github_pat_padded  ", (pat) => {
      seen.push(pat);
      return fakeClient();
    });
    expect(seen).toEqual(["github_pat_padded"]);
  });

  it("returns a failure (not a throw) for an empty / whitespace token", async () => {
    const result = await testPatConnection("   ", () => {
      throw new Error("client must not be constructed for an empty token");
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toMatch(/no token/i);
  });

  it("returns a failure with the redacted reason when the token is rejected (401)", async () => {
    // The real client redacts the PAT and throws on a non-2xx status.
    const client = fakeClient({
      rateError: new Error(
        "GitHub request GET https://api.github.com/rate_limit → HTTP 401: Bad credentials",
      ),
    });
    const result = await testPatConnection("github_pat_revoked", () => client);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toContain("HTTP 401");
  });

  it("maps a synchronous client-construction throw to a failure result (never throws)", async () => {
    const result = await testPatConnection("github_pat_x", () => {
      throw new Error("GitHubRestClient: Obsidian App is required");
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toContain("Obsidian App is required");
  });

  it("stays ok when the token is valid but /user/repos fails (token accepted, repo-list soft-failed)", async () => {
    const client = fakeClient({
      rate: { remaining: 10, resetAt: new Date(0) },
      reposError: new Error("GitHub listRepos: malformed /user/repos response"),
    });
    const result = await testPatConnection("github_pat_valid_no_repo_scope", () => client);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.repos).toEqual([]);
    expect(result.reposError).toContain("malformed /user/repos response");
  });

  it("stays ok with an empty repo list when the token sees no repositories", async () => {
    const client = fakeClient({ rate: { remaining: 5, resetAt: new Date(0) }, repos: [] });
    const result = await testPatConnection("github_pat_zero_repos", () => client);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.repos).toEqual([]);
    expect(result.reposError).toBeUndefined();
  });
});

describe("describePatConnection — message formatting (single source for both surfaces)", () => {
  const okBase: PatConnectionResult = {
    ok: true,
    remaining: 4321,
    resetAt: new Date("2026-06-20T10:00:00.000Z"),
    repos: ["kitelev/exoas-exo", "kitelev/exoas-my"],
  };

  it("formats success with the rate-limit, reset time and a repo sample", () => {
    expect(describePatConnection(okBase)).toBe(
      "GitHub OK — 4321 requests remaining, resets 2026-06-20T10:00:00.000Z; " +
        "sample: kitelev/exoas-exo, kitelev/exoas-my",
    );
  });

  it("notes when no repos are visible to the token", () => {
    expect(describePatConnection({ ...okBase, repos: [] })).toContain(
      "; no repos visible to this PAT",
    );
  });

  it("surfaces a repo-list soft failure on an otherwise-valid token", () => {
    expect(
      describePatConnection({ ...okBase, repos: [], reposError: "boom" }),
    ).toContain("; listRepos failed: boom");
  });

  it("formats a failure with the reason", () => {
    expect(
      describePatConnection({ ok: false, reason: "HTTP 401: Bad credentials" }),
    ).toBe("Test connection failed: HTTP 401: Bad credentials");
  });
});

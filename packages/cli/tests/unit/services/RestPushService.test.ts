/**
 * @jest-environment node
 *
 * Unit tests for RestPushService (CLI REST commit+push, RFC 01a83de8 Phase 0).
 * Uses a mocked `fetch` returning production-shaped GitHub Git Data API
 * responses — NOT stub-any — so the fetch transport adapter is exercised
 * against the real response shapes the core navigates.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { RestPushService } from "../../../src/services/RestPushService";

const BASE_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const TREE_SHA = "0fedcba9876543210fedcba9876543210fedcba9";
const COMMIT_SHA = "9988776655443322110099887766554433221100";
const FAKE_PAT = "ghp_" + "A".repeat(36);

/** Minimal Response-like object satisfying what the transport reads. */
function res(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

function happyFetch(): jest.Mock {
  return jest
    .fn()
    .mockResolvedValueOnce(res(200, { object: { sha: BASE_SHA } }))
    .mockResolvedValueOnce(res(201, { sha: TREE_SHA }))
    .mockResolvedValueOnce(res(201, { sha: COMMIT_SHA }))
    .mockResolvedValueOnce(res(200, { object: { sha: COMMIT_SHA } }));
}

describe("RestPushService", () => {
  describe("push (4-call REST chain over fetch)", () => {
    it("commits + returns the new commit sha", async () => {
      const fetchImpl = happyFetch();
      const svc = new RestPushService({ token: FAKE_PAT, fetchImpl });
      const files = new Map([["docs/a.md", "hello"]]);
      const sha = await svc.push("o", "r", "main", files, "msg");
      expect(sha).toBe(COMMIT_SHA);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it("attaches the Authorization + GitHub headers", async () => {
      const fetchImpl = happyFetch();
      const svc = new RestPushService({ token: FAKE_PAT, fetchImpl });
      await svc.push("o", "r", "main", new Map([["f", "c"]]), "m");
      const [, init] = fetchImpl.mock.calls[0];
      expect(init.headers.Authorization).toBe(`Bearer ${FAKE_PAT}`);
      expect(init.headers.Accept).toBe("application/vnd.github+json");
      expect(init.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
      expect(init.headers["User-Agent"]).toBe("exocortex-cli");
      // GET ref has no body → no Content-Type.
      expect(init.headers["Content-Type"]).toBeUndefined();
      // POST tree DOES set Content-Type.
      const [, treeInit] = fetchImpl.mock.calls[1];
      expect(treeInit.headers["Content-Type"]).toBe("application/json");
      expect(treeInit.method).toBe("POST");
    });

    it("omits Authorization when token is empty (anonymous)", async () => {
      const fetchImpl = happyFetch();
      const svc = new RestPushService({ token: "", fetchImpl });
      await svc.push("o", "r", "main", new Map([["f", "c"]]), "m");
      const [, init] = fetchImpl.mock.calls[0];
      expect(init.headers.Authorization).toBeUndefined();
    });

    it("hits the configured api-base", async () => {
      const fetchImpl = happyFetch();
      const svc = new RestPushService({
        token: FAKE_PAT,
        fetchImpl,
        apiBase: "https://ghe.example.com/api/v3",
      });
      await svc.push("o", "r", "main", new Map([["f", "c"]]), "m");
      const [url] = fetchImpl.mock.calls[0];
      expect(url).toBe(
        "https://ghe.example.com/api/v3/repos/o/r/git/refs/heads/main",
      );
    });
  });

  describe("error handling + redaction", () => {
    it("throws with the HTTP status on a non-2xx response", async () => {
      const fetchImpl = jest.fn().mockResolvedValueOnce(res(404, "Not Found"));
      const svc = new RestPushService({ token: FAKE_PAT, fetchImpl });
      await expect(
        svc.push("o", "r", "main", new Map([["f", "c"]]), "m"),
      ).rejects.toThrow(/HTTP 404/);
    });

    it("redacts a PAT leaked into a non-2xx response body", async () => {
      const leak = `unexpected error mentioning ${FAKE_PAT} in body`;
      const fetchImpl = jest.fn().mockResolvedValueOnce(res(422, leak));
      const svc = new RestPushService({ token: FAKE_PAT, fetchImpl });
      await expect(
        svc.push("o", "r", "main", new Map([["f", "c"]]), "m"),
      ).rejects.toThrow(/\*\*\*REDACTED\*\*\*/);
      await expect(
        svc.push("o", "r", "main", new Map([["f", "c"]]), "m"),
      ).rejects.not.toThrow(new RegExp(FAKE_PAT));
    });

    it("wraps a fetch network error (redacted)", async () => {
      const fetchImpl = jest
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"));
      const svc = new RestPushService({ token: FAKE_PAT, fetchImpl });
      await expect(
        svc.push("o", "r", "main", new Map([["f", "c"]]), "m"),
      ).rejects.toThrow(/GitHub request failed: ECONNRESET/);
    });

    it("redact coerces non-string input", () => {
      const svc = new RestPushService({ token: FAKE_PAT });
      expect(svc.redact({ toString: () => `x ${FAKE_PAT} y` })).toContain(
        "***REDACTED***",
      );
    });
  });

  describe("resolveGhToken", () => {
    it("returns a trimmed token from the runner", () => {
      const token = RestPushService.resolveGhToken(() => `  ${FAKE_PAT}\n`);
      expect(token).toBe(FAKE_PAT);
    });

    it("throws on empty runner output", () => {
      expect(() => RestPushService.resolveGhToken(() => "  \n")).toThrow(
        /not authenticated/,
      );
    });

    it("throws a redacted, actionable error when the runner throws", () => {
      expect(() =>
        RestPushService.resolveGhToken(() => {
          throw new Error(`gh failed (had ${FAKE_PAT})`);
        }),
      ).toThrow(/gh auth token` failed/);
      expect(() =>
        RestPushService.resolveGhToken(() => {
          throw new Error(`gh failed (had ${FAKE_PAT})`);
        }),
      ).not.toThrow(new RegExp(FAKE_PAT));
    });
  });
});

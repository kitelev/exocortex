import { describe, it, expect } from "@jest/globals";
import { createProgram } from "../../../src/program";

/**
 * RFC 7c7859d1 (dogfood homoiconic command surface) — W0 cleanup.
 *
 * W0 removes three dead/superseded commands from the exocortex-cli surface:
 *   - `watch`        — dead code (FileSystemWatcher had no production consumer)
 *   - `daemon`       — whole stack unwired in prod (DaemonClient + ValidatorDaemon)
 *   - `experimental` — `rest-push` PoC superseded by `exosync push`
 *
 * `recover` was originally classified W0 too, but a code-review found a live
 * launchd consumer (`com.exocortex.aitask-recover` hourly job calls
 * `exocortex-cli recover --apply`), so it was reclassified migration-first.
 * Issue #3872 Phase 1 retired that launchd consumer (unloaded + plist/subsystem
 * scripts removed; the subsystem targeted the decommissioned vault-2025). With
 * the last consumer gone, Phase 2 removes the `recover` verb — it is now
 * asserted ABSENT below.
 *
 * This test exercises the REAL command registry (createProgram from
 * src/program.ts), not a dummy tree, so it empirically fails if any of the
 * removed commands is re-registered (Executable Specification — revert-verify).
 */
describe("CLI surface — W0 removed commands (RFC 7c7859d1)", () => {
  function topLevelNames(): string[] {
    // Pass an explicit version so the build-time __CLI_VERSION__ define is
    // not required when running under jest.
    return createProgram("0.0.0-test").commands.map((c) => c.name());
  }

  it("does NOT register the removed 'watch' command", () => {
    expect(topLevelNames()).not.toContain("watch");
  });

  it("does NOT register the removed 'daemon' command", () => {
    expect(topLevelNames()).not.toContain("daemon");
  });

  it("does NOT register the removed 'experimental' command", () => {
    expect(topLevelNames()).not.toContain("experimental");
  });

  // CLI-removals cleanup (post-W0): `workflow` was a dormant read-only
  // introspection command (list/show/validate over vault workflow assets) with
  // zero code/CI/launchd consumers and no active requirement. The workflow
  // FEATURE itself (core WorkflowEngine, plugin-driven) is unaffected — only
  // this CLI surface was removed.
  it("does NOT register the removed 'workflow' command", () => {
    expect(topLevelNames()).not.toContain("workflow");
  });

  // Issue #3872 Phase 2 — `recover` (orphaned-tmux-session recovery over the
  // decommissioned vault-2025) removed after its sole live consumer (the
  // com.exocortex.aitask-recover launchd job) was retired in Phase 1.
  it("does NOT register the removed 'recover' command", () => {
    expect(topLevelNames()).not.toContain("recover");
  });

  // W-req (RFC 7c7859d1) — `requirements` was NOT a cheap-remove: its `audit`
  // subcommand had a LIVE CI consumer (the `requirements-trace` job + the
  // always-on active-requirement gate). Migration-first: the checker was
  // extracted to `packages/req-audit` (repo-internal dev tooling — a CI gate for
  // THIS repo has no business occupying a verb of the published product CLI),
  // and ci.yml + ADR REQ-001 were switched to it BEFORE this removal.
  // Surface: the real registry goes 26 -> 25 top-level commands (measured via
  // `createProgram().commands`). The RFC's "18 -> 17" is its own nominal
  // numbering of the 22 commands it classified, not the live registry count.
  it("does NOT register the removed 'requirements' command", () => {
    expect(topLevelNames()).not.toContain("requirements");
  });

  it("still registers the retained core/platform commands (sanity)", () => {
    const names = topLevelNames();
    for (const kept of [
      "find",
      "apply",
      "query",
      "index",
      "validate",
      "resolve",
      "create",
      "audit",
      "exosync",
    ]) {
      expect(names).toContain(kept);
    }
  });
});

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
 * `exocortex-cli recover --apply`). It is therefore RETAINED here and
 * reclassified migration-first (asserted present in the sanity list below).
 *
 * This test exercises the REAL command registry (createProgram from
 * src/program.ts), not a dummy tree, so it empirically fails if any of the
 * three removed commands is re-registered (Executable Specification — revert-verify).
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
      "recover",
    ]) {
      expect(names).toContain(kept);
    }
  });
});

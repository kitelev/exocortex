/**
 * @jest-environment node
 *
 * Unit tests для migrate-shared-identities-profiles command — focus on the
 * `--profiles-dir` flag (PR #3359 code-reviewer follow-up). Verifies flag
 * parsing + that the custom dir name flows through to the relocate plan.
 */
import { jest, describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { migrateSharedIdentitiesProfilesCommand } from "../../../src/commands/migrate-shared-identities-profiles";
import { FOCUS_PROFILE_CLASS_UID } from "../../../src/services/SharedIdentitiesProfileMigrationService";

const tmpVaults: string[] = [];

function makeVaultWithProfile(): string {
  const vaultPath = mkdtempSync(path.join(os.tmpdir(), "exo-migrate-cmd-"));
  tmpVaults.push(vaultPath);
  const sharedDir = path.join(vaultPath, "assetspaces", "shared-identities");
  mkdirSync(sharedDir, { recursive: true });
  writeFileSync(
    path.join(sharedDir, "ae00f219-f50b-4fc1-b842-9ec1e03fefd6.md"),
    `---
exo__Asset_uid: ae00f219-f50b-4fc1-b842-9ec1e03fefd6
exo__Asset_label: profile-base
exo__Instance_class:
  - "[[${FOCUS_PROFILE_CLASS_UID}]]"
exo__FocusProfile_includes:
  - "[[ontology-exo]]"
---

# profile-base
`,
  );
  return vaultPath;
}

describe("migrateSharedIdentitiesProfilesCommand --profiles-dir flag", () => {
  let stdout: string[];

  beforeEach(() => {
    stdout = [];
    jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    for (const v of tmpVaults) rmSync(v, { recursive: true, force: true });
  });

  describe("command setup", () => {
    it("registers --profiles-dir option with default 'profiles'", () => {
      const cmd = migrateSharedIdentitiesProfilesCommand();
      const opt = cmd.options.find((o: { long?: string }) => o.long === "--profiles-dir");
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe("profiles");
    });
  });

  describe("dry-run plan target", () => {
    it("defaults target to assetspaces/profiles when flag omitted", async () => {
      const vaultPath = makeVaultWithProfile();
      const cmd = migrateSharedIdentitiesProfilesCommand();
      await cmd.parseAsync(["node", "test", "--vault", vaultPath, "--json"]);

      const plan = JSON.parse(stdout.join(""));
      expect(plan.profilesDirPath).toBe(path.join(vaultPath, "assetspaces", "profiles"));
    });

    it("uses custom dir name in relocate plan when --profiles-dir given", async () => {
      const vaultPath = makeVaultWithProfile();
      const cmd = migrateSharedIdentitiesProfilesCommand();
      await cmd.parseAsync([
        "node",
        "test",
        "--vault",
        vaultPath,
        "--profiles-dir",
        "custom-profiles",
        "--json",
      ]);

      const plan = JSON.parse(stdout.join(""));
      const expectedDir = path.join(vaultPath, "assetspaces", "custom-profiles");
      expect(plan.profilesDirPath).toBe(expectedDir);
      const relocate = plan.actions.find(
        (a: { kind: string }) => a.kind === "relocate-and-dual-class",
      );
      expect(relocate.profilesDirPath.startsWith(expectedDir)).toBe(true);
    });
  });

  describe("validation", () => {
    it.each([
      ["path separator", "evil/../escape"],
      ["backslash", "a\\b"],
      ["bare dot-dot", ".."],
      ["single dot", "."],
      ["empty string", ""],
      ["NUL byte", "a\x00b"],
      ["tilde", "~/escape"],
    ])("rejects --profiles-dir with %s", async (_label, value) => {
      const vaultPath = makeVaultWithProfile();
      const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      const cmd = migrateSharedIdentitiesProfilesCommand();
      await cmd.parseAsync(["node", "test", "--vault", vaultPath, "--profiles-dir", value, "--json"]);
      // ErrorHandler.handle → process.exit with non-zero (INVALID_ARGUMENTS=2).
      expect(exitSpy).toHaveBeenCalled();
      const codes = exitSpy.mock.calls.map((c) => c[0]);
      expect(codes.some((c) => c !== 0)).toBe(true);
    });

    it("accepts a dotted folder name (e.g. profiles.v2)", async () => {
      const vaultPath = makeVaultWithProfile();
      const cmd = migrateSharedIdentitiesProfilesCommand();
      await cmd.parseAsync([
        "node",
        "test",
        "--vault",
        vaultPath,
        "--profiles-dir",
        "profiles.v2",
        "--json",
      ]);
      const plan = JSON.parse(stdout.join(""));
      expect(plan.profilesDirPath).toBe(path.join(vaultPath, "assetspaces", "profiles.v2"));
    });
  });
});

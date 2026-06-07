/**
 * Integration tests for `exocortex hard-switch <profile-uid>` — the REAL
 * mount-state switch (Issue #3416, UI↔CLI parity).
 *
 * Uses a real on-disk fixture vault (matches `CliFocusProfileResolver`
 * unit-test style) + the pure-logic seam `runHardSwitch` (returns a
 * `HardSwitchResult` rather than calling `process.exit`). Tear-down scenarios
 * need NO network (unmount is pure `fs`); the materialise scenario injects a
 * fake mount (`pullAssetSpace` stubbed) so no GitHub tarball is fetched.
 *
 * Fixture layout invariant: each AssetSpace descriptor lives in its OWN parent
 * folder so the resolver's folder-map (keyed by descriptor parent folder)
 * captures every UID. Floor descriptors live inside their (always-materialised)
 * mount folder; the content (`testlib`) descriptor lives in a separate registry
 * folder so it survives a tear-down of the testlib mount folder.
 *
 * Revert-verify: the `[revert-verify] tear-down` scenario FAILS against the
 * pre-fix scaffold (which performed zero filesystem ops — the testlib folder
 * + `.gitmodules` entry would survive) and PASSES post-fix. Empirically
 * verified by stubbing `CliHardSwitchService.execute` to a no-op (mirrors the
 * scaffold): the assertion `existsSync(testlibMount) === false` fails.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

import type { HardSwitchPlan, IConfirmGate } from "exocortex";
import { runHardSwitch, hardSwitchCommand } from "../../../src/commands/hard-switch.js";
import {
  ASSET_SPACE_CLASS_UID,
  FOCUS_PROFILE_CLASS_UID,
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../../src/services/CliFocusProfileResolver.js";
import { CliHardSwitchService } from "../../../src/services/CliHardSwitchService.js";
import { BootstrapAssetSpaceService } from "../../../src/services/BootstrapAssetSpaceService.js";
import { InvalidArgumentsError, VaultNotFoundError } from "../../../src/utils/errors/index.js";
import { ExitCodes } from "../../../src/utils/ExitCodes.js";

const TESTLIB_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROFILE_MINIMAL = "11111111-1111-1111-1111-111111111111"; // floor only
const PROFILE_FULL = "22222222-2222-2222-2222-222222222222"; // floor + testlib
const PROFILE_MISSING_FLOOR = "33333333-3333-3333-3333-333333333333"; // omits exocmd floor
const MISSING_UID = "99999999-9999-9999-9999-999999999999";

// AssetSpace _source URLs whose `derivePath(_source)` == the mount folder.
const SRC_EXO = "https://github.com/kitelev/exoas-exo";
const SRC_EXOCMD = "https://github.com/kitelev/exoas-exocmd";
const SRC_SHARED = "https://github.com/kitelev/exoas-shared-identities";
const SRC_TESTLIB = "https://github.com/kitelev/exoas-testlib";

const MOUNT_EXO = "assetspaces/kitelev/exoas-exo";
const MOUNT_EXOCMD = "assetspaces/kitelev/exoas-exocmd";
const MOUNT_SHARED = "assetspaces/kitelev/exoas-shared-identities";
const MOUNT_TESTLIB = "assetspaces/kitelev/exoas-testlib";

interface AssetSpec {
  relPath: string;
  frontmatter: Record<string, unknown>;
}

async function writeAssets(root: string, assets: AssetSpec[]): Promise<void> {
  for (const a of assets) {
    const full = path.join(root, a.relPath);
    await fs.ensureDir(path.dirname(full));
    const lines = Object.entries(a.frontmatter).map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map((x) => `  - "${String(x)}"`).join("\n")}`;
      }
      if (typeof v === "string") return `${k}: "${v}"`;
      return `${k}: ${v}`;
    });
    await fs.writeFile(full, `---\n${lines.join("\n")}\n---\n`, "utf-8");
  }
}

function asDescriptor(uid: string, source: string): Record<string, unknown> {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: `AS ${uid.slice(0, 8)}`,
    exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
    exo__AssetSpace_source: source,
  };
}

function profile(
  uid: string,
  label: string,
  includes: string[],
): Record<string, unknown> {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: [`[[${FOCUS_PROFILE_CLASS_UID}|exo__FocusProfile]]`],
    exo__Profile_includes: includes.map((u) => `[[${u}]]`),
  };
}

/**
 * Build the fixture vault.
 *
 * @param testlibMaterialised whether `assetspaces/kitelev/exoas-testlib/` exists
 *   on disk (the content AssetSpace is "active"). Floor mount folders are always
 *   materialised (descriptors live inside them).
 */
async function makeFixtureVault(
  root: string,
  testlibMaterialised: boolean,
): Promise<void> {
  await fs.ensureDir(root);
  // Floor descriptors live INSIDE their (always-present) mount folders.
  await writeAssets(root, [
    {
      relPath: `${MOUNT_EXO}/${TS_FLOOR_AS_UID_EXO}.md`,
      frontmatter: asDescriptor(TS_FLOOR_AS_UID_EXO, SRC_EXO),
    },
    {
      relPath: `${MOUNT_EXOCMD}/${TS_FLOOR_AS_UID_EXOCMD}.md`,
      frontmatter: asDescriptor(TS_FLOOR_AS_UID_EXOCMD, SRC_EXOCMD),
    },
    {
      relPath: `${MOUNT_SHARED}/${TS_FLOOR_AS_UID_SHARED_IDENTITIES}.md`,
      frontmatter: asDescriptor(TS_FLOOR_AS_UID_SHARED_IDENTITIES, SRC_SHARED),
    },
    // testlib descriptor lives in a SEPARATE registry folder so it survives a
    // tear-down of the testlib mount folder (needed for switch-back/materialise).
    {
      relPath: `assetspaces/_registry/${TESTLIB_UID}.md`,
      frontmatter: asDescriptor(TESTLIB_UID, SRC_TESTLIB),
    },
    // Profiles.
    {
      relPath: `profiles/${PROFILE_MINIMAL}.md`,
      frontmatter: profile(PROFILE_MINIMAL, "Minimal (floor only)", [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ]),
    },
    {
      relPath: `profiles/${PROFILE_FULL}.md`,
      frontmatter: profile(PROFILE_FULL, "Full (floor + testlib)", [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        TESTLIB_UID,
      ]),
    },
    {
      relPath: `profiles/${PROFILE_MISSING_FLOOR}.md`,
      frontmatter: profile(PROFILE_MISSING_FLOOR, "Missing floor (no exocmd)", [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        TESTLIB_UID,
      ]),
    },
  ]);

  if (testlibMaterialised) {
    const f = path.join(root, MOUNT_TESTLIB, "note.md");
    await fs.ensureDir(path.dirname(f));
    await fs.writeFile(f, "---\nexo__Asset_uid: cccccccc-0000-0000-0000-000000000000\n---\n");
  }

  // .gitmodules registry — entries for every currently-materialised mount.
  const entries = [
    [MOUNT_EXO, SRC_EXO],
    [MOUNT_EXOCMD, SRC_EXOCMD],
    [MOUNT_SHARED, SRC_SHARED],
  ];
  if (testlibMaterialised) entries.push([MOUNT_TESTLIB, SRC_TESTLIB]);
  const gm = entries
    .map(([p, u]) => `[submodule "${p}"]\n\tpath = ${p}\n\turl = ${u}\n`)
    .join("");
  await fs.writeFile(path.join(root, ".gitmodules"), gm, "utf-8");
}

const approvingGate: IConfirmGate = { confirmHardSwitch: async () => true };

describe("CLI — hard-switch real mount-state switch (Issue #3416)", () => {
  let vaultRoot: string;

  afterEach(async () => {
    if (vaultRoot) await fs.remove(vaultRoot);
  });

  async function setup(testlibMaterialised: boolean): Promise<void> {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "exocortex-cli-hardswitch-"));
    await makeFixtureVault(vaultRoot, testlibMaterialised);
  }

  it("[revert-verify] tear-down: switching to a narrower profile removes the AS folder + strips .gitmodules", async () => {
    await setup(/* testlibMaterialised */ true);
    const testlibMount = path.join(vaultRoot, MOUNT_TESTLIB);
    expect(existsSync(testlibMount)).toBe(true); // precondition

    const result = await runHardSwitch(
      PROFILE_MINIMAL,
      { vault: vaultRoot, yes: true, verbose: false },
      { confirmGate: approvingGate, out: () => {}, err: () => {} },
    );

    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    // Real mutation: testlib torn down.
    expect(existsSync(testlibMount)).toBe(false);
    // Floor mounts untouched.
    expect(existsSync(path.join(vaultRoot, MOUNT_EXO))).toBe(true);
    expect(existsSync(path.join(vaultRoot, MOUNT_EXOCMD))).toBe(true);
    expect(existsSync(path.join(vaultRoot, MOUNT_SHARED))).toBe(true);
    // .gitmodules: testlib stanza stripped, floor stanzas preserved.
    const gm = readFileSync(path.join(vaultRoot, ".gitmodules"), "utf-8");
    expect(gm).not.toContain(`"${MOUNT_TESTLIB}"`);
    expect(gm).toContain(`"${MOUNT_EXO}"`);
    expect(gm).toContain(`"${MOUNT_EXOCMD}"`);
    // testlib descriptor (in registry) survives for switch-back.
    expect(existsSync(path.join(vaultRoot, "assetspaces/_registry", `${TESTLIB_UID}.md`))).toBe(true);
  });

  it("[revert-verify proof] a no-op execute (scaffold-equivalent) leaves the folder in place", async () => {
    await setup(true);
    const testlibMount = path.join(vaultRoot, MOUNT_TESTLIB);
    const noopFactory = (
      _opts: unknown,
      vp: string,
    ): CliHardSwitchService => {
      const svc = new CliHardSwitchService({ vaultPath: vp });
      // Simulate the pre-fix scaffold: build a real plan but execute nothing.
      jest
        .spyOn(svc, "execute")
        .mockResolvedValue({ destroyed: [], materialized: [] });
      return svc;
    };
    const result = await runHardSwitch(
      PROFILE_MINIMAL,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hardSwitchServiceFactory: noopFactory as any,
        out: () => {},
        err: () => {},
      },
    );
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    // Pre-fix behaviour: folder NOT removed (proves the real execute is doing the work).
    expect(existsSync(testlibMount)).toBe(true);
  });

  it("materialise: switching to a wider profile pulls the AS via (faked) tarball + adds .gitmodules", async () => {
    await setup(/* testlibMaterialised */ false);
    const testlibMount = path.join(vaultRoot, MOUNT_TESTLIB);
    expect(existsSync(testlibMount)).toBe(false); // precondition

    // Fake mount: stub `pullAssetSpace` (the only network op) to materialise a
    // folder locally; unmount + ensureGitmodulesEntry stay real (pure fs).
    const realMount = new BootstrapAssetSpaceService();
    const pullSpy = jest
      .spyOn(realMount, "pullAssetSpace")
      .mockImplementation(async (_url, _ref, targetDir) => {
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(path.join(targetDir, "pulled.md"), "---\n---\n");
        return { sha: "deadbeef", fileCount: 1 };
      });

    const factory = (_opts: unknown, vp: string): CliHardSwitchService =>
      new CliHardSwitchService({ vaultPath: vp, mount: realMount });

    const result = await runHardSwitch(
      PROFILE_FULL,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hardSwitchServiceFactory: factory as any,
        out: () => {},
        err: () => {},
      },
    );

    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(pullSpy).toHaveBeenCalledTimes(1);
    // pulled into the derived mount folder (HTTPS-normalised URL).
    expect(pullSpy.mock.calls[0][0]).toBe(SRC_TESTLIB);
    expect(existsSync(testlibMount)).toBe(true);
    const gm = readFileSync(path.join(vaultRoot, ".gitmodules"), "utf-8");
    expect(gm).toContain(`"${MOUNT_TESTLIB}"`);
  });

  it("idempotent no-op: switching to a profile already in mount-state mutates nothing", async () => {
    await setup(/* testlibMaterialised */ true);
    const result = await runHardSwitch(
      PROFILE_FULL, // floor + testlib == current disk state
      { vault: vaultRoot, yes: true, verbose: false },
      { confirmGate: approvingGate, out: () => {}, err: () => {} },
    );
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(result.stdout.join("\n")).toContain("no-op");
    // All mounts still present, .gitmodules unchanged.
    expect(existsSync(path.join(vaultRoot, MOUNT_TESTLIB))).toBe(true);
    const gm = readFileSync(path.join(vaultRoot, ".gitmodules"), "utf-8");
    expect(gm).toContain(`"${MOUNT_TESTLIB}"`);
  });

  it("R24 TS-floor guard: excluding a floor AS refuses with OPERATION_FAILED + no mutation", async () => {
    await setup(/* testlibMaterialised */ true);
    const testlibMount = path.join(vaultRoot, MOUNT_TESTLIB);
    const result = await runHardSwitch(
      PROFILE_MISSING_FLOOR, // omits exocmd floor
      { vault: vaultRoot, yes: true, verbose: false },
      { confirmGate: approvingGate, out: () => {}, err: () => {} },
    );
    expect(result.exitCode).toBe(ExitCodes.OPERATION_FAILED);
    expect(result.stderr.join("\n")).toContain("TS-floor");
    // No mutation occurred (refused before execute).
    expect(existsSync(testlibMount)).toBe(true);
    expect(existsSync(path.join(vaultRoot, MOUNT_EXOCMD))).toBe(true);
  });

  it("refuse without --yes: gate declines, exit 0, no mutation", async () => {
    await setup(/* testlibMaterialised */ true);
    const testlibMount = path.join(vaultRoot, MOUNT_TESTLIB);
    const result = await runHardSwitch(
      PROFILE_MINIMAL,
      { vault: vaultRoot, yes: false, verbose: false },
      { out: () => {}, err: () => {} }, // real HeadlessConfirmGate (refuses)
    );
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(existsSync(testlibMount)).toBe(true); // not torn down
  });

  it("--verbose surfaces the real plan to the gate (tear-down count visible)", async () => {
    await setup(/* testlibMaterialised */ true);
    const seen: { plan?: HardSwitchPlan } = {};
    const recordingGate: IConfirmGate = {
      confirmHardSwitch: async (plan) => {
        seen.plan = plan;
        return false; // decline so nothing mutates
      },
    };
    await runHardSwitch(
      PROFILE_MINIMAL,
      { vault: vaultRoot, yes: false, verbose: true },
      { confirmGate: recordingGate, out: () => {}, err: () => {} },
    );
    expect(seen.plan?.targetProfileUid).toBe(PROFILE_MINIMAL);
    expect(seen.plan?.targetProfileLabel).toBe("Minimal (floor only)");
    expect(seen.plan?.assetSpacesBeingTornDown.map((t) => t.asUid)).toContain(
      TESTLIB_UID,
    );
  });

  it("--vault <invalid-path> → throws VaultNotFoundError", async () => {
    await setup(true);
    await expect(
      runHardSwitch(
        PROFILE_MINIMAL,
        { vault: "/does/not/exist-xyz-123", yes: true, verbose: false },
        { confirmGate: approvingGate, out: () => {}, err: () => {} },
      ),
    ).rejects.toBeInstanceOf(VaultNotFoundError);
  });

  it("unknown profile UID → throws InvalidArgumentsError", async () => {
    await setup(true);
    await expect(
      runHardSwitch(
        MISSING_UID,
        { vault: vaultRoot, yes: true, verbose: false },
        { confirmGate: approvingGate, out: () => {}, err: () => {} },
      ),
    ).rejects.toBeInstanceOf(InvalidArgumentsError);
  });

  it("degraded resolver outcome refuses with OPERATION_FAILED", async () => {
    await setup(true);
    const fakeResolver = {
      resolveFilter: async () => ({
        outcome: "degraded" as const,
        reason: "synthetic — no AS-folder overlap",
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = await runHardSwitch(
      PROFILE_MINIMAL,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        resolverFactory: () => fakeResolver,
        out: () => {},
        err: () => {},
      },
    );
    expect(result.exitCode).toBe(ExitCodes.OPERATION_FAILED);
    expect(result.stderr.join("\n")).toContain("degraded");
  });

  it("command surface registers --vault/--yes/--verbose/--ref/--token flags", () => {
    const cmd = hardSwitchCommand();
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--vault");
    expect(optionNames).toContain("--yes");
    expect(optionNames).toContain("--verbose");
    expect(optionNames).toContain("--ref");
    expect(optionNames).toContain("--token");
    expect(cmd.description()).toContain("Hard switch");
  });
});

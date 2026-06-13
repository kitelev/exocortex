/**
 * Integration tests for `exocortex apply-profile <profile-uid>` — the REAL
 * mount-state switch (Issue #3416, UI↔CLI parity).
 *
 * Uses a real on-disk fixture vault (matches `CliProfileResolver`
 * unit-test style) + the pure-logic seam `runApplyProfile` (returns a
 * `ApplyProfileResult` rather than calling `process.exit`). Tear-down scenarios
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
 * verified by stubbing `CliApplyProfileService.execute` to a no-op (mirrors the
 * scaffold): the assertion `existsSync(testlibMount) === false` fails.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

import type { ApplyPlan, IConfirmGate } from "exocortex";
import { runApplyProfile, applyProfileCommand } from "../../../src/commands/apply-profile.js";
import {
  ASSET_SPACE_CLASS_UID,
  PROFILE_CLASS_UID,
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../../src/services/CliProfileResolver.js";
import { CliApplyProfileService } from "../../../src/services/CliApplyProfileService.js";
import { BootstrapAssetSpaceService } from "../../../src/services/BootstrapAssetSpaceService.js";
import { InvalidArgumentsError, VaultNotFoundError } from "../../../src/utils/errors/index.js";
import { ExitCodes } from "../../../src/utils/ExitCodes.js";

const TESTLIB_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROFILE_MINIMAL = "11111111-1111-1111-1111-111111111111"; // SDK floor + exocmd
const PROFILE_FULL = "22222222-2222-2222-2222-222222222222"; // floor + testlib
// Omits $exo (the only SDK-floor AS under floor={exo}) — R24 must refuse.
const PROFILE_MISSING_FLOOR = "33333333-3333-3333-3333-333333333333";
// Omits exocmd (declares $exo) — must NOT refuse: exocmd is optional, not floor.
const PROFILE_NO_EXOCMD = "66666666-6666-6666-6666-666666666666";
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
    exo__Instance_class: [`[[${PROFILE_CLASS_UID}|exo__Profile]]`],
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
      // Omits $exo (the only SDK-floor AS under floor={exo}) → R24 must refuse.
      frontmatter: profile(PROFILE_MISSING_FLOOR, "Missing floor (no exo)", [
        TESTLIB_UID,
      ]),
    },
    {
      relPath: `profiles/${PROFILE_NO_EXOCMD}.md`,
      // Declares the full SDK floor but omits exocmd → must be ACCEPTED (#3426).
      frontmatter: profile(PROFILE_NO_EXOCMD, "SDK floor (no exocmd)", [
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

const approvingGate: IConfirmGate = { confirmApply: async () => true };

describe("CLI — apply-profile real mount-state switch (Issue #3416)", () => {
  let vaultRoot: string;

  afterEach(async () => {
    if (vaultRoot) await fs.remove(vaultRoot);
  });

  async function setup(testlibMaterialised: boolean): Promise<void> {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "exocortex-cli-apply-"));
    await makeFixtureVault(vaultRoot, testlibMaterialised);
  }

  it("[revert-verify] tear-down: switching to a narrower profile removes the AS folder + strips .gitmodules", async () => {
    await setup(/* testlibMaterialised */ true);
    const testlibMount = path.join(vaultRoot, MOUNT_TESTLIB);
    expect(existsSync(testlibMount)).toBe(true); // precondition

    const result = await runApplyProfile(
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
    ): CliApplyProfileService => {
      const svc = new CliApplyProfileService({ vaultPath: vp });
      // Simulate the pre-fix scaffold: build a real plan but execute nothing.
      jest
        .spyOn(svc, "execute")
        .mockResolvedValue({ destroyed: [], materialized: [] });
      return svc;
    };
    const result = await runApplyProfile(
      PROFILE_MINIMAL,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        applyServiceFactory: noopFactory as any,
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

    const factory = (_opts: unknown, vp: string): CliApplyProfileService =>
      new CliApplyProfileService({ vaultPath: vp, mount: realMount });

    const result = await runApplyProfile(
      PROFILE_FULL,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        applyServiceFactory: factory as any,
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
    const result = await runApplyProfile(
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

  it("R24 TS-floor guard: excluding $exo (the SDK floor) refuses with OPERATION_FAILED + no mutation", async () => {
    await setup(/* testlibMaterialised */ true);
    const testlibMount = path.join(vaultRoot, MOUNT_TESTLIB);
    const result = await runApplyProfile(
      PROFILE_MISSING_FLOOR, // omits $exo (the only SDK-floor AS, floor={exo})
      { vault: vaultRoot, yes: true, verbose: false },
      { confirmGate: approvingGate, out: () => {}, err: () => {} },
    );
    expect(result.exitCode).toBe(ExitCodes.OPERATION_FAILED);
    expect(result.stderr.join("\n")).toContain("TS-floor");
    // No mutation occurred (refused before execute).
    expect(existsSync(testlibMount)).toBe(true);
    expect(existsSync(path.join(vaultRoot, MOUNT_EXO))).toBe(true);
  });

  it("[#3426] CLI accepts a profile that omits exocmd — no R24 refusal (exocmd is NOT the SDK floor)", async () => {
    await setup(/* testlibMaterialised */ true);
    const result = await runApplyProfile(
      PROFILE_NO_EXOCMD, // declares the full SDK floor, omits exocmd
      { vault: vaultRoot, yes: true, verbose: false },
      { confirmGate: approvingGate, out: () => {}, err: () => {} },
    );
    // Pre-#3426 this refused with OPERATION_FAILED + "TS-floor". Now accepted.
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(result.stderr.join("\n")).not.toContain("TS-floor");
    // SDK-floor mounts remain; exocmd (no longer floor-protected, not declared)
    // is treated as an ordinary AssetSpace and torn down.
    expect(existsSync(path.join(vaultRoot, MOUNT_EXO))).toBe(true);
    expect(existsSync(path.join(vaultRoot, MOUNT_SHARED))).toBe(true);
    expect(existsSync(path.join(vaultRoot, MOUNT_EXOCMD))).toBe(false);
  });

  it("refuse without --yes: gate declines, exit 0, no mutation", async () => {
    await setup(/* testlibMaterialised */ true);
    const testlibMount = path.join(vaultRoot, MOUNT_TESTLIB);
    const result = await runApplyProfile(
      PROFILE_MINIMAL,
      { vault: vaultRoot, yes: false, verbose: false },
      { out: () => {}, err: () => {} }, // real HeadlessConfirmGate (refuses)
    );
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(existsSync(testlibMount)).toBe(true); // not torn down
  });

  it("--verbose surfaces the real plan to the gate (tear-down count visible)", async () => {
    await setup(/* testlibMaterialised */ true);
    const seen: { plan?: ApplyPlan } = {};
    const recordingGate: IConfirmGate = {
      confirmApply: async (plan) => {
        seen.plan = plan;
        return false; // decline so nothing mutates
      },
    };
    await runApplyProfile(
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
      runApplyProfile(
        PROFILE_MINIMAL,
        { vault: "/does/not/exist-xyz-123", yes: true, verbose: false },
        { confirmGate: approvingGate, out: () => {}, err: () => {} },
      ),
    ).rejects.toBeInstanceOf(VaultNotFoundError);
  });

  it("unknown profile UID → throws InvalidArgumentsError", async () => {
    await setup(true);
    await expect(
      runApplyProfile(
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
    const result = await runApplyProfile(
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
    const cmd = applyProfileCommand();
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--vault");
    expect(optionNames).toContain("--yes");
    expect(optionNames).toContain("--verbose");
    expect(optionNames).toContain("--ref");
    expect(optionNames).toContain("--token");
    expect(cmd.description()).toContain("Apply");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Issue #3511 — central-registry profile resolution (EKA Alpha 16-repo schema)
//
// Reproduces the shipped-engine failure: a vault whose AssetSpace descriptors
// ALL live in one central registry repo (kitelev/exoas-registry) — NOT
// self-describing co-located. The profile declares only a LEAF AssetSpace
// (exoas-exodev); the full effective set comes from the registry's
// `exo__AssetSpace_dependsOn` DAG. The TS-floor ($exo) descriptor's UID is the
// EKA registry UID (≠ the legacy hardcoded floor UID) and is reached
// transitively via dependsOn.
//
// Pre-fix (origin/main): the resolver keyed folderMap by descriptor parent
// folder → all 18 registry descriptors collapse to one key → "zero AssetSpace
// folder overlap → degraded" → apply REFUSED. These tests assert SUCCESS, so
// they FAIL on origin/main and PASS post-fix (revert-verify discipline).
// ───────────────────────────────────────────────────────────────────────────
describe("CLI — central-registry profile resolution (Issue #3511)", () => {
  // Leaf AssetSpace declared by the profile; the rest come via dependsOn.
  const AS_EXODEV = "766b36db-bfa2-460c-8b24-b71646b46788";
  const AS_SHARED_PRIVATE = "0857de05-7158-4988-a6e3-9fb47a267649";
  const AS_PUBLIC = "f80bb130-7d05-4399-8407-467be8bfbfc9";
  // EKA registry $exo descriptor — a DIFFERENT UID than the legacy floor
  // (TS_FLOOR_AS_UID_EXO), but namespace "exo" → satisfies the floor.
  const AS_EXO_EKA = "e5c47526-e72f-42e3-8535-3d243dd2db94";
  const AS_W3C = "01ef516e-c697-4988-b86c-472574e13cdc";
  const AS_REGISTRY = "effff928-67e9-44b7-927f-2cf7e222200a";
  const AS_PROFILES = "9edefb13-abd8-44ee-a478-754c035c8bc1";
  const PROFILE_EXODEV = "62338881-a9ff-4b46-b56c-538a1deb2185";

  const SRC = {
    exo: "https://github.com/kitelev/exoas-exo",
    w3c: "https://github.com/kitelev/exoas-w3c-aggregated",
    public: "https://github.com/kitelev/exoas-public",
    sharedPrivate: "https://github.com/kitelev/exoas-shared-private",
    exodev: "https://github.com/kitelev/exoas-exodev",
    registry: "https://github.com/kitelev/exoas-registry",
    profiles: "https://github.com/kitelev/exoas-profiles",
  };
  const MOUNT = {
    exo: "assetspaces/kitelev/exoas-exo",
    exodev: "assetspaces/kitelev/exoas-exodev",
    sharedPrivate: "assetspaces/kitelev/exoas-shared-private",
    public: "assetspaces/kitelev/exoas-public",
    w3c: "assetspaces/kitelev/exoas-w3c-aggregated",
    registry: "assetspaces/kitelev/exoas-registry",
    profiles: "assetspaces/kitelev/exoas-profiles",
  };
  // The registry repo mounts at MOUNT.registry; its descriptors live under a
  // `registry/` namespace subfolder (co-location invariant). ALL descriptors —
  // for exo, exodev, etc — physically live HERE, not in their own repos.
  const REGISTRY_DIR = `${MOUNT.registry}/registry`;

  /** Registry descriptor with source + namespace + optional dependsOn. */
  function regDescriptor(
    uid: string,
    source: string,
    namespace: string,
    dependsOn: string[] = [],
  ): AssetSpec {
    const fm: Record<string, unknown> = {
      exo__Asset_uid: uid,
      exo__Asset_label: `kitelev/${namespace}`,
      exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
      exo__AssetSpace_source: source,
      exo__AssetSpace_namespace: namespace,
    };
    if (dependsOn.length > 0) {
      fm["exo__AssetSpace_dependsOn"] = dependsOn.map((u) => `[[${u}]]`);
    }
    return { relPath: `${REGISTRY_DIR}/${uid}.md`, frontmatter: fm };
  }

  let vaultRoot: string;

  afterEach(async () => {
    if (vaultRoot) await fs.remove(vaultRoot);
  });

  async function makeRegistryVault(): Promise<void> {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "exocortex-cli-reg-"));
    await fs.ensureDir(vaultRoot);

    // 18-descriptor-style central registry (trimmed to the relevant DAG).
    await writeAssets(vaultRoot, [
      regDescriptor(AS_EXO_EKA, SRC.exo, "exo", [AS_W3C]),
      regDescriptor(AS_W3C, SRC.w3c, "w3c-aggregated"),
      regDescriptor(AS_PUBLIC, SRC.public, "public", [AS_EXO_EKA]),
      regDescriptor(AS_SHARED_PRIVATE, SRC.sharedPrivate, "shared-private", [AS_PUBLIC]),
      regDescriptor(AS_EXODEV, SRC.exodev, "exodev", [AS_SHARED_PRIVATE]),
      regDescriptor(AS_REGISTRY, SRC.registry, "registry", [AS_EXO_EKA]),
      regDescriptor(AS_PROFILES, SRC.profiles, "profiles", [AS_REGISTRY, AS_EXO_EKA]),
      // Profile lives in the profiles repo; declares only the LEAF AssetSpace.
      {
        relPath: `${MOUNT.profiles}/profiles/${PROFILE_EXODEV}.md`,
        frontmatter: {
          exo__Asset_uid: PROFILE_EXODEV,
          exo__Asset_label: "$$kitelev-exodev",
          exo__Instance_class: [`[[${PROFILE_CLASS_UID}|exo__Profile]]`],
          exo__Profile_includes: [`[[${AS_EXODEV}]]`],
        },
      },
    ]);

    // Currently-mounted: exo + registry + profiles (post bootstrap + 2×add).
    // The dependency repos (exodev/shared-private/public/w3c) are NOT mounted.
    for (const m of [MOUNT.exo, MOUNT.registry, MOUNT.profiles]) {
      await fs.ensureDir(path.join(vaultRoot, m));
      await fs.writeFile(
        path.join(vaultRoot, m, ".mounted"),
        "placeholder so the folder exists on disk\n",
      );
    }
    const gm = [
      [MOUNT.exo, SRC.exo],
      [MOUNT.registry, SRC.registry],
      [MOUNT.profiles, SRC.profiles],
    ]
      .map(([p, u]) => `[submodule "${p}"]\n\tpath = ${p}\n\turl = ${u}\n`)
      .join("");
    await fs.writeFile(path.join(vaultRoot, ".gitmodules"), gm, "utf-8");
  }

  it("resolves the profile WITHOUT degraded/refuse and materialises the transitive dependsOn closure", async () => {
    await makeRegistryVault();

    // Fake mount: stub the only network op so no GitHub tarball is fetched.
    const realMount = new BootstrapAssetSpaceService();
    const pullSpy = jest
      .spyOn(realMount, "pullAssetSpace")
      .mockImplementation(async (_url, _ref, targetDir) => {
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(path.join(targetDir, "pulled.md"), "---\n---\n");
        return { sha: "deadbeef", fileCount: 1 };
      });
    const factory = (_opts: unknown, vp: string): CliApplyProfileService =>
      new CliApplyProfileService({ vaultPath: vp, mount: realMount });

    const stderr: string[] = [];
    const result = await runApplyProfile(
      PROFILE_EXODEV,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        applyServiceFactory: factory as any,
        out: () => {},
        err: (m) => stderr.push(m),
      },
    );

    // PRE-FIX (origin/main): resolver returns `degraded` → OPERATION_FAILED.
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(stderr.join("\n")).not.toContain("degraded");
    expect(stderr.join("\n")).not.toContain("TS-floor");

    // The 4 unmounted transitive deps are cloned on-demand; $exo is already
    // mounted, so it is NOT re-pulled.
    const pulledUrls = pullSpy.mock.calls.map((c) => c[0]).sort();
    expect(pulledUrls).toEqual(
      [SRC.exodev, SRC.public, SRC.sharedPrivate, SRC.w3c].sort(),
    );
    // exoas-exo stays mounted (floor protected, reached via dependsOn).
    expect(existsSync(path.join(vaultRoot, MOUNT.exo))).toBe(true);
    // exoas-exodev (the declared leaf) is now materialised.
    expect(existsSync(path.join(vaultRoot, MOUNT.exodev))).toBe(true);
    // CATALOG-KEEP (issue #3511): the registry + profiles repos that hold the
    // descriptors/profiles MUST survive — tearing them down would `rm` the
    // source of truth for any future profile switch (one-level self-brick).
    expect(existsSync(path.join(vaultRoot, MOUNT.registry))).toBe(true);
    expect(existsSync(path.join(vaultRoot, MOUNT.profiles))).toBe(true);
  });

  it("resolver returns `engaged` (not `degraded`) with the full dependsOn closure as declaredOntologies", async () => {
    await makeRegistryVault();
    const { CliProfileResolver } = await import(
      "../../../src/services/CliProfileResolver.js"
    );
    const resolver = new CliProfileResolver({ vaultPath: vaultRoot });
    const outcome = await resolver.resolveFilter(PROFILE_EXODEV);
    expect(outcome.outcome).toBe("engaged");
    if (outcome.outcome !== "engaged") return; // narrow
    const declared = outcome.result.declaredOntologies;
    // Closure: leaf exodev → shared-private → public → exo → w3c.
    expect(declared.has(AS_EXODEV)).toBe(true);
    expect(declared.has(AS_SHARED_PRIVATE)).toBe(true);
    expect(declared.has(AS_PUBLIC)).toBe(true);
    expect(declared.has(AS_EXO_EKA)).toBe(true);
    expect(declared.has(AS_W3C)).toBe(true);
  });
});

/**
 * Integration tests for `exocortex hard-switch <profile-uid>`
 * (RFC 22b50a17 Phase 1b).
 *
 * Uses a real on-disk fixture vault (matches `CliFocusProfileResolver`
 * unit-test style) + a real `commander` program. `runHardSwitch` is the
 * pure-logic seam (returns `HardSwitchResult` rather than calling
 * `process.exit` directly), so tests can inject a fake `IConfirmGate`
 * and assert on outcomes without subprocess overhead.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

import type { HardSwitchPlan, IConfirmGate } from "exocortex";
import {
  runHardSwitch,
  hardSwitchCommand,
  HARD_SWITCH_PHASE3_PENDING_NOTICE,
} from "../../../src/commands/hard-switch.js";
import {
  ASSET_SPACE_CLASS_UID,
  FOCUS_PROFILE_CLASS_UID,
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../../src/services/CliFocusProfileResolver.js";
import { InvalidArgumentsError, VaultNotFoundError } from "../../../src/utils/errors/index.js";
import { ExitCodes } from "../../../src/utils/ExitCodes.js";

const PROFILE_UID = "11111111-1111-1111-1111-111111111111";
const MISSING_UID = "99999999-9999-9999-9999-999999999999";

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

async function makeFixtureVault(root: string): Promise<void> {
  await fs.ensureDir(root);
  await writeAssets(root, [
    {
      relPath: `assetspaces/exo/${TS_FLOOR_AS_UID_EXO}.md`,
      frontmatter: {
        exo__Asset_uid: TS_FLOOR_AS_UID_EXO,
        exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
      },
    },
    {
      relPath: `assetspaces/exocmd/${TS_FLOOR_AS_UID_EXOCMD}.md`,
      frontmatter: {
        exo__Asset_uid: TS_FLOOR_AS_UID_EXOCMD,
        exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
      },
    },
    {
      relPath: `assetspaces/shared-identities/${TS_FLOOR_AS_UID_SHARED_IDENTITIES}.md`,
      frontmatter: {
        exo__Asset_uid: TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
      },
    },
    {
      relPath: `profiles/${PROFILE_UID}.md`,
      frontmatter: {
        exo__Asset_uid: PROFILE_UID,
        exo__Asset_label: "Work",
        exo__Instance_class: [
          `[[${FOCUS_PROFILE_CLASS_UID}|exo__FocusProfile]]`,
        ],
      },
    },
  ]);
}

const approvingGate: IConfirmGate = {
  confirmHardSwitch: async () => true,
};
const refusingGate: IConfirmGate = {
  confirmHardSwitch: async () => false,
};

describe("CLI v16 — hard-switch (RFC 22b50a17 Phase 1b)", () => {
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "exocortex-cli-hardswitch-"),
    );
    await makeFixtureVault(vaultRoot);
  });

  afterEach(async () => {
    await fs.remove(vaultRoot);
  });

  it("[scenario 1] approve → emits Phase 3 scaffold notice + exitCode 0", async () => {
    const result = await runHardSwitch(
      PROFILE_UID,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        out: () => {},
        err: () => {},
      },
    );
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(result.stdout.join("\n")).toContain(
      HARD_SWITCH_PHASE3_PENDING_NOTICE,
    );
  });

  it("[scenario 2] refuse → exitCode 0 without scaffold notice", async () => {
    const result = await runHardSwitch(
      PROFILE_UID,
      { vault: vaultRoot, yes: false, verbose: false },
      {
        confirmGate: refusingGate,
        out: () => {},
        err: () => {},
      },
    );
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(result.stdout.join("\n")).not.toContain(
      HARD_SWITCH_PHASE3_PENDING_NOTICE,
    );
  });

  it("[scenario 3] --vault <invalid-path> → throws VaultNotFoundError", async () => {
    await expect(
      runHardSwitch(
        PROFILE_UID,
        { vault: "/does/not/exist-xyz-123", yes: true, verbose: false },
        {
          confirmGate: approvingGate,
          out: () => {},
          err: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(VaultNotFoundError);
  });

  it("[scenario 4] --verbose passes through to the gate (gate observes plan)", async () => {
    const seenPlan: { plan?: HardSwitchPlan } = {};
    const recordingGate: IConfirmGate = {
      confirmHardSwitch: async (plan) => {
        seenPlan.plan = plan;
        return true;
      },
    };
    const result = await runHardSwitch(
      PROFILE_UID,
      { vault: vaultRoot, yes: true, verbose: true },
      {
        confirmGate: recordingGate,
        out: () => {},
        err: () => {},
      },
    );
    expect(result.exitCode).toBe(ExitCodes.SUCCESS);
    expect(seenPlan.plan?.targetProfileUid).toBe(PROFILE_UID);
  });

  it("[scenario 5] missing profile-uid → commander surfaces an error", async () => {
    const cmd = hardSwitchCommand();
    // Suppress commander's stderr output during the test.
    cmd.exitOverride();
    let threw = false;
    try {
      await cmd.parseAsync(["--vault", vaultRoot], { from: "user" });
    } catch (e) {
      threw = true;
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.length).toBeGreaterThan(0);
    }
    expect(threw).toBe(true);
  });

  it("[scenario 6] unknown profile UID → throws InvalidArgumentsError", async () => {
    await expect(
      runHardSwitch(
        MISSING_UID,
        { vault: vaultRoot, yes: true, verbose: false },
        {
          confirmGate: approvingGate,
          out: () => {},
          err: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(InvalidArgumentsError);
  });

  it("command surface registers --yes and --verbose flags", () => {
    const cmd = hardSwitchCommand();
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--vault");
    expect(optionNames).toContain("--yes");
    expect(optionNames).toContain("--verbose");
    expect(cmd.description()).toContain("Hard switch");
  });

  it("[MED-1 regression] HardSwitchResult.stdout pushes each line exactly once", async () => {
    const result = await runHardSwitch(
      PROFILE_UID,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        out: () => {},
        err: () => {},
      },
    );
    const count = result.stdout.filter((line) =>
      line.includes(HARD_SWITCH_PHASE3_PENDING_NOTICE),
    ).length;
    expect(count).toBe(1);
  });

  it("[MED-2 regression] degraded resolver outcome refuses with OPERATION_FAILED", async () => {
    const { CliFocusProfileResolver } = await import(
      "../../../src/services/CliFocusProfileResolver.js"
    );
    // Inject a fake resolver returning `degraded` rather than building a
    // pathological vault. The production path is exercised in the
    // resolver's own unit tests; here we verify the consumer's guard.
    const fakeResolver = {
      resolveFilter: async () => ({
        outcome: "degraded" as const,
        reason: "synthetic — no AS-folder overlap",
      }),
    } as unknown as InstanceType<typeof CliFocusProfileResolver>;

    const result = await runHardSwitch(
      PROFILE_UID,
      { vault: vaultRoot, yes: true, verbose: false },
      {
        confirmGate: approvingGate,
        resolverFactory: () => fakeResolver,
        out: () => {},
        err: () => {},
      },
    );
    expect(result.exitCode).toBe(ExitCodes.OPERATION_FAILED);
    expect(result.stderr.join("\n")).toContain("Refused");
    expect(result.stderr.join("\n")).toContain("degraded");
    expect(result.stdout.join("\n")).not.toContain(
      HARD_SWITCH_PHASE3_PENDING_NOTICE,
    );
  });
});

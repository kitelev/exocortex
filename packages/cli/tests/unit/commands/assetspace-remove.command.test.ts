import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveRemoveAssetSpacePath,
  runAssetSpaceRemove,
  type AssetSpaceRemoveDeps,
} from "../../../src/commands/assetspace-remove.js";
import type { AssetSpaceInfo } from "../../../src/services/CliApplyProfileService.js";
import { ExitCodes } from "../../../src/utils/ExitCodes.js";
import { InvalidArgumentsError } from "../../../src/utils/errors/index.js";

const EXO_INFO: AssetSpaceInfo = {
  uid: "49fd2e56-4656-4ca7-a789-f472b16ea260",
  git: "https://github.com/kitelev/exoas-exo",
  folderName: "assetspaces/kitelev/exoas-exo",
  label: "exo",
  namespace: "exo",
};

const PMBOK_INFO: AssetSpaceInfo = {
  uid: "abc12345-0000-0000-0000-000000000000",
  git: "https://github.com/kitelev/exoas-pmbok-ontology",
  folderName: "assetspaces/kitelev/exoas-pmbok-ontology",
  label: "pmbok",
  namespace: "pmbok",
};

describe("assetspace-remove — resolveRemoveAssetSpacePath (#e6b8827c)", () => {
  it("--url derives the canonical Maven path (parity with assetspace-add)", () => {
    expect(
      resolveRemoveAssetSpacePath({
        url: "https://github.com/kitelev/exoas-pmbok-ontology",
      }),
    ).toBe("assetspaces/kitelev/exoas-pmbok-ontology");
  });

  it("--folder with a full assetspaces/ path is used verbatim", () => {
    expect(
      resolveRemoveAssetSpacePath({ folder: "assetspaces/kitelev/exoas-exo" }),
    ).toBe("assetspaces/kitelev/exoas-exo");
  });

  it("--folder with a bare segment is prefixed with assetspaces/", () => {
    expect(resolveRemoveAssetSpacePath({ folder: "pmbok" })).toBe(
      "assetspaces/pmbok",
    );
    expect(resolveRemoveAssetSpacePath({ folder: "kitelev/exoas-exo" })).toBe(
      "assetspaces/kitelev/exoas-exo",
    );
  });

  it("--folder takes precedence over --url", () => {
    expect(
      resolveRemoveAssetSpacePath({
        folder: "assetspaces/legacy/flat",
        url: "https://github.com/kitelev/exoas-exo",
      }),
    ).toBe("assetspaces/legacy/flat");
  });

  it("neither --folder nor --url → throws InvalidArgumentsError", () => {
    expect(() => resolveRemoveAssetSpacePath({})).toThrow(InvalidArgumentsError);
    expect(() => resolveRemoveAssetSpacePath({ folder: "" })).toThrow(
      InvalidArgumentsError,
    );
  });
});

describe("assetspace-remove — runAssetSpaceRemove (#e6b8827c)", () => {
  let vault: string;
  const captured: string[] = [];

  beforeEach(() => {
    vault = mkdtempSync(path.join(os.tmpdir(), "exo-asremove-test-"));
    captured.length = 0;
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  function deps(
    infos: AssetSpaceInfo[],
    unmountCalls: Array<{ vault: string; folder: string }>,
  ): AssetSpaceRemoveDeps {
    return {
      scanInfos: () => infos,
      unmount: (v, f) => {
        unmountCalls.push({ vault: v, folder: f });
      },
      out: (m) => captured.push(`OUT ${m}`),
      err: (m) => captured.push(`ERR ${m}`),
    };
  }

  it("[floor-refuse] refuses a floor AssetSpace (by UID) — unmount NOT called, non-zero exit", async () => {
    // Revert-verify: removing the `isTsFloorAssetSpace` guard makes this assert
    // FAIL (unmount would run for exo → self-brick).
    const unmountCalls: Array<{ vault: string; folder: string }> = [];
    const res = await runAssetSpaceRemove(
      { vault, folder: "assetspaces/kitelev/exoas-exo" },
      deps([EXO_INFO, PMBOK_INFO], unmountCalls),
    );
    expect(res.exitCode).toBe(ExitCodes.OPERATION_FAILED);
    expect(res.removed).toBe(false);
    expect(unmountCalls).toEqual([]); // ← the guard
    expect(res.stderr.join("\n")).toContain("Refused");
    expect(res.stderr.join("\n")).toContain("TS-floor");
  });

  it("[floor-refuse] refuses a floor AssetSpace matched by NAMESPACE (EKA registry, different UID)", async () => {
    const ekaExo: AssetSpaceInfo = {
      uid: "e5c47526-e72f-42e3-8535-3d243dd2db94", // different UID
      git: "https://github.com/acme/exoas-exo",
      folderName: "assetspaces/acme/exoas-exo",
      label: "exo",
      namespace: "exo", // fork-safe floor identity
    };
    const unmountCalls: Array<{ vault: string; folder: string }> = [];
    const res = await runAssetSpaceRemove(
      { vault, folder: "assetspaces/acme/exoas-exo" },
      deps([ekaExo], unmountCalls),
    );
    expect(res.exitCode).toBe(ExitCodes.OPERATION_FAILED);
    expect(unmountCalls).toEqual([]);
  });

  it("[MEDIUM fix] path-based floor: flat exo mount with NO matching descriptor → refused", async () => {
    // The descriptor join misses (no info at assetspaces/exo), but the path
    // itself names the floor → isTsFloorMountPath catches it. unmount NOT called.
    const unmountCalls: Array<{ vault: string; folder: string }> = [];
    const res = await runAssetSpaceRemove(
      { vault, folder: "assetspaces/exo" },
      deps([PMBOK_INFO], unmountCalls), // exo NOT described
    );
    expect(res.exitCode).toBe(ExitCodes.OPERATION_FAILED);
    expect(res.removed).toBe(false);
    expect(unmountCalls).toEqual([]); // ← path guard
    expect(res.stderr.join("\n")).toContain("floor namespace");
  });

  it("non-floor AssetSpace (by --url) → unmount called, success exit", async () => {
    // Materialise the folder so existedBefore=true reports a real removal.
    mkdirSync(path.join(vault, "assetspaces", "kitelev", "exoas-pmbok-ontology"), {
      recursive: true,
    });
    const unmountCalls: Array<{ vault: string; folder: string }> = [];
    const res = await runAssetSpaceRemove(
      { vault, url: "https://github.com/kitelev/exoas-pmbok-ontology" },
      deps([EXO_INFO, PMBOK_INFO], unmountCalls),
    );
    expect(res.exitCode).toBe(ExitCodes.SUCCESS);
    expect(res.removed).toBe(true);
    expect(res.folder).toBe("assetspaces/kitelev/exoas-pmbok-ontology");
    expect(unmountCalls).toEqual([
      { vault, folder: "assetspaces/kitelev/exoas-pmbok-ontology" },
    ]);
    expect(res.stdout.join("\n")).toContain("unmounted");
  });

  it("un-described mount (no matching descriptor) → non-floor, unmount called", async () => {
    const unmountCalls: Array<{ vault: string; folder: string }> = [];
    const res = await runAssetSpaceRemove(
      { vault, folder: "assetspaces/kitelev/exoas-orphan" },
      deps([EXO_INFO], unmountCalls), // EXO present, but target not described
    );
    expect(res.exitCode).toBe(ExitCodes.SUCCESS);
    expect(unmountCalls).toEqual([
      { vault, folder: "assetspaces/kitelev/exoas-orphan" },
    ]);
  });

  it("--json emits machine-readable result for a successful unmount", async () => {
    const unmountCalls: Array<{ vault: string; folder: string }> = [];
    const res = await runAssetSpaceRemove(
      { vault, folder: "assetspaces/kitelev/exoas-pmbok-ontology", json: true },
      deps([PMBOK_INFO], unmountCalls),
    );
    expect(res.exitCode).toBe(ExitCodes.SUCCESS);
    const parsed = JSON.parse(res.stdout.join("\n"));
    expect(parsed.folder).toBe("assetspaces/kitelev/exoas-pmbok-ontology");
    expect(parsed.unmounted).toBe(true);
  });

  it("unmount mechanics throw → failure exit, error surfaced", async () => {
    const res = await runAssetSpaceRemove(
      { vault, folder: "assetspaces/kitelev/exoas-pmbok-ontology" },
      {
        scanInfos: () => [PMBOK_INFO],
        unmount: () => {
          throw new Error("rmSync boom");
        },
        out: (m) => captured.push(m),
        err: (m) => captured.push(m),
      },
    );
    expect(res.exitCode).toBe(ExitCodes.OPERATION_FAILED);
    expect(res.removed).toBe(false);
    expect(res.stderr.join("\n")).toContain("Unmount failed");
    expect(res.stderr.join("\n")).toContain("rmSync boom");
  });
});

/**
 * @jest-environment node
 *
 * @req:d4ccc901-83a4-4495-a4bb-43d1305dfd00
 *
 * req `d4ccc901` — the CLI producer side of the three-state mount model, against
 * a REAL on-disk vault (no stubbed fs): a folder under `assetspaces/` means
 * `active`, one under `.exocortex/parked/` means `parked`, neither means
 * `absent`.
 *
 * ## Axes (one guard each)
 *
 *  A. departures PARTITION — a parked AssetSpace's files never reach
 *     `filesToDestroy` / `assetSpacesBeingTornDown`, so the gate's
 *     "N files to remove" stays literally true. Mutant: derive `filesToDestroy`
 *     from `[...toDestroy, ...toPark]` → this reddens, the destroy case does not.
 *  B. the plan CARRIES the park/unpark lists (the confirm-gate contract).
 *  C. arrivals share ONE path — an unpark and a pull differ only in how the
 *     bytes are acquired; `.gitmodules` registration and the `materialized`
 *     bookkeeping are common. Mutant: skip `ensureGitmodulesEntry` for
 *     `source === "unpark"` → the unpark case reddens, the pull case does not.
 *  D. a hard (TBox) edge is still DESTROYED — parking is not applied blindly.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  CliApplyProfileService,
  type ApplyProfileDiff,
} from "../../src/services/CliApplyProfileService";
import { ASSET_SPACE_CLASS_UID } from "../../src/services/CliProfileResolver";
import {
  DEPENDENCY_KIND_REFERENCE_UID,
  DEPENDENCY_KIND_TBOX_UID,
  PARKED_ROOT,
} from "@kitelev/exocortex-core";

const FLOOR_UID = "11111111-1111-1111-1111-111111111111";
const SOFT_UID = "22222222-2222-2222-2222-222222222222";
const HARD_UID = "33333333-3333-3333-3333-333333333333";

/** Records what the mount port was asked to do, without touching the network. */
class MountSpy {
  readonly calls: string[] = [];
  pulled: string[] = [];
  parked: string[] = [];
  unparked: string[] = [];
  gitmodules: string[] = [];

  async pullAssetSpace(url: string, _ref: string, dest: string): Promise<void> {
    this.calls.push(`pull:${dest}`);
    this.pulled.push(dest);
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, "pulled.md"), `# from ${url}\n`);
  }
  parkAssetSpace(vaultPath: string, rel: string): void {
    this.calls.push(`park:${rel}`);
    this.parked.push(rel);
  }
  unparkAssetSpace(vaultPath: string, rel: string): void {
    this.calls.push(`unpark:${rel}`);
    this.unparked.push(rel);
  }
  ensureGitmodulesEntry(_vaultPath: string, rel: string, _url: string): void {
    this.calls.push(`gitmodules:${rel}`);
    this.gitmodules.push(rel);
  }
  unmountAssetSpace(_vaultPath: string, rel: string): void {
    this.calls.push(`unmount:${rel}`);
  }
}

function writeDescriptor(
  root: string,
  uid: string,
  repo: string,
  extra = "",
  namespace = repo,
): void {
  const dir = path.join(root, "assetspaces", "_registry");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${uid}.md`),
    `---\n` +
      `exo__Asset_uid: ${uid}\n` +
      `exo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\n` +
      `exo__AssetSpace_namespace: ${namespace}\n` +
      `exo__AssetSpace_source: "https://github.com/kitelev/${repo}"\n` +
      extra +
      `---\n`,
  );
}

function mountFolder(repo: string): string {
  return path.join("assetspaces", "kitelev", repo);
}

describe("@req:d4ccc901-83a4-4495-a4bb-43d1305dfd00 CliApplyProfileService — three mount states", () => {
  let root: string;
  let mount: MountSpy;
  let svc: CliApplyProfileService;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "exo-t3b-parked-"));
    mount = new MountSpy();
    svc = new CliApplyProfileService({
      vaultPath: root,
      mount: mount as unknown as never,
    });
    // The floor must stay declared or `assertTsFloor` refuses the whole plan —
    // parking is not allowed to become a way around the floor policy.
    // Namespace `exo` (not the repo name) — that is what the TS-floor guard
    // matches on, so a floor descriptor named only by repo would abort every
    // plan below with a self-brick refusal and hide the parking behaviour.
    writeDescriptor(root, FLOOR_UID, "exoas-exo", "", "exo");
    mkdirSync(path.join(root, mountFolder("exoas-exo")), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function diffFor(
    declared: string[],
  ): ApplyProfileDiff {
    const { infos } = svc.scanVault();
    return svc.buildDiff({
      targetProfileUid: "p-target",
      targetProfileLabel: "Target",
      sourceProfileUid: null,
      sourceProfileLabel: "<none>",
      result: {
        declaredOntologies: new Set([FLOOR_UID, ...declared]),
        // `effective` is the post-floor set the diff intersects against; the
        // declared set already carries the floor, so they coincide here.
        effective: new Set([FLOOR_UID, ...declared]),
      } as unknown as never,
      infos,
    });
  }

  it("parks a SOFT-edge departure instead of destroying it, and its files stay OUT of the remove count", () => {
    writeDescriptor(
      root,
      SOFT_UID,
      "exoas-soft",
      `exo__AssetSpace_dependsOnKind: "[[${DEPENDENCY_KIND_REFERENCE_UID}]]"\n`,
    );
    const dir = path.join(root, mountFolder("exoas-soft"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "a.md"), "a");
    writeFileSync(path.join(dir, "b.md"), "b");

    const diff = diffFor([]); // soft AS omitted → departs

    // AXIS A — the partition. Both halves asserted: present in `toPark`, and
    // ABSENT from every destroy-shaped field. Only the second half reddens under
    // the "put parks in filesToDestroy too" mutant.
    expect(diff.toPark.map((t) => t.asUid)).toEqual([SOFT_UID]);
    expect(diff.toDestroy).toHaveLength(0);
    expect(diff.plan.filesToDestroy.get(SOFT_UID)).toBeUndefined();
    expect(diff.plan.assetSpacesBeingTornDown).toHaveLength(0);
    const totalFiles = [...diff.plan.filesToDestroy.values()].reduce(
      (s, f) => s + f.length,
      0,
    );
    expect(totalFiles).toBe(0);

    // AXIS B — and it is ANNOUNCED, not merely omitted. Silence would be as
    // dishonest as a wrong count: the user would see "0 files to remove" with no
    // hint that an AssetSpace left the active set at all.
    expect(diff.plan.assetSpacesBeingParked).toEqual([
      { asUid: SOFT_UID, asLabel: "exoas-soft", fileCount: 2 },
    ]);
  });

  it("still DESTROYS a hard (TBox) departure — parking is opt-in by dependency kind", () => {
    writeDescriptor(
      root,
      HARD_UID,
      "exoas-hard",
      `exo__AssetSpace_dependsOnKind: "[[${DEPENDENCY_KIND_TBOX_UID}]]"\n`,
    );
    const dir = path.join(root, mountFolder("exoas-hard"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "a.md"), "a");

    const diff = diffFor([]);

    expect(diff.toPark).toHaveLength(0);
    expect(diff.toDestroy.map((t) => t.asUid)).toEqual([HARD_UID]);
    expect(diff.plan.filesToDestroy.get(HARD_UID)).toHaveLength(1);
    expect(diff.plan.assetSpacesBeingParked).toHaveLength(0);
  });

  it("detects a PARKED AssetSpace and plans an unpark (not a fresh pull) when the profile wants it back", () => {
    writeDescriptor(root, SOFT_UID, "exoas-soft");
    // No mount folder; a parked copy instead.
    mkdirSync(path.join(root, PARKED_ROOT, "kitelev", "exoas-soft"), {
      recursive: true,
    });

    const diff = diffFor([SOFT_UID]);

    expect(diff.toMaterialize).toHaveLength(1);
    expect(diff.toMaterialize[0].source).toBe("unpark");
    expect(diff.plan.assetSpacesBeingUnparked).toEqual([
      { asUid: SOFT_UID, asLabel: "exoas-soft" },
    ]);
    // An unpark is still an arrival, so it belongs in the materialize list too —
    // the modal's "will be available after this" section must not lose it.
    expect(
      diff.plan.assetSpacesBeingMaterialized.map((a) => a.asUid),
    ).toContain(SOFT_UID);
  });

  it("plans a PULL when neither a mount nor a parked copy exists", () => {
    writeDescriptor(root, SOFT_UID, "exoas-soft");
    const diff = diffFor([SOFT_UID]);
    expect(diff.toMaterialize[0].source).toBe("pull");
    expect(diff.plan.assetSpacesBeingUnparked).toHaveLength(0);
  });

  it("execute(): an unpark renames back and STILL registers .gitmodules — one arrival path, not a copy", async () => {
    writeDescriptor(root, SOFT_UID, "exoas-soft");
    mkdirSync(path.join(root, PARKED_ROOT, "kitelev", "exoas-soft"), {
      recursive: true,
    });

    const res = await svc.execute(diffFor([SOFT_UID]));

    // AXIS C — the acquisition step branched…
    expect(mount.unparked).toEqual([mountFolder("exoas-soft")]);
    expect(mount.pulled).toHaveLength(0);
    // …and everything downstream did NOT. A duplicated unpark path that forgot
    // `ensureGitmodulesEntry` would leave the restored AssetSpace unregistered.
    expect(mount.gitmodules).toEqual([mountFolder("exoas-soft")]);
    expect(res.materialized).toEqual([SOFT_UID]);
  });

  it("execute(): a pull takes the SAME downstream steps as an unpark", async () => {
    writeDescriptor(root, SOFT_UID, "exoas-soft");
    const res = await svc.execute(diffFor([SOFT_UID]));
    expect(mount.pulled).toHaveLength(1);
    expect(mount.unparked).toHaveLength(0);
    // Same registration, same bookkeeping — the shared tail.
    expect(mount.gitmodules).toEqual([mountFolder("exoas-soft")]);
    expect(res.materialized).toEqual([SOFT_UID]);
  });

  it("execute(): a park calls the park port and NEVER the unmount port", async () => {
    writeDescriptor(
      root,
      SOFT_UID,
      "exoas-soft",
      `exo__AssetSpace_dependsOnKind: "[[${DEPENDENCY_KIND_REFERENCE_UID}]]"\n`,
    );
    mkdirSync(path.join(root, mountFolder("exoas-soft")), { recursive: true });

    const res = await svc.execute(diffFor([]));

    expect(mount.parked).toEqual([mountFolder("exoas-soft")]);
    // The distinction that matters for the user's bytes: an unmount deletes.
    expect(mount.calls.some((c) => c.startsWith("unmount:"))).toBe(false);
    expect(res.parked).toEqual([SOFT_UID]);
    expect(res.destroyed).toHaveLength(0);
  });

  it("a parked copy is invisible to the ACTIVE-set scan (it is not a mount)", () => {
    // The property T3a proved for ExoSync, asserted here at the apply layer: the
    // parked folder must not be mistaken for a materialised mount, or the next
    // apply would think the AssetSpace is already active and skip the unpark.
    writeDescriptor(root, SOFT_UID, "exoas-soft");
    mkdirSync(path.join(root, PARKED_ROOT, "kitelev", "exoas-soft"), {
      recursive: true,
    });
    expect(existsSync(path.join(root, mountFolder("exoas-soft")))).toBe(false);
    const diff = diffFor([SOFT_UID]);
    // Wanted + not active ⇒ an arrival is planned (rather than "none").
    expect(diff.toMaterialize).toHaveLength(1);
  });
});

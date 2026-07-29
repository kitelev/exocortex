/**
 * BootstrapAssetSpaceCommands — command-palette logic handler for RFC 13da049f
 * Phase 6.2 (Bootstrap vault) + Phase 6.3 (Add AssetSpace by URL), plugin side.
 *
 * Mirrors the CLI equivalents (`exocortex bootstrap` + `exocortex assetspace-add`,
 * v16.57.0) but runs inside Obsidian, reusing the Phase 5 plugin infrastructure
 * instead of duplicating the REST/tarball/security logic:
 *   - {@link IAssetSpacePuller.pullAssetSpace} (AssetSpaceManager) — REST tarball
 *     pull + zip-slip-safe extraction into a staging dir.
 *   - {@link IGitSubmoduleOps} (GitSubmoduleOps) — `renameIntoVault` (staging →
 *     vault) + `.gitmodules` read/append text manipulation.
 *
 * Pure logic — does NOT import Obsidian's Modal / Plugin / vault runtime.
 * Everything platform-specific (modal UI, vault.adapter probing, URL allowlist)
 * is injected via {@link BootstrapAssetSpaceCommandsDeps} so the class is fully
 * unit-testable with fakes. Real wiring lives in `ExocortexPlugin`.
 *
 * Cross-platform (#3535): on DESKTOP the injected `getPuller` + `gitOps` run the
 * staging-pull + `.gitmodules` path (Node `fs`); on MOBILE an injected
 * {@link IRestBootstrapMount} (RFC 01a83de8 `RestAssetSpaceMount`) materialises
 * via `vault.adapter` (no Node `fs`). The plugin wires whichever is available
 * (`applyDeps` on desktop, `restMount` on mobile) and registers both commands on
 * both platforms — Desktop↔Mobile Command Parity invariant.
 *
 * Commands provided:
 *   1. `Exocortex: Bootstrap vault` — cold-start an empty vault with the exo
 *      TS-floor AssetSpace. A clean bootstrap is **exo-only** (decision
 *      2026-06-20): exo is the SDK/engine floor and is all a minimal clean
 *      start needs. exocmd (and any other AssetSpace) is added later via «Add
 *      AssetSpace by URL» or transitively via a profile — NOT during bootstrap.
 *      Handles three vault states:
 *        - empty → prompt for the exo URL (EC7: field empty, kitelev URL shown
 *          as a placeholder example only) → materialise exo.
 *        - clone-needs-fetch (EC2) → `.gitmodules` populated but folders empty
 *          (cloned without `--recurse-submodules`) → confirm → re-materialise
 *          each tracked AssetSpace from its preserved URL (this re-fetch path
 *          still restores every tracked space, exocmd included if it was added
 *          later).
 *        - bootstrapped → no-op notice (use «Add AssetSpace» for more spaces).
 *      Non-git vaults (AC10 / M19): file-only mode — REST pulls without
 *      `.gitmodules`, tracked device-locally.
 *   2. `Exocortex: Add AssetSpace by URL` — pull a single AssetSpace into a
 *      URL-derived folder, append the `.gitmodules` entry (idempotent).
 */

import { derivePath } from "@kitelev/exocortex-core";
import {
  detectUnmountedClosureMembers,
  formatClosureGapWarning,
} from "../../domain/profile/closureGap";
import type { AssetSpaceInfo } from "./AssetSpaceManager";

/** Subset of {@link AssetSpaceManager} used here (REST tarball pull). */
export interface IAssetSpacePuller {
  pullAssetSpace(
    asUid: string,
    asGitUrl: string,
    ref?: string,
  ): Promise<{ asUid: string; stagingPath: string; sha: string }>;
  /**
   * Release the staging dir returned by a prior {@link pullAssetSpace}. The
   * pull deliberately KEEPS the dir on success (caller owns its lifetime — see
   * `AssetSpaceManager.pullAssetSpace` docstring), so the caller MUST call this
   * once it has consumed the dir (moved it into the vault). Issue #3391:
   * without this the StagingDirTracker entry leaks into `data.local.json` until
   * the next plugin reload. Idempotent / tolerant of an already-moved dir.
   */
  releaseStaging(stagingPath: string): Promise<void>;
}

/** Subset of {@link GitSubmoduleOps} used here (staging move + `.gitmodules`). */
export interface IGitSubmoduleOps {
  renameIntoVault(stagingPath: string, submodulePath: string): Promise<void>;
  readGitmodulesEntries(): Promise<Array<{ submodulePath: string; url: string }>>;
  appendGitmodulesEntry(
    submodulePath: string,
    url: string,
  ): Promise<{ added: boolean }>;
}

/**
 * Cross-platform (incl. iOS) materialise strategy — the mobile-capable
 * counterpart of {@link IAssetSpacePuller} + {@link IGitSubmoduleOps} (#3535).
 * A single combined op (pull tarball → materialise into the vault folder) over
 * `vault.adapter`, with NO Node `fs` / staging dir / file-only registry split.
 * Satisfied structurally by `RestAssetSpaceMount` (RFC 01a83de8) — the same
 * adapter `apply-profile` already mounts through on mobile.
 *
 * When injected, it fully replaces the desktop `getPuller` + `gitOps` path.
 * RFC 0005 Phase 1 — the mount writes **no** `.gitmodules`; the mounted set is
 * tracked by folder presence (`assetspaces/<owner>/<repo>`), and
 * {@link listMountedAssetSpaces} re-derives URLs from those paths. apply-profile
 * (`listAllAssetSpaceInfos`) already reads filesystem presence + descriptors,
 * not `.gitmodules`.
 */
export interface IRestBootstrapMount {
  /**
   * Pull `gitUrl`'s tarball and materialise it into `submodulePath` via
   * `vault.adapter`. Returns the tarball SHA. RFC 0005 Phase 1 — writes **no**
   * `.gitmodules`: the folder presence at `assetspaces/<owner>/<repo>` is the
   * mount-state record.
   */
  mount(
    gitUrl: string,
    submodulePath: string,
    ref: string,
  ): Promise<{ sha: string }>;
  /**
   * List the mounted AssetSpaces by enumerating the `assetspaces/<owner>/<repo>`
   * folders on disk + re-deriving each URL (RFC 0005 Phase 1 — replaces reading
   * the `.gitmodules` URL-registry). `{submodulePath, url}` per folder.
   */
  listMountedAssetSpaces(): Promise<
    Array<{ submodulePath: string; url: string }>
  >;
}

/** Subset of {@link PluginLocalDataStore} used for AC10 file-only tracking. */
export interface IFileOnlyAssetSpaceStore {
  upsertFileOnlyAssetSpace(entry: {
    folderName: string;
    url: string;
    sha: string;
    addedAt: string;
  }): Promise<void>;
}

/** Result of a single AssetSpace materialisation. */
export interface MaterializeResult {
  /** Vault-relative folder the AssetSpace was materialised into. */
  folderName: string;
  /** 7-char tarball SHA recorded at pull time. */
  sha: string;
}

/**
 * Which Bootstrap / Add operation failed — used by the durable failure panel
 * (RFC 0002 §3.10) to phrase the title + retry action.
 */
export type BootstrapOperation = "bootstrap" | "add";

/**
 * Classified cause of a Bootstrap / Add failure (RFC 0002 §3.10, resolves P15b).
 * Drives the durable result panel's recovery-step copy:
 *   - `bad-url`  — the repo URL failed validation / folder derivation.
 *   - `network`  — the tarball pull could not reach GitHub (offline / DNS /
 *                  timeout).
 *   - `auth`     — GitHub rejected the token (401 / 403-not-rate-limit, or a
 *                  private-repo 404 from an under-scoped fine-grained PAT).
 *   - `unknown`  — anything else; the panel points at the logs.
 */
export type BootstrapFailureCause = "bad-url" | "network" | "auth" | "unknown";

/**
 * Terminal bootstrap outcome reported to the durable result panel (RFC 0002
 * §3.3 + §3.10). Emitted via {@link BootstrapAssetSpaceCommandsDeps.showResult}
 * IN ADDITION TO the existing transient toast + activity-log entry — this adds a
 * persistent, in-context "what happened + what to do next" surface, it does not
 * replace the (already firing) feedback.
 *
 * The three SUCCESS outcomes carry a "next step" nudge (§3.3 / P5). The `failed`
 * outcome (§3.10 / P15) carries a classified `cause` + the failing `operation`
 * so the panel surfaces WHY it failed and HOW to recover, routed through the
 * same durable panel rather than a toast that fades.
 */
export type BootstrapResultInfo =
  | { kind: "bootstrapped"; folderName: string; sha: string }
  | { kind: "fetched"; fetched: number; total: number }
  | { kind: "already-bootstrapped" }
  | {
      kind: "failed";
      operation: BootstrapOperation;
      cause: BootstrapFailureCause;
      /** Raw error detail (already redaction-safe — a message, not a token). */
      detail: string;
    };

export interface BootstrapAssetSpaceCommandsDeps {
  /**
   * Lazily resolve the REST tarball puller. Invoked once per materialise (i.e.
   * at command-execution time, NOT at construction), so the puller is built
   * from the CURRENT GitHub PAT. Issue #3382: the previous fixed `puller`
   * captured an onload-time client, ignoring a PAT the user entered after the
   * plugin loaded → 401/404 on private-repo pulls. Production wiring resolves
   * this to {@link ApplyDepsFactory.buildAssetSpacePuller}.
   */
  getPuller?: () => Promise<IAssetSpacePuller>;
  gitOps?: IGitSubmoduleOps;
  localStore?: IFileOnlyAssetSpaceStore;
  /**
   * Mobile (#3535) cross-platform materialise strategy. When wired, it replaces
   * the desktop `getPuller` + `gitOps` path entirely (the REST mount does the
   * pull + materialise + `.gitmodules` write itself). Desktop wiring passes the
   * `getPuller` + `gitOps` + `localStore` trio (no `restMount`); mobile wiring
   * passes `restMount` (and may still pass `localStore`, which is unused on the
   * REST path). At least one of {`getPuller` + `gitOps`, `restMount`} must be
   * present, else `materialize` / `listTrackedEntries` throw.
   */
  restMount?: IRestBootstrapMount;
  /** `vault.adapter.exists(path)` wrapper. */
  vaultExists: (path: string) => Promise<boolean>;
  /** `vault.adapter.list(dir)` wrapper. */
  listFolder: (
    dir: string,
  ) => Promise<{ files: string[]; folders: string[] }>;
  /** True when the vault root is a git repository (`.git` exists). */
  isGitVault: () => Promise<boolean>;
  /**
   * Validate a GitHub repo URL against the canonical allowlist. Throws on
   * invalid. Injected (not duplicated) so the single source of truth stays in
   * `GitHubRestClient.validateRepoURL`.
   */
  validateUrl: (url: string) => void;
  /**
   * Derive a folder name from a repo URL — strips the `exoas-` prefix
   * (`exoas-pmbok` → `pmbok`). Injected to avoid duplicating the URL parser.
   */
  deriveFolderName: (url: string) => string;
  /**
   * Open the bootstrap modal (one empty URL field + example placeholder).
   * Resolves the entered exo URL, or null if the user cancelled. Exo-only
   * (decision 2026-06-20): exocmd is no longer collected here.
   */
  promptBootstrapUrls: () => Promise<{
    exoUrl: string;
  } | null>;
  /**
   * Open the add-AssetSpace modal (single URL field). Resolves the entered
   * URL, or null if the user cancelled. `prefillUrl` (optional) pre-fills the
   * field — used by the first-run onboarding panel to offer the recommended
   * EKA registry / profiles URL (RFC 0002 §3.1 steps 3-4); the user still confirms.
   */
  promptAddAssetSpaceUrl: (
    prefillUrl?: string,
  ) => Promise<{ url: string } | null>;
  /** Yes/no confirmation gate (used by the EC2 clone-needs-fetch flow). */
  confirm: (message: string) => Promise<boolean>;
  /** User-facing Notice. */
  notify: (message: string) => void;
  /**
   * Optional durable, in-context result panel (RFC 0002 §3.3 + §3.10). Called on
   * the terminal bootstrap outcomes ({@link BootstrapResultInfo}) IN ADDITION TO
   * `notify` — the toast still fires; this adds a persistent surface the user can
   * read after it fades. Success outcomes carry a "what next" nudge (§3.3 / P5);
   * the `failed` outcome carries the classified cause + recovery step (§3.10 /
   * P15b). Optional + best-effort: the plugin wires it to open a
   * `BootstrapResultModal`; when omitted (or it throws) the command still
   * completes normally.
   */
  showResult?: (result: BootstrapResultInfo) => void;
  /**
   * Optional hook fired after a successful materialisation so the plugin can
   * re-index the freshly added assets. Failures are swallowed (best-effort).
   */
  onMaterialized?: () => Promise<void>;
  /**
   * issue #3956 — the inputs for a dependsOn-closure completeness check: the
   * scanned AssetSpace catalogue (with `exo__AssetSpace_dependsOn` edges) + the
   * UIDs currently materialised on disk. Wired in production to delegate to
   * `ProfileApplyManager.getClosureCheckInputs`. When present, `Add AssetSpace
   * by URL` warns specifically (naming the missing member[s]) instead of the
   * generic "dependencies are not auto-resolved" advisory; when absent (or the
   * added AssetSpace has no scanned descriptor), the generic advisory is kept.
   */
  getClosureCheckInputs?: () => Promise<{
    infos: AssetSpaceInfo[];
    materializedUids: Set<string>;
  }>;
  /** Branch ref to pull from. Default `"main"`. */
  ref?: string;
}

/** TS-floor folder materialised by a cold (exo-only) bootstrap. */
const ASSETSPACES_DIR = "assetspaces";
const TS_FLOOR_EXO_PATH = `${ASSETSPACES_DIR}/exo`;

export type VaultBootstrapState =
  | "empty"
  | "bootstrapped"
  | "clone-needs-fetch";

export class BootstrapAssetSpaceCommands {
  private readonly d: BootstrapAssetSpaceCommandsDeps;
  private readonly ref: string;

  constructor(deps: BootstrapAssetSpaceCommandsDeps) {
    this.d = deps;
    this.ref = deps.ref ?? "main";
  }

  /**
   * Classify the current vault for the bootstrap command (tracked entries come
   * from {@link listTrackedEntries} — RFC 0005 Phase 1: folder enumeration on a
   * git-free vault, the committed `.gitmodules` on a desktop git vault):
   *   - `empty` — no tracked AssetSpace folders AND none materialised.
   *   - `clone-needs-fetch` — tracked folders exist but none is materialised
   *     (present-but-empty `assetspaces/<owner>/<repo>` dirs, or — on a git vault
   *     — committed `.gitmodules` entries cloned without `--recurse-submodules`).
   *   - `bootstrapped` — at least one `assetspaces/<ns>/` folder has content.
   */
  async detectVaultState(): Promise<VaultBootstrapState> {
    const entries = await this.listTrackedEntries();
    const materialized = await this.hasMaterializedAssetSpaces();
    if (entries.length > 0) {
      return materialized ? "bootstrapped" : "clone-needs-fetch";
    }
    return materialized ? "bootstrapped" : "empty";
  }

  /** Command 1 — `Exocortex: Bootstrap vault`. */
  async invokeBootstrap(): Promise<void> {
    let state: VaultBootstrapState;
    try {
      state = await this.detectVaultState();
    } catch (e) {
      this.d.notify(`Bootstrap: could not inspect vault — ${this.msg(e)}`);
      return;
    }

    if (state === "bootstrapped") {
      this.d.notify(
        "Vault already has AssetSpaces materialised — use «Exocortex: Add AssetSpace by URL» to add more.",
      );
      // Durable result (RFC 0002 §3.3 / P5): the already-bootstrapped guard
      // surfaces a persistent "what happened + what next" panel, not just a
      // transient toast.
      this.emitResult({ kind: "already-bootstrapped" });
      return;
    }

    if (state === "clone-needs-fetch") {
      await this.fetchTrackedAssetSpaces();
      return;
    }

    // state === "empty" — prompt for the exo TS-floor URL.
    const urls = await this.d.promptBootstrapUrls();
    if (urls === null) return; // user cancelled

    // Exo-only clean bootstrap (decision 2026-06-20): exo is the SDK/engine
    // floor and is all a minimal clean start needs. exocmd (UI commands) — and
    // any other AssetSpace — is added later via «Add AssetSpace by URL» or
    // transitively when a profile is applied (effective set / dependsOn DAG),
    // NOT during bootstrap.
    try {
      this.d.validateUrl(urls.exoUrl);
    } catch (e) {
      this.d.notify(`Bootstrap: invalid URL — ${this.msg(e)}`);
      // Durable failure panel (RFC 0002 §3.10 / P15b) — cause is known (bad URL).
      this.emitFailure("bootstrap", e, "bad-url");
      return;
    }

    const isGit = await this.d.isGitVault();
    // On the REST path the cross-platform mount tracks AssetSpaces by folder
    // presence (RFC 0005 Phase 1 — no `.gitmodules` at all, on any platform), so
    // the desktop-only "file-only mode" notice would be misleading — suppress it.
    if (!isGit && this.d.restMount === undefined) {
      this.d.notify(
        "Vault is not a git repository — bootstrapping in file-only mode (no .gitmodules; AssetSpaces tracked device-locally).",
      );
    }

    // RFC 5aa2a73a B4: mount the TS-floor at the Maven path
    // `assetspaces/<owner>/<repo>` — the SAME path `apply-profile` derives via
    // `derivePath`. Flat paths (`assetspaces/exo`) caused a later `apply-profile`
    // to re-materialize the same AssetSpace UID at the Maven path → double mount.
    // Fallback to the flat constant only when the URL is un-derivable.
    const exoPath = derivePath(urls.exoUrl) ?? TS_FLOOR_EXO_PATH;
    try {
      const exo = await this.materialize(urls.exoUrl, exoPath, isGit);
      this.d.notify(
        `Bootstrap complete — ${exo.folderName}@${exo.sha}. ` +
          "Reload Obsidian if the new assets do not appear. Add exocmd (UI commands) or any further AssetSpaces later via «Add assetspace by URL», or by applying a profile — dependencies are not auto-resolved.",
      );
      // Durable result + next-step nudge (RFC 0002 §3.3 / P5) — survives the
      // transient toast. Only on success (hard failure below keeps the toast).
      this.emitResult({
        kind: "bootstrapped",
        folderName: exo.folderName,
        sha: exo.sha,
      });
    } catch (e) {
      this.d.notify(`Bootstrap failed: ${this.msg(e)}`);
      // Durable failure panel (RFC 0002 §3.10 / P15b) — classify the pull failure
      // (network / PAT / unknown) so the user sees the cause + recovery step,
      // not just a transient toast.
      this.emitFailure("bootstrap", e);
    }
    await this.runOnMaterialized();
  }

  /**
   * Command 2 — `Exocortex: Add AssetSpace by URL`.
   *
   * `prefillUrl` (optional) pre-fills the modal field — the first-run
   * onboarding panel passes the public EKA registry / profiles URL here
   * (RFC 0002 §3.1 steps 3-4). The user still reviews + confirms in the modal;
   * the materialisation path below is unchanged.
   */
  async invokeAddAssetSpace(prefillUrl?: string): Promise<void> {
    const res = await this.d.promptAddAssetSpaceUrl(prefillUrl);
    if (res === null) return; // user cancelled

    try {
      this.d.validateUrl(res.url);
    } catch (e) {
      this.d.notify(`Add AssetSpace: invalid URL — ${this.msg(e)}`);
      this.emitFailure("add", e, "bad-url");
      return;
    }

    // #3538: mount at the canonical Maven path `assetspaces/<owner>/<repo>` —
    // the SAME path `invokeBootstrap` (above) and `apply-profile`
    // (`ProfileApplyManager.listAllAssetSpaceInfos`) derive via `derivePath`.
    // Previously this used `deriveFolderName` → flat `assetspaces/<name>`,
    // disagreeing with bootstrap/apply on where the same repo lands: a later
    // `apply-profile` would not recognise the flat folder as materialised (it
    // checks the canonical `derivePath`) and re-materialise the same AssetSpace
    // UID at the Maven path → double mount. Fall back to the flat folder only
    // when the URL is un-derivable (`derivePath` → null), mirroring
    // `invokeBootstrap`'s `?? TS_FLOOR_*` fallback. Platform-agnostic — the
    // single `materialize` call below covers both the desktop (gitOps) and
    // mobile (restMount) paths.
    let submodulePath: string;
    try {
      submodulePath =
        derivePath(res.url) ??
        `${ASSETSPACES_DIR}/${this.d.deriveFolderName(res.url)}`;
    } catch (e) {
      this.d.notify(`Add AssetSpace: could not derive folder — ${this.msg(e)}`);
      this.emitFailure("add", e, "bad-url");
      return;
    }

    const isGit = await this.d.isGitVault();
    // See invokeBootstrap: the REST path tracks AssetSpaces by folder presence
    // (RFC 0005 Phase 1 — no `.gitmodules`), so the desktop "file-only mode"
    // notice does not apply.
    if (!isGit && this.d.restMount === undefined) {
      this.d.notify(
        "Vault is not a git repository — adding in file-only mode (no .gitmodules; tracked device-locally).",
      );
    }

    try {
      const m = await this.materialize(res.url, submodulePath, isGit);
      // #3956 — detect an INCOMPLETE dependsOn-closure at add time and warn
      // SPECIFICALLY (naming the missing member[s] + flagging TBox-providers).
      // This is the exact subset-add gap that left the alpha tester's homoiconic
      // command system silently dead: `exoas-public` mounted, its dependsOn
      // `exoas-exocmd` class-TBox never mounted → `CommandResolver.loadCommand`
      // fails on every command. Falls back to the generic advisory when the
      // closure-inputs dep is unwired or the added AssetSpace has no gap.
      const gapNote = await this.closureGapNote(res.url, m.folderName);
      this.d.notify(
        `AssetSpace added — ${m.folderName}@${m.sha} ← ${res.url}.` +
          (gapNote ??
            " Add any AssetSpaces it depends on manually — dependencies are not auto-resolved."),
      );
    } catch (e) {
      this.d.notify(`Add AssetSpace failed: ${this.msg(e)}`);
      // Durable failure panel (RFC 0002 §3.10 / P15b).
      this.emitFailure("add", e);
      return;
    }
    await this.runOnMaterialized();
  }

  /**
   * issue #3956 — the SPECIFIC dependsOn-closure gap warning for the AssetSpace
   * just added (`url` / `folderName`), or `null` to fall back to the generic
   * advisory. Locates the added AssetSpace's scanned descriptor (by source URL,
   * then folder), computes its `exo__AssetSpace_dependsOn` closure, and warns for
   * every closure member not currently materialised. Best-effort + non-fatal —
   * any failure returns `null` (the add already succeeded).
   */
  private async closureGapNote(
    url: string,
    folderName: string,
  ): Promise<string | null> {
    const getInputs = this.d.getClosureCheckInputs;
    if (getInputs === undefined) return null;
    try {
      const { infos, materializedUids } = await getInputs();
      const added = infos.find(
        (i) => i.git === url || i.folderName === folderName,
      );
      if (added === undefined) return null; // no scanned descriptor → generic
      const missing = detectUnmountedClosureMembers(
        [added.uid],
        infos,
        materializedUids,
      );
      const warning = formatClosureGapWarning(
        missing,
        added.namespace.length > 0 ? added.namespace : "The added AssetSpace",
      );
      return warning === null ? null : ` ${warning}`;
    } catch {
      return null; // best-effort — never fail the add on a diagnostic
    }
  }

  // ─────────────────────────── internal ───────────────────────────

  /**
   * EC2 — re-materialise every tracked AssetSpace whose folder is currently
   * empty. The tracked set comes from {@link listTrackedEntries}: on a git-free
   * vault (RFC 0005 Phase 1) these are the present-but-empty
   * `assetspaces/<owner>/<repo>` folders with their URL re-derived via
   * `deriveUrl`; on a desktop git vault they are the committed `.gitmodules`
   * entries (cloned without `--recurse-submodules`). Re-materialising writes the
   * content back into the same folder.
   */
  private async fetchTrackedAssetSpaces(): Promise<void> {
    let entries: Array<{ submodulePath: string; url: string }>;
    try {
      entries = await this.listTrackedEntries();
    } catch (e) {
      this.d.notify(`Bootstrap: could not list tracked AssetSpaces — ${this.msg(e)}`);
      return;
    }

    const ok = await this.d.confirm(
      `This vault tracks ${entries.length} AssetSpace(s) but none are materialised ` +
        "(likely cloned without --recurse-submodules). Fetch them now from the recorded URLs?",
    );
    if (!ok) return;

    let fetched = 0;
    for (const entry of entries) {
      if (entry.submodulePath.length === 0) continue;
      try {
        // Materialise into the exact path `.gitmodules` declares (preserves
        // any nested layout) rather than re-deriving from the basename.
        await this.materialize(entry.url, entry.submodulePath, true);
        fetched++;
      } catch (e) {
        this.d.notify(`Fetch failed for ${entry.submodulePath}: ${this.msg(e)}`);
      }
    }
    this.d.notify(
      `Fetched ${fetched}/${entries.length} AssetSpace(s) from recorded URLs.`,
    );
    if (fetched > 0) {
      // Durable result for the EC2 restore path (RFC 0002 §3.3 / P5) — fire only
      // when something was actually restored (an all-failed fetch is an error
      // surfaced per-entry, not a "what next" success).
      this.emitResult({ kind: "fetched", fetched, total: entries.length });
      await this.runOnMaterialized();
    }
  }

  /**
   * Pull `url`'s tarball into a staging dir, move it into the vault-relative
   * `submodulePath` (e.g. `assetspaces/exo`), then register it — append the
   * `.gitmodules` entry (git vault) OR record the file-only registry entry
   * (AC10 non-git vault). The staging-dir `asUid` label is synthetic
   * (`bootstrap-<basename>`) since a cold bootstrap has no AssetSpace UID yet —
   * it only names the temp dir for orphan tracking.
   */
  private async materialize(
    url: string,
    submodulePath: string,
    isGit: boolean,
  ): Promise<MaterializeResult> {
    // Cross-platform (#3535 / RFC 01a83de8): one op — pull the tarball and
    // materialise it into the vault folder via `vault.adapter` (no Node fs, no
    // staging dir, no file-only registry split). RFC 0005 Phase 1 — writes NO
    // `.gitmodules`; the materialised folder presence at
    // `assetspaces/<owner>/<repo>` is the mount-state record that
    // `listMountedAssetSpaces` + apply-profile read.
    if (this.d.restMount !== undefined) {
      const { sha } = await this.d.restMount.mount(
        url,
        submodulePath,
        this.ref,
      );
      return { folderName: submodulePath, sha };
    }

    // Desktop path — staging tarball pull + rename-into-vault + `.gitmodules`
    // append (git vault) / file-only registry (AC10 non-git vault).
    const getPuller = this.d.getPuller;
    const gitOps = this.d.gitOps;
    const localStore = this.d.localStore;
    if (
      getPuller === undefined ||
      gitOps === undefined ||
      localStore === undefined
    ) {
      throw new Error(
        "BootstrapAssetSpaceCommands: desktop materialise requires getPuller + gitOps + localStore (or wire restMount for mobile)",
      );
    }
    // Resolve the puller lazily so the pull uses the PAT current at
    // command-execution time, not the one captured at plugin onload (#3382).
    const puller = await getPuller();
    const result = await puller.pullAssetSpace(
      `bootstrap-${basename(submodulePath)}`,
      url,
      this.ref,
    );
    await gitOps.renameIntoVault(result.stagingPath, submodulePath);
    // Issue #3391: `renameIntoVault` MOVED the staging dir into the vault, so
    // its StagingDirTracker entry now points at a path that no longer exists.
    // `pullAssetSpace` keeps the dir alive on success by design (caller owns
    // its lifetime) — release it here so the tracker entry does not linger in
    // `data.local.json` until the next reload. `release()` tolerates a missing
    // dir, so calling it after the move is safe; covers both this single-pull
    // path and the EC2 `fetchTrackedAssetSpaces` loop (which routes through
    // `materialize` too). Best-effort (`.catch`) — a release failure (e.g. a
    // `data.local.json` write error) must not skip the `.gitmodules` /
    // file-only registration below; a leaked tracker entry is benign and
    // self-heals via `sweepOrphans` on reload. Mirrors `pullAssetSpace`'s own
    // cleanup convention (`stagingTracker.release(...).catch(() => undefined)`).
    await puller.releaseStaging(result.stagingPath).catch(() => undefined);
    if (isGit) {
      await gitOps.appendGitmodulesEntry(submodulePath, url);
    } else {
      await localStore.upsertFileOnlyAssetSpace({
        folderName: submodulePath,
        url,
        sha: result.sha,
        addedAt: new Date().toISOString(),
      });
    }
    return { folderName: submodulePath, sha: result.sha };
  }

  /**
   * True when a materialised AssetSpace exists — at least one `.md` under either
   * the flat layout (`assetspaces/<ns>/*.md`) or the Maven layout
   * (`assetspaces/<owner>/<repo>/*.md`, RFC 5aa2a73a B4). Missing `assetspaces/`
   * dir → false.
   */
  private async hasMaterializedAssetSpaces(): Promise<boolean> {
    const exists = await this.d.vaultExists(ASSETSPACES_DIR);
    if (!exists) return false;
    let top: { files: string[]; folders: string[] };
    try {
      top = await this.d.listFolder(ASSETSPACES_DIR);
    } catch {
      return false;
    }
    for (const folder of top.folders) {
      try {
        const inner = await this.d.listFolder(folder);
        // Flat layout: `assetspaces/<ns>/*.md`.
        if (inner.files.some((f) => f.endsWith(".md"))) return true;
        // Maven layout (B4): the `.md` live one level deeper, under
        // `assetspaces/<owner>/<repo>/` — scan the owner folder's children too.
        for (const sub of inner.folders) {
          try {
            const deep = await this.d.listFolder(sub);
            if (deep.files.some((f) => f.endsWith(".md"))) return true;
          } catch {
            // Unreadable nested subfolder — ignore, keep scanning.
          }
        }
      } catch {
        // Unreadable subfolder — ignore, keep scanning.
      }
    }
    return false;
  }

  private async runOnMaterialized(): Promise<void> {
    if (this.d.onMaterialized === undefined) return;
    try {
      await this.d.onMaterialized();
    } catch {
      // Best-effort re-index; failure must not surface as a bootstrap error.
    }
  }

  /**
   * Surface a durable result panel (RFC 0002 §3.3 / P5). Best-effort — when no
   * `showResult` is wired (CLI / tests that don't need it) or it throws, the
   * command still completes; the toast already carried the feedback.
   */
  private emitResult(result: BootstrapResultInfo): void {
    if (this.d.showResult === undefined) return;
    try {
      this.d.showResult(result);
    } catch {
      // The durable panel is additive; a render failure must not surface as a
      // bootstrap error (the toast + activity log already recorded the outcome).
    }
  }

  /**
   * Emit a durable FAILURE result (RFC 0002 §3.10, resolves P15b) — classifies
   * the error (or uses an explicit `causeOverride` when the cause is already
   * known, e.g. URL validation) and routes it through the same durable panel as
   * success outcomes, so a pull failure surfaces "what went wrong + how to
   * recover" persistently rather than only via the transient toast. Best-effort
   * via {@link emitResult}.
   */
  private emitFailure(
    operation: BootstrapOperation,
    error: unknown,
    causeOverride?: BootstrapFailureCause,
  ): void {
    this.emitResult({
      kind: "failed",
      operation,
      cause: causeOverride ?? classifyBootstrapFailure(error),
      detail: this.msg(error),
    });
  }

  /**
   * List the tracked AssetSpaces (path, url) via whichever strategy is wired —
   * the cross-platform {@link IRestBootstrapMount} (RFC 0005 Phase 1: filesystem
   * folder enumeration + `deriveUrl`, no `.gitmodules`) or the desktop
   * {@link IGitSubmoduleOps} (reads the committed `.gitmodules` of a git vault,
   * Node fs). Throws if neither is wired.
   */
  private async listTrackedEntries(): Promise<
    Array<{ submodulePath: string; url: string }>
  > {
    if (this.d.restMount !== undefined) {
      // RFC 0005 Phase 1 — git-free vaults track AssetSpaces by folder presence,
      // not `.gitmodules`: enumerate the mounted folders + derived URLs.
      return this.d.restMount.listMountedAssetSpaces();
    }
    if (this.d.gitOps !== undefined) {
      return this.d.gitOps.readGitmodulesEntries();
    }
    throw new Error(
      "BootstrapAssetSpaceCommands: neither restMount (mobile) nor gitOps (desktop) wired",
    );
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Last path segment of a `/`-delimited vault path (`"assetspaces/exo"` → `"exo"`). */
function basename(p: string): string {
  const norm = p.replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return idx < 0 ? norm : norm.slice(idx + 1);
}

/**
 * Classify a Bootstrap / Add failure into a {@link BootstrapFailureCause}
 * (RFC 0002 §3.10, resolves P15b) for the durable result panel. Pure (string
 * pattern-match over the error message) so the per-cause routing is
 * unit-testable in isolation. Order matters — auth (HTTP status) is checked
 * before the generic patterns so an "HTTP 403" never falls through to
 * `unknown`.
 *
 * The HTTP-status detection mirrors the core `isAuthError` contract
 * (`GitHub request {METHOD} {url} → HTTP {status}: {body}`): 401, or 403 WITHOUT
 * rate-limit markers (a 403 + "rate limit"/"abuse detection" is throttling, not
 * auth). A private-repo 404 from an under-scoped fine-grained PAT is GitHub's
 * existence-hiding behaviour — for a new tester far more often a token-scope
 * problem than a typo, so it routes to the auth recovery copy (which also says
 * "or check the URL").
 */
export function classifyBootstrapFailure(
  error: unknown,
): BootstrapFailureCause {
  const msg = error instanceof Error ? error.message : String(error);
  if (/HTTP 401/.test(msg)) return "auth";
  if (
    /HTTP 403/.test(msg) &&
    !/rate limit/i.test(msg) &&
    !/abuse detection/i.test(msg)
  ) {
    return "auth";
  }
  if (/HTTP 404/.test(msg)) return "auth";
  if (
    /invalid (github repo )?url|could not derive folder|path-traversal|extra path segments/i.test(
      msg,
    )
  ) {
    return "bad-url";
  }
  if (
    /network|offline|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timed ?out|fetch failed|getaddrinfo|request failed|net::/i.test(
      msg,
    )
  ) {
    return "network";
  }
  return "unknown";
}

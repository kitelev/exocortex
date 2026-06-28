/**
 * RegisterForSyncCommand — «Exocortex: Register for sync» palette logic (Issue
 * #3707).
 *
 * A knowledge pack added via «Add a knowledge pack» (tarball mount, RFC 0005
 * Phase 1) materialises at `assetspaces/<owner>/<repo>` but carries NO
 * `exo__AssetSpace` descriptor of its own, so ExoSync's class-based discovery
 * ({@link collectSyncRepoSpecs}) never enumerates it into the materialised sync
 * set — the user's edits in it silently do not sync (surfaced only as a
 * `mountedNotDeclared` notice, FINDING-3). This command closes that gap: it
 * writes a UID-named `exo__AssetSpace` descriptor INTO the pack folder
 * ({@link buildAssetSpaceDescriptor}) so discovery starts tracking it.
 *
 * Pure logic — does NOT import Obsidian's Modal / Plugin / vault runtime.
 * Everything platform-specific (pack enumeration, the descriptor write, the
 * ownership probe, the picker / URL prompt modals) is injected via
 * {@link RegisterForSyncDeps} so the class is fully unit-testable with fakes.
 * Real wiring lives in `ExocortexPlugin`.
 *
 * Desktop↔Mobile Command Parity (CLAUDE.md invariant): the descriptor write is a
 * single `vault.adapter.write` (injected) — NO Node `fs` / git — so the command
 * registers UNCONDITIONALLY on both platforms; the same code path runs on iOS.
 */

import {
  buildAssetSpaceDescriptor,
  deriveUrl,
  type YamlCodec,
} from "@kitelev/exocortex-core";

/** Resolved ownership of a pack — drives the honest pull-only-vs-push notice. */
export type PackOwnership = "owned" | "read-only" | "unknown";

export interface RegisterForSyncDeps {
  /**
   * Mount folders (`assetspaces/<owner>/<repo>`) present on disk but carrying NO
   * `exo__AssetSpace` descriptor — the registrable set
   * (`collectSyncRepoSpecs(app).mountedNotDeclared`).
   */
  listUnregisteredPacks: () => Promise<string[]>;
  /**
   * Pick a pack when several are unregistered. Resolves the chosen mount path,
   * or `null` if the user cancelled. Unused when exactly one pack is registrable.
   */
  pickPack?: (mountPaths: string[]) => Promise<string | null>;
  /**
   * Prompt for the source URL when the mount path is NOT URL-derivable (a legacy
   * flat folder `assetspaces/<name>` rather than the canonical Maven layout).
   * Resolves the entered URL, or `null` if cancelled.
   */
  promptSourceUrl?: (mountPath: string) => Promise<string | null>;
  /**
   * Probe the GitHub PAT's push access for the pack's repo: `true` = owned
   * (round-trip pull+push), `false` = read-only / foreign (pull-only), `null` =
   * unknown (no token / probe failed). Best-effort — never throws into the flow.
   */
  probeOwnership?: (sourceUrl: string) => Promise<boolean | null>;
  /** True when the pack already has an `exo__AssetSpace` descriptor (double-register guard). */
  hasDescriptor?: (mountPath: string) => Promise<boolean>;
  /** Fresh UUID for the descriptor asset (platform RNG). */
  newUid: () => string;
  /** Current ISO-8601 timestamp. */
  now: () => string;
  /** YAML codec used to serialise the descriptor frontmatter (same one the engine uses). */
  codec: YamlCodec;
  /** Write `<mountPath>/<fileName>` with `content` (production: `vault.adapter.write`). */
  writeDescriptor: (
    mountPath: string,
    fileName: string,
    content: string,
  ) => Promise<void>;
  /** User-facing Notice. */
  notify: (message: string) => void;
  /** Optional incremental reindex after the write so the pack appears immediately (best-effort). */
  onMaterialized?: () => Promise<void>;
}

export class RegisterForSyncCommand {
  private readonly d: RegisterForSyncDeps;

  constructor(deps: RegisterForSyncDeps) {
    this.d = deps;
  }

  /** `Exocortex: Register for sync`. */
  async invoke(): Promise<void> {
    let packs: string[];
    try {
      packs = await this.d.listUnregisteredPacks();
    } catch (e) {
      this.d.notify(
        `Register for sync: could not inspect mounted packs — ${msg(e)}`,
      );
      return;
    }
    if (packs.length === 0) {
      this.d.notify(
        "Register for sync: every mounted knowledge pack is already registered for sync — nothing to do.",
      );
      return;
    }

    // Pick the pack: one → use it; many → the injected picker (null = cancel).
    let mountPath: string;
    if (packs.length === 1) {
      mountPath = packs[0];
    } else if (this.d.pickPack !== undefined) {
      const chosen = await this.d.pickPack(packs);
      if (chosen === null) return; // user cancelled
      mountPath = chosen;
    } else {
      this.d.notify(
        `Register for sync: ${packs.length} unregistered packs found but no picker is available.`,
      );
      return;
    }

    // Double-register guard — if a descriptor already exists, do nothing.
    if (this.d.hasDescriptor !== undefined) {
      try {
        if (await this.d.hasDescriptor(mountPath)) {
          this.d.notify(
            `Register for sync: ${mountPath} already has a descriptor — it should already sync.`,
          );
          return;
        }
      } catch {
        // Probe failure → fall through and let the write proceed (best-effort).
      }
    }

    // Resolve the source URL: auto-fill from the Maven mount path; prompt only
    // when un-derivable (legacy flat folder).
    let sourceUrl = deriveUrl(mountPath);
    if (sourceUrl === null) {
      if (this.d.promptSourceUrl === undefined) {
        this.d.notify(
          `Register for sync: cannot derive a GitHub URL from ${mountPath}, and no URL prompt is available.`,
        );
        return;
      }
      const entered = await this.d.promptSourceUrl(mountPath);
      if (entered === null) return; // user cancelled
      sourceUrl = entered;
    }

    // Build the descriptor (pure). null ⇒ source is not a plain GitHub URL.
    const uid = this.d.newUid();
    const descriptor = buildAssetSpaceDescriptor({
      uid,
      sourceUrl,
      createdAt: this.d.now(),
    });
    if (descriptor === null) {
      this.d.notify(
        `Register for sync: ${sourceUrl} is not a plain https://github.com/<owner>/<repo> URL — cannot register.`,
      );
      return;
    }

    // Ownership probe (best-effort) — decides the honest push-vs-pull-only notice.
    let ownership: PackOwnership = "unknown";
    if (this.d.probeOwnership !== undefined) {
      try {
        const push = await this.d.probeOwnership(sourceUrl);
        ownership =
          push === true ? "owned" : push === false ? "read-only" : "unknown";
      } catch {
        ownership = "unknown";
      }
    }

    // Write the descriptor INTO the pack folder (vault.adapter — cross-platform).
    const content = `---\n${this.d.codec.stringify(descriptor.frontmatter)}---\n\n${descriptor.body}\n`;
    try {
      await this.d.writeDescriptor(mountPath, descriptor.fileName, content);
    } catch (e) {
      this.d.notify(
        `Register for sync: could not write the descriptor into ${mountPath} (folder not writable?) — ${msg(e)}`,
      );
      return;
    }

    // Incremental reindex so the pack appears in the sync set immediately (the
    // «won't sync» state clears). Best-effort.
    await this.runOnMaterialized();

    const label = descriptor.frontmatter["exo__Asset_label"];
    const name = typeof label === "string" ? label : mountPath;
    const base = `Registered ${name} for sync.`;
    switch (ownership) {
      case "owned":
        this.d.notify(`${base} Your edits in it will now pull AND push.`);
        break;
      case "read-only":
        this.d.notify(
          `${base} You don't have write access to this pack — it is registered pull-only: your edits won't push, and the registration won't round-trip to a fresh device.`,
        );
        break;
      case "unknown":
        this.d.notify(
          `${base} Set a GitHub token in settings to enable push — without write access, edits are pull-only.`,
        );
        break;
    }
  }

  private async runOnMaterialized(): Promise<void> {
    if (this.d.onMaterialized === undefined) return;
    try {
      await this.d.onMaterialized();
    } catch {
      // Best-effort re-index; a failure must not surface as a registration error.
    }
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

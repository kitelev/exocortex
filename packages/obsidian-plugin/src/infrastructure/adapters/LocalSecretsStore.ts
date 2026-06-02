import type { App } from "obsidian";

/**
 * LocalSecretsStore — device-local secrets persistence layer для RFC 0a0791c1
 * §B.8 + Vision Lock #1 + Security #1.
 *
 * Why a separate file (not Obsidian Plugin's standard \`data.json\`):
 *
 * Obsidian Sync replicates plugin \`data.json\` across devices. Storing a
 * GitHub PAT там means the PAT travels through Sync's network + storage
 * — violation of Vision Lock #1 «PAT в data.local.json only».
 *
 * \`data.local.json\` lives at \`.obsidian/plugins/exocortex/data.local.json\`,
 * which Obsidian Sync EXCLUDES by convention (любые \`.local.json\` files).
 * Verified empirically: Obsidian Sync's exclude rules treat \`.local.\` infix
 * as device-only.
 *
 * Reads tolerate missing file (returns empty record). Writes create the file
 * с pretty-printed JSON. Path resolves relative to vault root through
 * \`app.vault.adapter\`, identical к how Plugin manages \`data.json\`.
 */

export interface LocalSecretsStoreOptions {
  app: App;
  /**
   * Path relative to vault root. Default uses Obsidian's runtime
   * `vault.configDir` (typically `.obsidian/`) joined с
   * `plugins/exocortex/data.local.json`.
   *
   * Override only для tests или per-plugin-id customization.
   */
  path?: string;
  /**
   * Plugin id used to build the default sub-path under \`configDir/plugins/\`.
   * Default `"exocortex"`.
   */
  pluginId?: string;
}

export class LocalSecretsStore {
  private readonly app: App;
  private readonly path: string;

  constructor(options: LocalSecretsStoreOptions) {
    this.app = options.app;
    if (options.path !== undefined) {
      this.path = options.path;
    } else {
      // Obsidian config dir is user-configurable; use the runtime value
      // (per `obsidianmd/hardcoded-config-path` eslint guidance).
      const configDir = options.app.vault.configDir;
      const pluginId = options.pluginId ?? "exocortex";
      this.path = `${configDir}/plugins/${pluginId}/data.local.json`;
    }
  }

  /**
   * Read the secrets file. Returns \`{}\` when the file is absent или
   * unparseable — callers should not surface this as an error, since a
   * fresh install legitimately has no secrets yet.
   *
   * Filters to string values only — non-string keys (e.g. PluginLocalDataStore's
   * boolean `_switchInProgress` co-living в the same file) are NOT visible to
   * secret-reading consumers. Internal persistence preserves them via
   * {@link readAllRaw}; see Issue #3327 Item #3 для the cross-store rationale.
   */
  async readAll(): Promise<Record<string, string>> {
    const all = await this.readAllRaw();
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (typeof v === "string") result[k] = v;
    }
    return result;
  }

  /** Get a single secret by key. Returns null if missing or non-string. */
  async getSecret(key: string): Promise<string | null> {
    const all = await this.readAll();
    return key in all ? all[key] : null;
  }

  /**
   * Set or clear a single secret. Passing an empty string или null deletes
   * the entry (avoid trailing empty-PAT junk in the file).
   *
   * Read-modify-write preserves all keys (including non-string ones written
   * by sibling stores like `PluginLocalDataStore`). Prior to Issue #3327
   * Item #3 fix, `readAll()`-based RMW silently stripped non-string keys —
   * deterministic data loss for booleans (`_switchInProgress`).
   */
  async setSecret(key: string, value: string | null): Promise<void> {
    const all = await this.readAllRaw();
    if (value === null || value === "") {
      delete all[key];
    } else {
      all[key] = value;
    }
    await this.persist(all);
  }

  /**
   * Remove all stored SECRETS. Preserves non-secret keys written by sibling
   * stores (e.g. `PluginLocalDataStore`). To wipe the entire file, callers
   * should also clear those stores explicitly.
   */
  async clearAll(): Promise<void> {
    const all = await this.readAllRaw();
    // Strip string-valued keys (secrets), preserve others.
    const preserved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(all)) {
      if (typeof v !== "string") preserved[k] = v;
    }
    await this.persist(preserved);
  }

  /**
   * Render a masked view of the secret value — used for «PAT field shows
   * `********`-style placeholder» в UI без leaking length precisely.
   */
  static mask(value: string | null): string {
    if (!value) return "";
    if (value.length <= 8) return "*".repeat(value.length);
    // Show last 4 chars (e.g. `***********xyz1`) so user can identify
    // which PAT is stored without revealing the body.
    return "*".repeat(Math.max(8, value.length - 4)) + value.slice(-4);
  }

  /**
   * Internal — read the raw file preserving all key types (string + sibling-
   * store-written non-strings). Used by `setSecret` / `clearAll` для
   * lossless RMW.
   */
  private async readAllRaw(): Promise<Record<string, unknown>> {
    try {
      const exists = await this.app.vault.adapter.exists(this.path);
      if (!exists) return {};
      const raw = await this.app.vault.adapter.read(this.path);
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      return { ...(parsed as Record<string, unknown>) };
    } catch {
      return {};
    }
  }

  private async persist(all: Record<string, unknown>): Promise<void> {
    const json = JSON.stringify(all, null, 2);
    await this.app.vault.adapter.write(this.path, json);
  }
}

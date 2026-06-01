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
   */
  async readAll(): Promise<Record<string, string>> {
    try {
      const exists = await this.app.vault.adapter.exists(this.path);
      if (!exists) return {};
      const raw = await this.app.vault.adapter.read(this.path);
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") result[k] = v;
      }
      return result;
    } catch {
      return {};
    }
  }

  /** Get a single secret by key. Returns null if missing or non-string. */
  async getSecret(key: string): Promise<string | null> {
    const all = await this.readAll();
    return key in all ? all[key] : null;
  }

  /**
   * Set or clear a single secret. Passing an empty string или null deletes
   * the entry (avoid trailing empty-PAT junk in the file).
   */
  async setSecret(key: string, value: string | null): Promise<void> {
    const all = await this.readAll();
    if (value === null || value === "") {
      delete all[key];
    } else {
      all[key] = value;
    }
    await this.persist(all);
  }

  /** Remove all stored secrets. Used by «Clear secrets» action в UI. */
  async clearAll(): Promise<void> {
    await this.persist({});
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

  private async persist(all: Record<string, string>): Promise<void> {
    const json = JSON.stringify(all, null, 2);
    await this.app.vault.adapter.write(this.path, json);
  }
}

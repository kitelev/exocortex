import type { App } from "obsidian";
import type { IFile } from "@kitelev/exocortex-core";
import type { ITargetResolver } from "@kitelev/exocortex-services";
import type { ObsidianVaultAdapter } from "../../adapters/ObsidianVaultAdapter";

/**
 * Obsidian-aware `ITargetResolver` for the shared
 * `@kitelev/exocortex-services` factories (RFC 94e520da Phase 1, T1.3).
 *
 * The plugin's `service_call` groundings receive `targetIRI` in three shapes
 * depending on caller (button click, dyncommand exec, internal):
 *   1. `obsidian://vault/<encoded-path>` URI — decoded and resolved as path.
 *   2. `exo__Asset_uid` value (e.g. UUID) — looked up via metadataCache scan.
 *   3. `@id` JSON-LD identifier — same scan, different field.
 *
 * The CLI runtime in contrast always passes a vault-relative path
 * (without `.md`) — see `createPathBasedTargetResolver`. Keeping resolution
 * pluggable lets both runtimes share the factories without hard-coding either
 * IRI dialect.
 *
 * Behavior is byte-identical to the legacy private `resolveFilePath` /
 * `resolveIFile` helpers in `ServiceRegistryPopulator` so plugin tests pass
 * without modification.
 */
export function createObsidianTargetResolver(
  app: App,
  vaultAdapter: ObsidianVaultAdapter,
): ITargetResolver {
  return {
    resolveFile(targetIRI: string): IFile {
      const filePath = resolveFilePath(app, targetIRI);
      const candidate = vaultAdapter.getAbstractFileByPath(filePath);
      if (!candidate || !("basename" in candidate)) {
        throw new Error(`Cannot resolve IFile for path: ${filePath}`);
      }
      return candidate as IFile;
    },
  };
}

function resolveFilePath(app: App, targetIRI: string): string {
  if (targetIRI.startsWith("obsidian://vault/")) {
    const decoded = decodeURIComponent(
      targetIRI.replace("obsidian://vault/", ""),
    );
    const file = app.vault.getAbstractFileByPath(decoded);
    if (file) return decoded;
  }

  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.exo__Asset_uid === targetIRI) {
      return file.path;
    }
    const iri = cache?.frontmatter?.["@id"];
    if (iri === targetIRI) {
      return file.path;
    }
  }
  throw new Error(`No file found for IRI: ${targetIRI}`);
}

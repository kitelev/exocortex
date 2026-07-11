import {
  WikiLinkHelpers,
  DateFormatter,
  iriToVaultPath,
  FrontmatterService,
} from "@kitelev/exocortex-core";
import type {
  ClassRefResolver,
  IGroundingService,
  IVaultAdapter,
  IFile,
  IFileSystemReader,
  IFileSystemWriter,
  UserInput,
  GenericAssetCreationService,
  ArchiveAssetService,
  TaskStatusService,
  PropertyCleanupService,
  FixMissingLabelService,
  RenameToUidService,
  FolderRepairService,
} from "@kitelev/exocortex-core";

/**
 * Shared, storage-agnostic grounding-service factories used by both the CLI
 * (`packages/cli/src/services/CliServiceRegistryPopulator.ts`) and the plugin
 * (`packages/obsidian-plugin/src/infrastructure/services/ServiceRegistryPopulator.ts`).
 *
 * Each factory returns an `IGroundingService` that adapts a domain service
 * (already lives in the shared `exocortex` package) to the runtime-agnostic
 * `service_call` contract dispatched by `GroundingExecutor`. All filesystem
 * access goes through `IVaultAdapter`, so plugin (Obsidian) and CLI (Node fs)
 * runtimes produce byte-identical state changes for the same input.
 *
 * Target-IRI → IFile resolution is delegated to the optional
 * `ITargetResolver` parameter. The CLI default path-based resolver strips
 * the `obsidian://vault/<encoded-path>` URI scheme via the canonical
 * `iriToVaultPath` helper (Issue #3301) and appends `.md` only when not
 * already present; the Obsidian plugin injects an Obsidian-aware resolver
 * that additionally scans `metadataCache` for `exo__Asset_uid` / `@id`
 * matches.
 *
 * RFC 94e520da Phase 1, T1.2 (factories) + T1.3 (plugin migration).
 */

export interface ITargetResolver {
  resolveFile(targetIRI: string): IFile;
}

export function createPathBasedTargetResolver(
  vaultAdapter: IVaultAdapter,
): ITargetResolver {
  return {
    resolveFile(targetIRI: string): IFile {
      // `iriToVaultPath` returns null when the input either lacks the
      // `obsidian://vault/` prefix (a plain vault-relative path) OR carries
      // a malformed percent-escape sequence (URIError → null). In both
      // cases we fall back to the raw IRI: a plain path is what the
      // resolver always accepted, and a malformed-URI lookup will miss
      // disk and surface as the consistent "Cannot resolve target file"
      // error below rather than a raw URIError stack trace.
      const stripped = iriToVaultPath(targetIRI) ?? targetIRI;
      const candidatePath = stripped.endsWith(".md")
        ? stripped
        : `${stripped}.md`;
      const candidate = vaultAdapter.getAbstractFileByPath(candidatePath);
      if (!candidate || !("basename" in candidate)) {
        throw new Error(`Cannot resolve target file for IRI: ${targetIRI}`);
      }
      return candidate as IFile;
    },
  };
}

/**
 * Optional post-create hook used by the obsidian-plugin thin wrapper
 * (Phase 4b) to focus the new asset in a workspace tab. CLI runtimes
 * omit this parameter; behavior is unchanged for those callers.
 */
export type OnCreatedCallback = (file: IFile) => Promise<void>;

/**
 * Default `ClassRefResolver` used when CLI callers don't supply one. The
 * legacy plugin path resolved UID-canon `[[<uuid>]]` references through
 * Obsidian's `metadataCache`; in CLI runtime there is no resolver, so this
 * fallback returns `null` for every UUID. Symbolic refs (`[[ems__Area]]`)
 * continue to round-trip through `WikiLinkHelpers.resolveSymbolic` without
 * resolver assistance.
 */
const NULL_CLASS_RESOLVER: ClassRefResolver = () => null;

/**
 * Format a wikilink value as the quoted YAML form (`"[[X]]"`) consistently with
 * the plugin's hand-rolled `createAsset` frontmatter writer
 * (`ServiceRegistryPopulator.toQuotedWikilink`). Idempotent — already-quoted
 * inputs round-trip unchanged; bare/unwrapped values are re-wrapped.
 */
function toQuotedWikilink(value: string): string {
  if (value.startsWith('"[[') && value.endsWith(']]"')) return value;
  if (value.startsWith("[[") && value.endsWith("]]")) return `"${value}"`;
  return `"[[${value}]]"`;
}

export function createCreateRelatedTaskService(
  vaultAdapter: IVaultAdapter,
  genericAssetCreationService: GenericAssetCreationService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
  onCreated?: OnCreatedCallback,
  classResolver: ClassRefResolver = NULL_CLASS_RESOLVER,
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const label = userInput?.label as string | undefined;
      if (!label) {
        throw new Error("createRelatedTask requires userInput.label");
      }

      const parentFile = resolver.resolveFile(targetIRI);
      const parentMetadata =
        (vaultAdapter.getFrontmatter(parentFile) as Record<string, unknown>) ??
        {};
      const folderPath = parentFile.parent?.path || "";

      // UUID-form per RFC 31c1a0be Phase 4 PR-C (#3194). Draft UUID is the
      // canonical TBox identifier at
      // assetspaces/ems/c42245d0-01de-4c35-bfcf-d910445ea28e.md. Mirrors the
      // obsidian-plugin ServiceRegistryPopulator default-write migration.
      const propertyValues: Record<string, unknown> = {
        ems__Effort_status:
          '"[[c42245d0-01de-4c35-bfcf-d910445ea28e]]"',
      };

      const explicitParentProperty = userInput?.parentProperty as
        | string
        | undefined;
      if (explicitParentProperty && parentFile.basename) {
        propertyValues[explicitParentProperty] = `"[[${parentFile.basename}]]"`;
      }

      const createdFile = await genericAssetCreationService.createAsset({
        className: "ems__Task",
        label,
        folderPath,
        propertyValues,
        parentFile,
        parentMetadata,
        classResolver,
      });

      if (onCreated) {
        await onCreated(createdFile);
      }
    },
  };
}

export function createCreateRelatedProjectService(
  vaultAdapter: IVaultAdapter,
  genericAssetCreationService: GenericAssetCreationService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
  onCreated?: OnCreatedCallback,
  classResolver: ClassRefResolver = NULL_CLASS_RESOLVER,
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const label = userInput?.label as string | undefined;
      if (!label) {
        throw new Error("createRelatedProject requires userInput.label");
      }

      const parentFile = resolver.resolveFile(targetIRI);
      const parentMetadata =
        (vaultAdapter.getFrontmatter(parentFile) as Record<string, unknown>) ??
        {};
      const folderPath = parentFile.parent?.path || "";

      // UUID-form per RFC 31c1a0be Phase 4 PR-C (#3194). Draft UUID is the
      // canonical TBox identifier at
      // assetspaces/ems/c42245d0-01de-4c35-bfcf-d910445ea28e.md. Mirrors the
      // obsidian-plugin ServiceRegistryPopulator default-write migration.
      const propertyValues: Record<string, unknown> = {
        ems__Effort_status:
          '"[[c42245d0-01de-4c35-bfcf-d910445ea28e]]"',
      };

      const explicitParentProperty = userInput?.parentProperty as
        | string
        | undefined;
      if (explicitParentProperty && parentFile.basename) {
        propertyValues[explicitParentProperty] = `"[[${parentFile.basename}]]"`;
      }

      const createdFile = await genericAssetCreationService.createAsset({
        className: "ems__Project",
        label,
        folderPath,
        propertyValues,
        parentFile,
        parentMetadata,
        classResolver,
      });

      if (onCreated) {
        await onCreated(createdFile);
      }
    },
  };
}

/**
 * Shared factory for the `createAsset` `service_call` grounding — ports the
 * inlined plugin handler (`ServiceRegistryPopulator.ts:126-275`) onto the
 * storage-agnostic `IVaultAdapter` + `IFileSystemWriter` contract so the CLI
 * registry can reuse the same logic via `populateCliServiceRegistry`.
 *
 * Behaviour mirrors the plugin handler one-for-one:
 *
 * 1. Accepts `prototypeUID` (or legacy `prototype`) + `label`; folder defaults
 *    to the parent file's folder when omitted.
 * 2. Reads parent metadata via `vaultAdapter.getFrontmatter` to inherit
 *    `ems__Effort_area`/`ems__Effort_parent` (auto-detected from parent class),
 *    `ems__Effort_status: "[[ems__EffortStatusBacklog]]"`, and
 *    `exo__Asset_isDefinedBy` when not explicitly overridden by the caller.
 * 3. Writes the new asset as `<folder>/<uid>.md` via `fsAdapter.createFile`.
 *
 * Precedence chain for `exo__Asset_isDefinedBy` (highest first), preserved
 * from the plugin:
 * - `userInput.isDefinedBy` (explicit grounding override).
 * - Parent's `exo__Asset_isDefinedBy` (inherited).
 * - `userInput.ownerIdentity` (vault-default owner fallback, see RFC `1429fcd0`).
 *
 * Phase 3.5 (RFC v2, Issue #3164) — CLI parity port. Phase 4b will remove
 * both this factory and the plugin's parallel handler once vault Groundings
 * migrate from `service_call createAsset` to declarative `create_instance`.
 */
export function createCreateAssetService(
  vaultAdapter: IVaultAdapter,
  fsAdapter: IFileSystemWriter,
  classResolver: ClassRefResolver = NULL_CLASS_RESOLVER,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const prototypeUID =
        (userInput?.prototypeUID as string | undefined) ??
        (userInput?.prototype as string | undefined);
      const label = userInput?.label as string | undefined;
      let folder = userInput?.folder as string | undefined;
      const ownerIdentity = userInput?.ownerIdentity as string | undefined;
      const explicitIsDefinedBy = userInput?.isDefinedBy as string | undefined;

      if (!prototypeUID) {
        throw new Error("createAsset requires userInput.prototypeUID");
      }
      if (!label) {
        throw new Error("createAsset requires userInput.label");
      }

      let parentPath: string | undefined;
      let parentMetadata: Record<string, unknown> | undefined;
      if (targetIRI) {
        try {
          const parentFile = resolver.resolveFile(targetIRI);
          parentPath = parentFile.path;
          parentMetadata =
            (vaultAdapter.getFrontmatter(parentFile) as
              | Record<string, unknown>
              | null) ?? undefined;
        } catch {
          // Mirrors plugin: IRI resolution failure is non-fatal — folder
          // resolution falls back to `userInput.folder` and parent inheritance
          // is skipped entirely.
        }
      }

      if (!folder && parentPath) {
        const lastSlash = parentPath.lastIndexOf("/");
        folder = lastSlash >= 0 ? parentPath.substring(0, lastSlash) : "";
      }
      if (folder === undefined) {
        throw new Error("createAsset requires userInput.folder");
      }

      const expectedClass = prototypeUID.endsWith("Prototype")
        ? prototypeUID.slice(0, -"Prototype".length)
        : prototypeUID;

      const uid = crypto.randomUUID();
      const createdAt = DateFormatter.toISOTimestamp(new Date());
      const fileName = `${uid}.md`;
      const filePath = folder ? `${folder}/${fileName}` : fileName;

      const lines: string[] = [
        "---",
        `exo__Asset_uid: ${uid}`,
        `exo__Asset_createdAt: ${createdAt}`,
        `exo__Asset_label: ${label}`,
        `exo__Asset_prototype: "[[${prototypeUID}]]"`,
        "exo__Instance_class:",
        `  - "[[${expectedClass}]]"`,
      ];

      let isDefinedByWritten = false;
      if (explicitIsDefinedBy) {
        lines.push(
          `exo__Asset_isDefinedBy: ${toQuotedWikilink(explicitIsDefinedBy)}`,
        );
        isDefinedByWritten = true;
      }

      if (parentMetadata) {
        const parentClass = parentMetadata.exo__Instance_class;
        const parentClasses = Array.isArray(parentClass)
          ? parentClass
          : parentClass != null
            ? [parentClass]
            : [];
        const isAreaParent = parentClasses.some((cls) =>
          WikiLinkHelpers.resolveSymbolic(String(cls), classResolver).includes(
            "Area",
          ),
        );
        const parentBasename = parentPath
          ? parentPath
              .substring(parentPath.lastIndexOf("/") + 1)
              .replace(/\.md$/, "")
          : undefined;
        if (parentBasename) {
          const parentProperty = isAreaParent
            ? "ems__Effort_area"
            : "ems__Effort_parent";
          lines.push(`${parentProperty}: "[[${parentBasename}]]"`);
        }
        if (!isAreaParent && parentMetadata.ems__Effort_area) {
          lines.push(
            `ems__Effort_area: ${toQuotedWikilink(
              String(parentMetadata.ems__Effort_area),
            )}`,
          );
        }
        // UUID-form per RFC 31c1a0be Phase 4 PR-C (#3194). Mirrors plugin's
        // `ServiceRegistryPopulator.createAsset` line 253-255; CLI must emit
        // the same UID so backlinks resolve uniformly with the rest of the
        // graph (avoid the 42-asset symbolic-form trace the prior RFC closed).
        lines.push(
          'ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]"',
        );
        if (!isDefinedByWritten && parentMetadata.exo__Asset_isDefinedBy) {
          lines.push(
            `exo__Asset_isDefinedBy: ${toQuotedWikilink(
              String(parentMetadata.exo__Asset_isDefinedBy),
            )}`,
          );
          isDefinedByWritten = true;
        }
      }

      if (!isDefinedByWritten && ownerIdentity) {
        lines.push(
          `exo__Asset_isDefinedBy: ${toQuotedWikilink(ownerIdentity)}`,
        );
      }

      lines.push("---", "");
      const frontmatter = lines.join("\n");
      await fsAdapter.createFile(filePath, frontmatter);
    },
  };
}

export function createArchiveAssetService(
  vaultAdapter: IVaultAdapter,
  archiveAssetService: ArchiveAssetService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      await archiveAssetService.archiveAsset(targetFile);
    },
  };
}

export function createCleanPropertiesService(
  vaultAdapter: IVaultAdapter,
  propertyCleanupService: PropertyCleanupService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      await propertyCleanupService.cleanEmptyProperties(targetFile);
    },
  };
}

export function createFixMissingLabelService(
  vaultAdapter: IVaultAdapter,
  fixMissingLabelService: FixMissingLabelService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      await fixMissingLabelService.fixMissingLabel(targetFile);
    },
  };
}

export function createRenameToUidService(
  vaultAdapter: IVaultAdapter,
  renameToUidService: RenameToUidService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      const metadata =
        (vaultAdapter.getFrontmatter(targetFile) as Record<string, unknown>) ??
        {};
      await renameToUidService.renameToUid(targetFile, metadata);
    },
  };
}

/**
 * Read the target asset's frontmatter FRESH from disk (via `vaultAdapter.read`
 * + a lightweight parse), falling back to the cached `getFrontmatter` when the
 * fresh read/parse yields nothing.
 *
 * WHY: `repairFolder` decides the destination folder from
 * `exo__Asset_isDefinedBy`. In the plugin, `vaultAdapter.getFrontmatter` reads
 * `app.metadataCache`, which is re-indexed ASYNCHRONOUSLY after a file write.
 * When `repairFolder` runs as the second step of a composite whose first step
 * just rewrote `isDefinedBy` on disk ("Archive Ontologically"), the cache still
 * holds the OLD ontology → the expected folder resolves to the CURRENT folder →
 * the move is a silent no-op (the file is re-anchored but never relocated).
 * The CLI never hit this because `FileSystemVaultAdapter.getFrontmatter` already
 * reads fresh (`fs.readFileSync`). Reading the on-disk content here makes both
 * runtimes compute the expected folder from the just-written value (req
 * 8efc003c). `parseObject` is the same lightweight parser used vault-wide and
 * only the wikilink-scalar `isDefinedBy` is consumed downstream.
 */
async function readFreshFrontmatter(
  vaultAdapter: IVaultAdapter,
  frontmatter: FrontmatterService,
  file: IFile,
): Promise<Record<string, unknown>> {
  try {
    const content = await vaultAdapter.read(file);
    const parsed = frontmatter.parseObject(content);
    if (parsed) return parsed as Record<string, unknown>;
  } catch {
    // fall through to the cached frontmatter (fresh read unavailable)
  }
  return (vaultAdapter.getFrontmatter(file) as Record<string, unknown>) ?? {};
}

export function createRepairFolderService(
  vaultAdapter: IVaultAdapter,
  folderRepairService: FolderRepairService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  const frontmatter = new FrontmatterService();
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      // Fresh disk read, not the (possibly stale) metadataCache — see
      // readFreshFrontmatter for the composite intra-step lag this fixes.
      const metadata = await readFreshFrontmatter(
        vaultAdapter,
        frontmatter,
        targetFile,
      );
      const expectedFolder = await folderRepairService.getExpectedFolder(
        targetFile,
        metadata,
      );
      if (expectedFolder === null) {
        throw new Error(
          "repairFolder: cannot determine expected folder (missing exo__Asset_isDefinedBy or referenced asset not found)",
        );
      }
      const currentFolder = targetFile.parent?.path ?? "";
      if (currentFolder === expectedFolder) {
        return;
      }
      await folderRepairService.repairFolder(targetFile, expectedFolder);
    },
  };
}

export function createPlanForEveningService(
  vaultAdapter: IVaultAdapter,
  taskStatusService: TaskStatusService,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      const targetFile = resolver.resolveFile(targetIRI);
      await taskStatusService.planForEvening(targetFile);
    },
  };
}

/**
 * Resolves a `service_call` `targetIRI` to a vault-relative file path the
 * `IFileSystemAdapter` can `readFile`/`updateFile`. The plugin scans
 * `app.metadataCache` (UID lookup, `obsidian://vault/` decode); the CLI
 * decodes the `obsidian://vault/<encoded-path>` scheme + falls back to
 * `IFileSystemMetadataProvider.findFileByUID`. This indirection lets shared
 * factories below stay storage-agnostic.
 *
 * RFC 94e520da Phase 1, T1.4 — added when porting the
 * frontmatter-only handlers (`updateProperty`/`removeProperty`/`setStatus`)
 * out of plugin-side inline lambdas into runtime-agnostic factories.
 */
export interface IPathResolver {
  resolveTargetPath(targetIRI: string): Promise<string>;
}

/**
 * Shared factory for the `updateProperty` `service_call` grounding.
 *
 * Reads the target file via `IFileSystemReader.readFile`, applies
 * `FrontmatterService.updateProperty`, writes back via
 * `IFileSystemWriter.updateFile`. Path resolution is delegated to the
 * caller-supplied `IPathResolver` because plugin and CLI runtimes locate
 * a file from a `targetIRI` differently (see interface doc).
 */
export function createUpdatePropertyService(
  fsAdapter: IFileSystemReader & IFileSystemWriter,
  frontmatterService: FrontmatterService,
  pathResolver: IPathResolver,
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const property = userInput?.property as string | undefined;
      const value = userInput?.value;
      if (!property) {
        throw new Error("updateProperty requires userInput.property");
      }
      if (value === undefined) {
        throw new Error("updateProperty requires userInput.value");
      }
      const filePath = await pathResolver.resolveTargetPath(targetIRI);
      const content = await fsAdapter.readFile(filePath);
      const updated = frontmatterService.updateProperty(
        content,
        property,
        value,
      );
      await fsAdapter.updateFile(filePath, updated);
    },
  };
}

/**
 * Shared factory for the `removeProperty` `service_call` grounding.
 *
 * Mirrors {@link createUpdatePropertyService} but applies
 * `FrontmatterService.removeProperty`. No-op if the property is absent.
 */
export function createRemovePropertyService(
  fsAdapter: IFileSystemReader & IFileSystemWriter,
  frontmatterService: FrontmatterService,
  pathResolver: IPathResolver,
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const property = userInput?.property as string | undefined;
      if (!property) {
        throw new Error("removeProperty requires userInput.property");
      }
      const filePath = await pathResolver.resolveTargetPath(targetIRI);
      const content = await fsAdapter.readFile(filePath);
      const updated = frontmatterService.removeProperty(content, property);
      await fsAdapter.updateFile(filePath, updated);
    },
  };
}

/**
 * Shared factory for the `setStatus` `service_call` grounding.
 *
 * Sugar over {@link createUpdatePropertyService}: forces `ems__Effort_status`
 * as the property and quotes `userInput.statusUID` into a wikilink so callers
 * pass the bare UID (e.g. `ems__EffortStatusBacklog`).
 */
export function createSetStatusService(
  fsAdapter: IFileSystemReader & IFileSystemWriter,
  frontmatterService: FrontmatterService,
  pathResolver: IPathResolver,
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      const statusUID = userInput?.statusUID as string | undefined;
      if (!statusUID) {
        throw new Error("setStatus requires userInput.statusUID");
      }
      const filePath = await pathResolver.resolveTargetPath(targetIRI);
      const content = await fsAdapter.readFile(filePath);
      const updated = frontmatterService.updateProperty(
        content,
        "ems__Effort_status",
        `"[[${statusUID}]]"`,
      );
      await fsAdapter.updateFile(filePath, updated);
    },
  };
}

/**
 * Shared factory for the `duplicateAsset` `service_call` grounding (Issue
 * #3292). Creates a byte-verbatim copy of the target asset's file in the same
 * folder with two surgical frontmatter substitutions:
 *
 *  - `exo__Asset_uid`   →   freshly-generated UUID v4
 *  - `exo__Asset_createdAt` → local ISO timestamp (now)
 *
 * Everything else (label, modifiedAt, instance class, relations, prototype,
 * parent, all class-specific properties, the markdown body) is preserved
 * unchanged — including filled checklist items, SPARQL blocks, and trailing
 * whitespace. The new file is named `<new-uid>.md` per the UUID-canon rule.
 *
 * Visibility (when surfaced through `exocmd__Command_paletteEnabled`) is
 * gated by the `hasUidFilename` host-function precondition — palette entry
 * is hidden when the active file isn't itself a UUID-canon Exocortex asset
 * (freeform notes, daily/weekly notes via the `pn__DailyNote` /
 * `period__Week` whitelist, ontology TBox label-named files). See
 * `preconditionHostFunctions.ts:hasUidFilename`.
 *
 * The `onCreated` callback is the Obsidian-specific tab-opening hook
 * (mirrors `createRelatedTask` etc); CLI runtimes can omit it.
 */
export function createDuplicateAssetService(
  vaultAdapter: IVaultAdapter,
  resolver: ITargetResolver = createPathBasedTargetResolver(vaultAdapter),
  onCreated?: OnCreatedCallback,
): IGroundingService {
  return {
    async execute(targetIRI: string): Promise<void> {
      if (!targetIRI) {
        throw new Error(
          "duplicateAsset requires an active target — open an Exocortex asset before invoking",
        );
      }

      const sourceFile = resolver.resolveFile(targetIRI);
      const sourceContent = await vaultAdapter.read(sourceFile);

      const newUid = crypto.randomUUID();
      const newCreatedAt = DateFormatter.toLocalTimestamp(new Date());

      const duplicatedContent = rewriteFrontmatterScalars(sourceContent, {
        exo__Asset_uid: newUid,
        exo__Asset_createdAt: newCreatedAt,
      });

      const folderPath = sourceFile.parent?.path ?? "";
      const newPath = folderPath
        ? `${folderPath}/${newUid}.md`
        : `${newUid}.md`;

      const createdFile = await vaultAdapter.create(newPath, duplicatedContent);

      if (onCreated) {
        await onCreated(createdFile);
      }
    },
  };
}

/**
 * Replace top-level scalar values in a markdown file's leading YAML
 * frontmatter block. Preserves the document byte-for-byte except for the
 * specific keys whose values are rewritten; if a key exists, its line is
 * rewritten in place (preserving leading whitespace) — if absent, a new
 * line is appended just before the closing `---` fence.
 *
 * Pure text manipulation (no YAML parse → serialize) so it does not
 * re-order keys, re-indent lists, collapse comments, or change quoting
 * style anywhere else. Out of scope: nested keys, block scalars, or
 * documents without a leading frontmatter block (caller's responsibility
 * to ensure the input has one).
 *
 * @internal — exported for unit testing only.
 */
export function rewriteFrontmatterScalars(
  content: string,
  replacements: Record<string, string>,
): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    throw new Error(
      "duplicateAsset: source file has no YAML frontmatter block",
    );
  }

  const frontmatterBody = fmMatch[1];
  const remaining = new Map(Object.entries(replacements));

  const rewrittenLines = frontmatterBody.split("\n").map((line) => {
    // Top-level key: optional indent then `key:` then anything after.
    // Skip indented lines (list items, nested mappings) by matching only
    // at column 0.
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (!keyMatch) return line;
    const key = keyMatch[1];
    const newValue = remaining.get(key);
    if (newValue === undefined) return line;
    remaining.delete(key);
    return `${key}: ${newValue}`;
  });

  // Append keys that were not present in the source frontmatter.
  for (const [key, value] of remaining) {
    rewrittenLines.push(`${key}: ${value}`);
  }

  const rewrittenBody = rewrittenLines.join("\n");
  const eol = fmMatch[0].includes("\r\n") ? "\r\n" : "\n";
  const head = `---${eol}${rewrittenBody}${eol}---`;
  return head + content.slice(fmMatch[0].length);
}

import {
  WikiLinkHelpers,
  DateFormatter,
  iriToVaultPath,
  FrontmatterService,
  matchFrontmatterBlock,
  isUnquotedWikilink,
  serializeYamlScalar,
  emptyPropertyValueForm,
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
        throw new Error(
          `updateProperty requires userInput.property — pass it via --input '{"property":"<name>","value":"<value>"}'`,
        );
      }
      if (value === undefined) {
        throw new Error(
          `updateProperty requires userInput.value — pass it via --input '{"value":"<value>"}' (e.g. set-planned-start: --input '{"value":"2026-07-25T09:00:00"}')`,
        );
      }
      // Issue #4513 — the guard above rejects an ABSENT value and says nothing
      // about one that IS the empty string. `""` passed, and
      // `FrontmatterService.updateProperty` wrote it verbatim.
      //
      // ⛤ This is the THIRD writer of the same frontmatter key, and the
      // refusal is PARITY WITH THE OTHER TWO rather than symmetry for its own
      // sake: `cli set-property` refuses an empty value fail-loud
      // (`assertNonEmptyValue`, req 501cdf2c) and so do the `property_set` /
      // `property_append` groundings (#4429, PR #4511). `prop: ""` writes a
      // junk key that LOOKS like a successful clear, and a consumer branching
      // on "does the property exist" then sees it as present-with-an-empty-
      // value. Clearing has its own path (the `removeProperty` service_call /
      // the `remove-property` CLI verb), which the message names.
      //
      // ⛔ Not hypothetical: 8 authored groundings carry
      // `exocmd__Grounding_serviceId: updateProperty` (measured across the
      // three canonical vaults, 2026-10-02). Two of them (`abdbdf09` "Convert
      // to task", `e8c1d18a` "Convert to project") never reach this factory —
      // `GroundingExecutor.executeServiceCall` short-circuits them into the
      // class-flip path. The remaining SIX pin the property in
      // `serviceCallPayload` and take the value from user input
      // (`ems__Effort_result`, `…_startTimestamp`, `…_endTimestamp`,
      // `…_plannedStartTimestamp`, `…_plannedEndTimestamp`,
      // `…_scheduledDate`), so a blank field wrote `prop: ""` on every one of
      // them. There is no legitimate case in the refused set.
      //
      // ⛔ The predicate is STRICT (`=== ""`), NEVER `trim() === ""` — but NOT
      // for the reason the sibling guards give, and the difference was measured
      // here rather than inherited. `property_set`'s comment argues that a
      // trimming predicate would make the live whitespace carriers unwritable;
      // THROUGH THIS FACTORY that argument does not hold, because this path
      // cannot write them in the first place. `updateProperty` calls
      // `serializeValue(property, value)` with the DEFAULT `quoteScalars=false`,
      // so a raw `" "` is emitted as `key: ` + spaces and js-yaml reads it back
      // as **null**, and `" · "` comes back as `"·"` — measured 2026-10-02 by
      // feeding both through the real `FrontmatterService`. The 5 live
      // `exo__DisplayNameSpec_separator` carriers are all in QUOTED form
      // (`" "`, `" · "`), which this serializer cannot emit at all, and a
      // trimming predicate would not have refused `" · "` anyway (three
      // characters, `trim()` non-empty).
      //
      // ⇒ strict stays, on a narrower and true ground: it refuses STRICTLY LESS
      // than a trimming predicate and matches both sibling writers byte for
      // byte, so the three writers of this key cannot disagree on a value.
      //
      // ⛤ THE RESIDUAL HOLE IS NOW CLOSED — req
      // `5d2c7ede-b053-4dac-a667-7c4f5e4b22da` (issue #4516). The predicate
      // moved from a literal `value === ""` to the shared
      // `emptyPropertyValueForm`, which also names `value: []` (writes a BARE
      // `prop:`) and `value: null` (writes `prop: null`). Both are literally
      // the "junk key that looks like a cleared property" this message
      // describes, and `null` is worse than that framing: js-yaml reads it back
      // as null, but `FrontmatterService.parseObject` — the reader on the
      // CLI/loader path — reads the STRING `"null"`, fabricating a literal
      // nobody wrote.
      //
      // ⛔ It was LIVE, and the inflow was measured rather than argued: three
      // instances in 13 days. 4 assets in `exoas-period` carried
      // `exo__DisplayNameSpec_separator: ""` (created 2026-09-20; the loader
      // skipped every one with `Invalid IRI: Literal value cannot be empty`, so
      // four period classes got no displayName while 14 part triples sat in the
      // graph waiting for the spec), and two `exoas-tbank` archived efforts
      // carried a bare `ems__Effort_parent:` — a Done, archived effort with real
      // timestamps that did not exist for the graph at all. The third turned up
      // 2026-10-02, SIX DAYS after #4274 closed.
      //
      // ⛤ SCOPE BOUNDARY vs the founder decision #4274 (2026-09-26, variant 1:
      // repair the data + add visibility, do NOT change the loader): that
      // decision heals what already exists, this guard stops the inflow. They
      // are different SETS, not the same one measured twice — the loader-skip
      // detector catches assets the loader rejects WHOLE (2 files on
      // 2026-10-03), while the 82 bare `key:` carriers the same sweep found are
      // mostly tolerated by it.
      //
      // ⛔ Only TWO of the three writers carry the widened predicate, and the
      // third is excluded by MEASUREMENT, not oversight:
      // `GroundingExecutor.executePropertySet` / `executePropertyAppend` take a
      // `string`-typed value (`substitutedValue: string`,
      // `resolvedValue: string`), so `[]` and `null` cannot reach them and a
      // guard there would be a dead branch under a vacuous axis. `cli
      // set-property` already refused `null` before this req
      // (`assertScalarOrScalarArray`: "not object/null", which runs first) and
      // keeps that more specific message; what it gained is the `[]` case.
      // ⇒ "3 of 3" still holds for the empty-STRING class; for THIS class the
      // honest count is "2 of 2 reachable writers". Count again before widening
      // either claim — both are measurements, not invariants.
      //
      // ⛤ req 501cdf2c's sweep (34 327 files / 331 263 keys) found 0 carriers of
      // `key: ""` on 2026-08-23; the 4 above appeared after it. The number is a
      // dated measurement, not an invariant — re-measure before quoting it.
      const emptyForm = emptyPropertyValueForm(value);
      if (emptyForm !== undefined) {
        throw new Error(
          `updateProperty: the value for ${property} is ${emptyForm} — refusing rather than writing a junk key that looks like a cleared property. To clear it, use the removeProperty service_call (or the remove-property CLI verb).`,
        );
      }
      // Issue #4520 (req 61e3441e) — the sibling-writer half of the #4405 /
      // #4424 truncation class. `FrontmatterService.updateProperty`'s contract
      // is ALREADY-FORMATTED YAML: it writes what it is handed. Until this
      // guard+serialise pair, this factory handed it `userInput.value`
      // verbatim, so a user typing `PR #42 merged` into the modal of a
      // `service_call updateProperty` grounding wrote `prop: PR #42 merged`,
      // which every YAML reader takes as `PR` with ` #42 merged` as a comment.
      // Three shapes are WORSE than truncation — `fix: broken parse`,
      // `- item` and a multi-line value make js-yaml throw on the whole
      // frontmatter BLOCK, so the asset collapses at every read (measured on
      // this tree 2026-10-02 through the real FrontmatterService).
      //
      // ⛔ NO ORIGIN DISCRIMINATOR HERE, and that is measured rather than
      // inherited from #4424. There the same variable carries both an author's
      // YAML (a deliberate flow array) and substituted user text, so the fix
      // had to record WHERE the value came from. On this path it does not:
      // across all three canonical vaults (SPARQL --no-cache, 2026-10-02) the
      // 8 authored groundings with `serviceId: updateProperty` pin ONLY
      // `property` in `serviceCallPayload` — `ems__Effort_result`,
      // `…_startTimestamp`, `…_endTimestamp`, `…_plannedStartTimestamp`,
      // `…_plannedEndTimestamp`, `ems__Effort_scheduledDate` — and two of them
      // (`abdbdf09` Convert-to-task, `e8c1d18a` Convert-to-project) never
      // reach this factory at all, short-circuited by `targetValueRef` in
      // `executeServiceCall`. `value` is caller/user input, full stop, so a
      // `substitutionApplied`-style flag would be a constant here. Copying
      // #4424's shape on the strength of symmetry is the argument that
      // produced too broad a predicate once already
      // (integration-test-revert-verify §A27).
      //
      // ⛔ THE ORDER IS LOAD-BEARING, exactly as it is for req 29e0d1b6 on the
      // `property_set` path: `serializeYamlScalar` quotes a bare `[[uid]]` on
      // its leading `[`, so serialising FIRST would make `isUnquotedWikilink`
      // blind and turn a loud refusal into a silent successful write — the
      // flow-sequence data loss that guard exists to prevent. The refusal also
      // sits with the other input guards, BEFORE the file is resolved or read,
      // so it is total.
      //
      // ⛔ `typeof value === "string"` is load-bearing too, and also measured:
      // `serializeYamlScalar` returns `String(value)` for a non-string, which
      // collapses an ARRAY value from a two-item YAML list to the single line
      // `prop: a,b`. `updateProperty`'s own `serializeValue` already handles
      // `Array.isArray` as a list and non-string scalars via `String()`, so
      // restricting this step to strings keeps arrays, numbers and booleans
      // byte-identical by construction.
      if (typeof value === "string" && isUnquotedWikilink(value)) {
        throw new Error(
          `updateProperty: the value for ${property} is ${value} — an UNQUOTED wikilink. YAML reads it as a flow sequence, so the graph would receive a literal instead of a link (silent data loss). Pass the QUOTED form (the quotes are part of the string, e.g. --input '{"value":"\\"[[<uid>]]\\""}').`,
        );
      }
      const valueToWrite =
        typeof value === "string" ? serializeYamlScalar(value) : value;
      const filePath = await pathResolver.resolveTargetPath(targetIRI);
      const content = await fsAdapter.readFile(filePath);
      const updated = frontmatterService.updateProperty(
        content,
        property,
        valueToWrite,
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
 * A YAML block body's own line boundary — ANY of the three forms the shared
 * predicate accepts at a fence (`\r\n`, a bare `\r`, a bare `\n`).
 *
 * ⛔ Its predecessor was a literal `"\n"` (#4473). On a CRLF block that left
 * every untouched line's `\r` glued to its text while a REWRITTEN line was
 * emitted without one, so the join produced a bare LF immediately after any
 * touched key — a mixed-terminator block from a single `duplicateAsset`. On a
 * lone-CR block (unreachable before this conversion, HOT after it) splitting on
 * `"\n"` finds no boundary at all: the whole body is one "line", its first key
 * matches, and the rewrite would collapse EVERY key into a single line.
 */
const FRONTMATTER_BODY_LINE = /\r\n|\r|\n/;

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
 * ⛔ WITHDRAWN (#4473): the block was recognised by a LOCAL
 * `/^---\r?\n([\s\S]*?)\r?\n---/` and rebuilt by hand
 * (`` `---${eol}${body}${eol}---` ``). Two consequences, the second one latent
 * until the first was fixed:
 *   1. a lone-CR-fenced or BOM-prefixed source threw "no YAML frontmatter
 *      block" — fail-closed, so never corruption, but `duplicateAsset` was
 *      simply unavailable for that asset;
 *   2. the hand-rebuild re-emitted BOTH fences with ONE chosen EOL and dropped
 *      a leading BOM, i.e. the same hand-reconstruction class #4469 removed
 *      from `set-body`.
 * The predicate is now the shared one and the block's own bytes are SPLICED
 * AROUND rather than rebuilt: `matchFrontmatterBlock` exports `blockStart` /
 * `blockEnd` for exactly this, and `FrontmatterService.leadingBlock` answers
 * what the file's EOL is (the opening fence's — req
 * `2d072437-c19d-49a4-ae89-f20b6185571f` decision 2).
 *
 * ⛤ BOM policy here is BYTE-PRESERVING — a RUN of leading U+FEFF is carried
 * into the duplicate verbatim, NOT collapsed to one. This is a DELIBERATE
 * divergence from `FrontmatterService.spliceBlock` / `replaceFrontmatter`
 * (which normalise a run to exactly one): those EDIT the user's file in place,
 * where one canonical answer is what keeps two channels agreeing, whereas this
 * function's contract is to produce a COPY that "preserves the document
 * byte-for-byte except for the specific keys" — normalising the mark would be a
 * second, unrequested edit to a duplicate. The bytes before the body are taken
 * from `content` itself, so the run the source carries survives THIS CALL.
 *
 * ⛔ …and only this call: the guarantee is POINT-IN-TIME, not a property of the
 * duplicate's lifetime. What ends it is the NEXT IN-PLACE PROPERTY WRITE — every
 * `property_set` goes through `FrontmatterService.updateProperty` →
 * `spliceBlock`, and the CLI adapter path through
 * `FileSystemVaultAdapter.replaceFrontmatter`; both write back EXACTLY ONE
 * U+FEFF whatever N was there. Measured (#4483 AC1, `duplicateAsset` service +
 * `updateProperty`, both real): run 3 → 3 after the duplicate → **1** after a
 * single property write. So the paragraph above must not be read as "a
 * duplicate keeps its run": it keeps it until something edits it, and the
 * collapse lives in the RECONSTRUCTION those writers do, not here.
 *
 * ⛤ The fail-closed throw is UNCHANGED and now means strictly less: a source
 * with no block in ANY of the three encodings. Widening the predicate narrows
 * the refusal, it does not weaken it.
 *
 * @internal — exported for unit testing only.
 */
export function rewriteFrontmatterScalars(
  content: string,
  replacements: Record<string, string>,
): string {
  // One predicate, two accessors: the block's offsets + body come from
  // `matchFrontmatterBlock`, the file's EOL from `FrontmatterService`. Both
  // resolve the SAME block (the service delegates to the same helper), so a
  // single guard covers both.
  const block = matchFrontmatterBlock(content);
  const leading = FrontmatterService.leadingBlock(content);
  if (!block) {
    throw new Error(
      "duplicateAsset: source file has no YAML frontmatter block",
    );
  }

  // ⛔ The guard is `!block` ALONE, and `leading` is asserted rather than
  // re-checked, BECAUSE both resolve through the same helper: `leadingBlock`
  // opens with `const block = matchFrontmatterBlock(content); if (!block) return
  // null;` — so `leading` is null IF AND ONLY IF `block` is. The `|| !leading`
  // disjunct this guard used to carry could therefore never fire; measured
  // (#4483 AC5) by a mutant that restores it and reds NOTHING — that null result
  // IS the evidence, not a coverage gap, because no input distinguishes the two
  // forms (`integration-test-revert-verify` §A35).
  // ⛔ Do NOT re-add it as "missing protection": the form would read as two
  // independent checks where there is one predicate. If the biconditional ever
  // stops holding, fix it in `leadingBlock` (one owner for those bytes, #4469) —
  // a second guard here would hide the disagreement instead of surfacing it.
  // ⛤ The assertion is STRUCTURALLY FORCED by the single guard, not a shortcut:
  // `block` and `leading` are two independently-typed nullables, and TypeScript
  // narrows only the one the guard tests — so `!block` alone leaves `leading`
  // nullable. The alternatives are worse: a `?? <eol>` fallback would be an
  // unreachable branch that silently picks the WRONG line ending if the
  // biconditional ever broke, and a second `if (!leading) throw` is the very
  // form AC3 removes. Asserting keeps the failure LOUD (a TypeError naming this
  // line) in a state the mechanism makes unreachable.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- see above: null iff `block` is, and `block` is already guarded
  const eol = leading!.eol;
  const remaining = new Map(Object.entries(replacements));

  const rewrittenLines = block.body
    .split(FRONTMATTER_BODY_LINE)
    .map((line) => {
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

  // Splice the new body between the block's OWN bytes: everything up to the
  // body (a BOM run, the opening fence and its terminator) and everything from
  // the body's end (the closing terminator, the closing fence, the document)
  // come from `content` untouched.
  const bodyStart = block.blockStart + 3 + eol.length;
  const bodyEnd = bodyStart + block.body.length;
  return (
    content.slice(0, bodyStart) +
    rewrittenLines.join(eol) +
    content.slice(bodyEnd)
  );
}

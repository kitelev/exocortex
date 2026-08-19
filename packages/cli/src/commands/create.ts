import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { readFileSync } from "fs";
import {
  ShapeLoader,
  ShapeRegistry,
  GenericAssetCreationService,
  liveClock,
  liveUidGenerator,
  canonicalYamlKey,
  type GenericAssetCreationConfig,
} from "@kitelev/exocortex-core";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { ClassResolverService } from "../services/ClassResolverService.js";
import { WikilinkValidator } from "../services/WikilinkValidator.js";
import { PropertyNameValidator } from "../services/PropertyNameValidator.js";
import { EffortStatusResolver } from "../services/EffortStatusResolver.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import {
  ShaclConformanceError,
  VaultNotFoundError,
} from "../utils/errors/index.js";
import { registerOrderSpecFromVault } from "../services/registerOrderSpec.js";
import {
  resolveCoLocationFolder,
  resolveNeighbourFolderByClass,
} from "../executors/folderRepairHelpers.js";

/**
 * Fallback folder for new assets whose `exo__Asset_isDefinedBy` cannot be
 * co-located (missing/`!`-prefixed/unresolvable). Matches the historical
 * `cli create` default.
 */
const DEFAULT_INBOX_FOLDER = "01 Inbox";

/**
 * Default timezone for `cli create` timestamps. The core service stays
 * timezone-agnostic; `cli create` opts into Asia/Almaty unless `--timezone`
 * overrides it (preserves the historical CLI default).
 */
const DEFAULT_TIMEZONE = "Asia/Almaty";

/**
 * Default creator for `cli create` assets — the ExoAssistant identity. When
 * `--created-by` is not supplied the CLI stamps this (making the `--created-by`
 * help text truthful). The core service applies no implicit default (the
 * plugin / apply paths stay byte-identical); the default lives here so it is
 * scoped to `cli create` only. Issue #3849.
 */
const DEFAULT_CREATED_BY_UID = "4ef3962d-b8a7-42b5-bd28-88ec846f1d13";

/**
 * Default effort status for a status-bearing class (an `ems__Effort` subclass)
 * created via `cli create` with no `--status`. Mirrors the Backlog a
 * Write-template gives for free, so a fresh Task/Project reaches its default
 * status without the two-step `set-draft-status → move-to-backlog` chain
 * (issue #3849).
 */
const DEFAULT_STATUS_NAME = "Backlog";

/** Frontmatter key for the effort status wikilink. */
const EFFORT_STATUS_KEY = "ems__Effort_status";

/**
 * Options parsed from CLI flags for the create command.
 */
interface CreateCommandOptions {
  vault: string;
  class: string;
  label: string;
  aliases?: string[];
  property?: string[];
  body?: string;
  bodyFile?: string;
  dryRun?: boolean;
  createdBy?: string;
  // `--status <name>` → string; `--no-status` → false (Commander pairs the
  // `--no-` flag with the `status` key; issue #3928); neither → undefined.
  status?: string | boolean;
  yes?: boolean;
  timezone?: string;
  skipWikilinkValidation?: boolean;
  /**
   * Opt-in SHACL-lite conformance gate (project 38800c80 W3). Default OFF —
   * without it `create` is byte-identical (no vault load, no extra output).
   */
  validate?: boolean;
}

/**
 * Parse --property flags into a key-value map.
 *
 * Each --property flag has the format "key=value". A key supplied ONCE maps to
 * a scalar string (back-compat). The SAME key supplied more than once
 * accumulates its values into an array (issue #3759) — the standard multi-value
 * CLI pattern — which the downstream serializer emits as a YAML array. A single
 * `--property 'key=["a","b"]'` flow-array is NOT parsed as an array; it stays a
 * literal value (use the repeatable flag for multi-value).
 *
 * @example
 * parseProperties(["ztlk__Note_developedFrom=[[uuid|Label]]", "custom_prop=value"])
 * // => { "ztlk__Note_developedFrom": "[[uuid|Label]]", "custom_prop": "value" }
 * @example
 * parseProperties(["exo__Asset_relates=[[A]]", "exo__Asset_relates=[[B]]"])
 * // => { "exo__Asset_relates": ["[[A]]", "[[B]]"] }
 */
/**
 * Fields `create` populates itself, keyed by their CANONICAL YAML key, mapped to
 * the dedicated flag a caller should use instead. Passing them through
 * `--property` cannot work: the creation service skips them (it derives them
 * from `--label` / `--aliases` / the generated identity), so the value would be
 * dropped without a word. Refusing at parse time turns that silent loss into an
 * actionable message (req 869561bf).
 *
 * ⚠ Keyed on the canonical key deliberately, so BOTH spellings are caught —
 * `aliases` and `exo__Asset_aliases` canonicalise to the same entry.
 *
 * Deliberately holds ONLY `aliases`, which is what req 869561bf specifies. The
 * other self-managed fields (`exo__Asset_label`, `exo__Instance_class`) are
 * dropped just as silently today, but refusing them is a behaviour change no
 * requirement states — widening this table without one would make the shipped
 * behaviour exceed its spec. Tracked as a follow-up on `ems__Bug` 43e41c8f.
 */
const CREATE_SELF_MANAGED_FLAGS: Record<string, string> = {
  aliases: "--aliases <a,b>",
};

function parseProperties(
  propertyArgs: string[] | undefined,
): Record<string, string | string[]> {
  if (!propertyArgs || propertyArgs.length === 0) {
    return {};
  }

  const properties: Record<string, string | string[]> = {};

  for (const prop of propertyArgs) {
    const eqIndex = prop.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(
        `Invalid property format: "${prop}". Expected "key=value" format.`,
      );
    }

    const key = prop.substring(0, eqIndex).trim();
    const value = prop.substring(eqIndex + 1).trim();

    if (!key) {
      throw new Error(
        `Invalid property format: "${prop}". Key cannot be empty.`,
      );
    }

    // ⛤ Refuse the spellings whose CANONICAL key collides with something
    // `create` manages itself (req 869561bf). Canonicalisation alone would send
    // them into the self-managed skip-list and the value would vanish SILENTLY
    // — strictly worse than today's dead literal key, because nothing tells the
    // caller their input was ignored. Refusing mirrors how `set-property`
    // rejects guarded properties: name the dedicated flag instead.
    const dedicatedFlag = CREATE_SELF_MANAGED_FLAGS[canonicalYamlKey(key)];
    if (dedicatedFlag !== undefined) {
      throw new Error(
        `Refusing to set "${key}" via --property — create manages this field itself. Use:  ${dedicatedFlag}`,
      );
    }

    const existing = properties[key];
    if (existing === undefined) {
      // First occurrence → scalar (back-compat with every single-value create).
      properties[key] = value;
    } else if (Array.isArray(existing)) {
      // Third+ occurrence → append to the accumulating array.
      existing.push(value);
    } else {
      // Second occurrence → promote the scalar to a two-element array.
      properties[key] = [existing, value];
    }
  }

  return properties;
}

/**
 * Read body content from the specified source.
 *
 * Sources:
 * - "--body <text>" - Inline text
 * - "--body -" - Read from stdin
 * - "--body-file <path>" - Read from file
 *
 * @returns Body content string, or undefined if no body source specified
 */
async function resolveBody(
  options: CreateCommandOptions,
): Promise<{ text: string; source: "file" | "stdin" | "inline" } | undefined> {
  // --body-file takes precedence if both specified
  if (options.bodyFile) {
    if (!existsSync(options.bodyFile)) {
      throw new Error(`Body file not found: ${options.bodyFile}`);
    }
    return { text: readFileSync(options.bodyFile, "utf-8"), source: "file" };
  }

  if (options.body === "-") {
    // Read from stdin with timeout
    return { text: await readStdin(30_000), source: "stdin" };
  }

  if (options.body) {
    return { text: options.body, source: "inline" };
  }

  return undefined;
}

/**
 * Read all content from stdin with a timeout.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 30s)
 * @returns Content read from stdin
 */
function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];

    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      reject(new Error(`Stdin read timed out after ${timeoutMs}ms. Ensure you pipe content to stdin or close the pipe.`));
    }, timeoutMs);

    process.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolvePromise(Buffer.concat(chunks).toString("utf-8"));
    });

    process.stdin.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    // If stdin is a TTY (not piped), end immediately with empty
    if (process.stdin.isTTY) {
      clearTimeout(timer);
      resolvePromise("");
    }

    process.stdin.resume();
  });
}

/**
 * Creates the 'create' subcommand for universal asset creation.
 *
 * @returns Commander Command instance configured for asset creation
 *
 * @example
 * ```bash
 * # Create a permanent note
 * exocortex create --class ztlk__PermanentNote --label "My Note" --vault /path/to/vault
 *
 * # With properties and body
 * exocortex create --class ztlk__PermanentNote \
 *   --label "My Note" \
 *   --property "ztlk__Note_developedFrom=[[uuid|Label]]" \
 *   --body "# Content here" \
 *   --vault /path/to/vault
 *
 * # Dry run
 * exocortex create --class ztlk__PermanentNote --label "Test" --dry-run --vault /path/to/vault
 *
 * # Body from file
 * exocortex create --class ztlk__PermanentNote --label "Test" --body-file /tmp/content.md --vault /path/to/vault
 *
 * # Body from stdin
 * echo "# Content" | exocortex create --class ztlk__PermanentNote --label "Test" --body - --vault /path/to/vault
 * ```
 */
export function createCommand(): Command {
  return new Command("create")
    .description("Create a new vault asset with auto-generated UUID, timestamp, and frontmatter")
    .requiredOption("--class <name>", "Class short name (e.g. ztlk__PermanentNote) or UUID")
    .requiredOption("--label <text>", "Human-readable label for the asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--aliases <names...>", "Additional aliases for the asset")
    .option("--property <key=value...>", "Property key-value pairs (repeatable; the SAME key passed more than once accumulates into a YAML array)", collect, [])
    .option("--body <text>", "Markdown body content (use '-' to read from stdin)")
    .option("--body-file <path>", "Read body content from file")
    .option("--dry-run", "Preview frontmatter without writing file")
    .option("--created-by <uuid>", "Creator UUID (defaults to ExoAssistant)")
    .option("--status <name>", "ems__Effort_status for status-bearing classes (default: Backlog; e.g. Draft, Doing, Done). Errors for non-status-bearing classes.")
    .option("--no-status", "For a status-bearing class, do NOT inject the default ems__Effort_status — create a status-less prototype/template (issue #3928). No-op for a non-status-bearing class. Mutually exclusive with --status / --property ems__Effort_status.")
    .option("--yes", "Accepted for symmetry with the apply subcommands (create is non-interactive; no-op)")
    .option("--timezone <tz>", "Timezone for timestamps (defaults to Asia/Almaty)")
    .option("--skip-wikilink-validation", "Skip wikilink existence validation")
    .option(
      "--validate",
      "Run SHACL-lite conformance validation on the new asset BEFORE writing it; a non-conformant asset is refused and no file is created (same shapes as `validate schema --shapes-mode`). Opt-in: omit the flag and create behaves exactly as before.",
    )
    .action(async (options: CreateCommandOptions) => {
      try {
        const vaultPath = resolve(options.vault);

        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }
        registerOrderSpecFromVault(vaultPath);

        // Label validation (core is intentionally lenient — it simply omits
        // the label when blank; `cli create` requires a non-empty label).
        if (!options.label || options.label.trim().length === 0) {
          throw new Error("Label cannot be empty");
        }
        const trimmedLabel = options.label.trim();

        // Parse properties from --property flags. Kept mutable so the effort
        // status default can be injected (issue #3849) before `propertyValues`
        // is finalised below.
        const properties = parseProperties(options.property);

        // Validate property NAMES against the mounted TBox (RFC 430e84f1, P1).
        // `create` already rejects a dangling wikilink VALUE (WikilinkValidator);
        // this closes the twin fail-silent hole on the KEY — a `--property` key
        // whose name does not exist in the mounted TBox is rejected fail-loud
        // with a fuzzy suggestion + a machine-readable `{ unknown, suggestions }`
        // structured error, so an LLM agent's typo (`ems__Effort_parentEffort`)
        // cannot silently land a DEAD property. There is deliberately NO skip
        // flag — the guarantee has no bot-accessible escape-hatch (must-have #6);
        // validation is fail-open when NO property definitions are mounted
        // (degenerate/partial profile). Validates the raw USER keys only (the
        // CLI injects its own well-known keys downstream).
        const propertyNameValidator = new PropertyNameValidator(vaultPath);
        await propertyNameValidator.validate(Object.keys(properties));

        // Resolve body content. `\n` escapes are expanded ONLY for the inline
        // `--body "a\nb"` form — that is exactly what issue #2288 asked for ("Given
        // --body \"Line1\\n\\nLine2\"), because a single shell argument cannot carry a
        // real newline.
        //
        // ⛔ NOT for --body-file or stdin: those already carry real newlines, so a
        // backslash-n in them is authored text (a regex, a Windows path) and expanding
        // it silently corrupts the document.
        const resolvedBody = await resolveBody(options);
        let body = resolvedBody?.text;
        if (body !== undefined && resolvedBody?.source === "inline") {
          body = body.replace(/\\n/g, "\n");
        }

        // CLI-side resolution + validation services (Node filesystem).
        const fsAdapter = new NodeFsAdapter(vaultPath);
        const classResolver = new ClassResolverService(fsAdapter);
        const wikilinkValidator = new WikilinkValidator(fsAdapter);

        // Resolve class short name → UUID (UID pass-through if already a UUID).
        const classUid = await classResolver.resolve(vaultPath, options.class);

        // Effort status default (issue #3849): a status-bearing class
        // (ems__Effort or a subclass, detected by walking exo__Class_superClass
        // to ems__Effort — no hardcoded class list) gets a default
        // ems__Effort_status of Backlog on create, the status a Write-template
        // gives for free, so a fresh Task/Project skips the two-step
        // `set-draft-status → move-to-backlog` chain. A non-status-bearing
        // class never gets a status. An explicit `--property
        // ems__Effort_status=...` always wins (and conflicts with --status).
        //
        // `--no-status` (issue #3928) is the explicit opt-out: for a
        // status-bearing class it SUPPRESSES the default injection so a
        // recurring/template prototype is created without a status (matching
        // its status-less siblings) — a no-op for a non-status-bearing class
        // (none was injected anyway). Commander pairs `--no-status` with the
        // `status` key → `options.status === false`; `--status <name>` → a
        // string; neither → undefined.
        const statusResolver = new EffortStatusResolver(fsAdapter);
        const noStatus = options.status === false;
        const statusName =
          typeof options.status === "string" ? options.status : undefined;
        const explicitStatus = EFFORT_STATUS_KEY in properties;
        if (noStatus && explicitStatus) {
          throw new Error(
            `Cannot pass both --no-status and --property ${EFFORT_STATUS_KEY}=... (ambiguous — cannot both suppress and set the status). Use one.`,
          );
        }
        if (statusName && explicitStatus) {
          throw new Error(
            `Cannot pass both --status and --property ${EFFORT_STATUS_KEY}=... (ambiguous). Use one.`,
          );
        }
        if (!explicitStatus && !noStatus) {
          const statusBearing = await statusResolver.isStatusBearing(classUid);
          if (statusName) {
            if (!statusBearing) {
              throw new Error(
                `--status only applies to status-bearing classes (ems__Effort subclasses); '${options.class}' is not one.`,
              );
            }
            const statusUid = await statusResolver.resolveStatusUid(statusName);
            if (!statusUid) {
              throw new Error(
                `Unknown status '${statusName}' — no matching ems__EffortStatus<Name> enum asset found in the vault.`,
              );
            }
            properties[EFFORT_STATUS_KEY] = `[[${statusUid}]]`;
          } else if (statusBearing) {
            // Default Backlog — fail-open: if the enum can't be resolved
            // (degenerate vault without the ems status enums mounted) keep the
            // historical no-status behaviour rather than failing the create.
            const backlogUid =
              await statusResolver.resolveStatusUid(DEFAULT_STATUS_NAME);
            if (backlogUid) {
              properties[EFFORT_STATUS_KEY] = `[[${backlogUid}]]`;
            } else {
              process.stderr.write(
                `⚠ status-bearing class but no ${DEFAULT_STATUS_NAME} status enum found in the vault — created without ems__Effort_status.\n`,
              );
            }
          }
        }

        // Finalise propertyValues AFTER any status injection so the injected
        // status is wikilink-validated and co-location still reads isDefinedBy.
        const propertyValues =
          Object.keys(properties).length > 0 ? properties : undefined;

        // Validate property wikilinks (unless skipped).
        if (propertyValues && !options.skipWikilinkValidation) {
          await wikilinkValidator.validatePropertyValues(propertyValues);
        }

        // Co-location placement (RFC 0b7a2fad CR-1, issue #3520): when
        // `exo__Asset_isDefinedBy` resolves to an on-disk ontology file, place
        // the new asset in that ontology's folder — the same resolver used by
        // `apply repair-folder` / `audit co-location`. Fail-open to the inbox
        // default when isDefinedBy is missing / `!`-prefixed / unresolvable.
        let folderPath = DEFAULT_INBOX_FOLDER;
        const isDefinedByRaw = propertyValues?.["exo__Asset_isDefinedBy"];
        // isDefinedBy is cardinality-1; if a user degenerate-passes it more than
        // once (→ array), co-locate by the first reference.
        const isDefinedBy = Array.isArray(isDefinedByRaw)
          ? isDefinedByRaw[0]
          : isDefinedByRaw;
        if (isDefinedBy) {
          const coLocatedFolder = await resolveCoLocationFolder(
            fsAdapter,
            isDefinedBy,
          );
          // Truthy → a resolved subfolder. The empty string "" (root-level
          // ontology, dirname → ".") is intentionally falsy here, so a brand
          // new asset is kept in the inbox rather than written to the vault
          // root — a degenerate case that does not occur under CR-1 (ontologies
          // live under assetspaces/<ns>/).
          if (coLocatedFolder) {
            folderPath = coLocatedFolder;
          }
        }

        // Priority 2 (issue #3934): when isDefinedBy did NOT resolve a folder
        // (bang-anchor `[[!kitelev]]` / `[[!aiKnow]]`, empty, or unresolvable —
        // folderPath is still the inbox default), co-locate the new asset next
        // to existing sibling instances that share BOTH the SAME class AND the
        // SAME isDefinedBy anchor, deriving the folder from where those siblings
        // already live. Data-driven neighbour co-location (no hardcoded
        // class→folder map): the product obeys the co-location invariant itself
        // instead of requiring an explicit `--folder`. Matching on the anchor
        // too (not class alone) is required because one class can span homes —
        // e.g. `inbox__ExoAssistantKnowledge` is used for RFCs (`[[!kitelev]]` →
        // exodev/inbox) AND for ExoAssistant infra knowledge (resolvable
        // isDefinedBy → exoass); class alone would let the latter outvote the
        // RFCs. Fail-open to the inbox default when no class+anchor sibling
        // exists. `options.class` may be a UID or a short-name; it is matched
        // (alongside the resolved classUid) against each instance's
        // `exo__Instance_class` wikilink target in any of its forms.
        if (folderPath === DEFAULT_INBOX_FOLDER) {
          const neighbourFolder = await resolveNeighbourFolderByClass(
            fsAdapter,
            classUid,
            options.class,
            isDefinedBy,
          );
          if (neighbourFolder) {
            folderPath = neighbourFolder;
          }
        }

        // Load SHACL-lite shape registry from vault for cardinality-aware
        // property serialization (issues #3099, #3179). Failure here is
        // non-fatal — fall back to an EMPTY registry (not undefined) so the
        // core still takes the cardinality-aware formatter and `cli create`
        // stays byte-identical to its prior behaviour (scalar default per
        // #3179) even when shapes cannot be loaded.
        let shapeRegistry: ShapeRegistry;
        try {
          shapeRegistry = await ShapeLoader.loadFromVaultFS(vaultPath);
        } catch {
          shapeRegistry = new ShapeRegistry();
        }

        // Delegate the domain logic (frontmatter assembly, UID-canon class
        // ref, cardinality, timestamp, body) to the shared core service.
        // `cli create` opts into the domain fields the plugin/apply omit:
        //  - classRefForm 'uuid' → `[[<uuid>]]` strip-canon
        //  - createdBy defaults to ExoAssistant when `--created-by` is omitted
        //    (issue #3849 — the default is CLI-scoped; the core applies no
        //    implicit default, so plugin/apply stay byte-identical)
        //  - folder = co-located ontology folder (or `01 Inbox` fail-open),
        //    aliases, timezone (Asia/Almaty default), body
        //  - shapeRegistry → cardinality-aware property emission
        const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
        const creationService = new GenericAssetCreationService(vaultAdapter);

        const config: GenericAssetCreationConfig = {
          className: options.class,
          classRefForm: "uuid",
          classUid,
          label: trimmedLabel,
          aliases: options.aliases,
          folderPath,
          createdBy: options.createdBy || DEFAULT_CREATED_BY_UID,
          timezone: options.timezone || DEFAULT_TIMEZONE,
          body,
          propertyValues,
          shapeRegistry,
        };

        // Opt-in SHACL-lite conformance gate (project 38800c80 W3) — the last
        // hook-gap of the CLI creation path. A CLI `create` runs through Bash,
        // so the PreToolUse Write hook `validate-asset.sh` (which gives the
        // Write path this guarantee via `validate schema --shapes-mode`) never
        // fires. `--validate` runs the SAME shapes pipeline BEFORE the write,
        // scoped to this candidate, and refuses a non-conformant asset so
        // nothing lands on disk.
        //
        // Determinism is pinned FIRST so the bytes validated here are the exact
        // bytes written below: `buildAsset` mints a fresh uid and stamps the
        // timestamps from the clock on EVERY call, so without pinning the
        // validated candidate and the written asset would differ
        // (dry-run-preview-not-real-output). The generators are the same live
        // ones the service uses by default — only their values are frozen for
        // this invocation, and only when `--validate` is passed (the default
        // path is untouched and byte-identical).
        if (options.validate) {
          const pinnedUid = liveUidGenerator().next();
          const pinnedNow = liveClock().now();
          creationService.withDeterminism({
            uidGenerator: { next: () => pinnedUid },
            clock: { now: () => new Date(pinnedNow.getTime()) },
          });

          const candidate = creationService.buildAsset(config);
          // Lazily imported: the validator pulls in the whole shapes/SPARQL
          // module graph, and the flag is opt-in — the DEFAULT `create` path
          // must not pay that load cost (nor widen its module graph).
          const { CandidateShaclValidator } = await import(
            "../services/CandidateShaclValidator.js"
          );
          const shaclValidator = new CandidateShaclValidator(vaultPath);
          const { violations, warnings } =
            await shaclValidator.validateCandidate(
              candidate.path,
              candidate.content,
            );

          // Warnings never gate (open-world: unresolvable / cross-vault /
          // symbolic refs, issue #3488) — same exit-code semantics shapes-mode
          // applies. Reported on stderr so stdout stays a single JSON document.
          for (const warning of warnings) {
            process.stderr.write(
              `⚠ SHACL warning on ${warning.propertyPath} (${warning.constraint}): ${warning.message}\n`,
            );
          }

          if (violations.length > 0) {
            throw new ShaclConformanceError(candidate.path, violations);
          }
        }

        let uuid: string;
        let path: string;
        if (options.dryRun) {
          // Pure build → preview the exact bytes a real write would produce
          // (canonical property ordering), fixing the prior preview/real-write
          // divergence (dry-run-preview-not-real-output).
          const built = creationService.buildAsset(config);
          uuid = built.uid;
          path = built.path;
          process.stderr.write(
            `--- DRY RUN PREVIEW ---\n${built.content}--- END PREVIEW ---\n`,
          );
        } else {
          const file = await creationService.createAsset(config);
          uuid = file.basename;
          path = file.path;
        }

        // Always output JSON to stdout on success
        const output = { uuid, path, label: trimmedLabel };
        process.stdout.write(JSON.stringify(output) + "\n");

        process.exit(0);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

/**
 * Commander.js collector for repeatable options.
 * Accumulates multiple --property flags into an array.
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

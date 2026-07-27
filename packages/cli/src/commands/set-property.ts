import { Command } from "commander";
import {
  resolve,
  relative,
  dirname,
  isAbsolute,
  sep as pathSep,
} from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  FrontmatterService,
  serializeYamlScalar,
} from "@kitelev/exocortex-core";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { WikilinkValidator } from "../services/WikilinkValidator.js";
import { PropertyNameValidator } from "../services/PropertyNameValidator.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import {
  VaultNotFoundError,
  InvalidArgumentsError,
} from "../utils/errors/index.js";
import { resolveCoLocationFolder } from "../executors/folderRepairHelpers.js";

/**
 * Default timezone for the `exo__Asset_updatedAt` bump. Matches `cli create`'s
 * Asia/Almaty default; overridable with `--timezone`.
 */
const DEFAULT_TIMEZONE = "Asia/Almaty";

const UPDATED_AT_KEY = "exo__Asset_updatedAt";
const ISDEFINEDBY_KEY = "exo__Asset_isDefinedBy";

/**
 * Properties `set-property` REFUSES because a dedicated guarded `exocmd__Command`
 * owns them — each enforces a state-machine transition or a precondition guard,
 * so setting the property directly would bypass that guard. The value is the
 * dedicated command to use instead. This is a SUPERSET of the `dogfood-cli-mutation`
 * hook's routing table: every property that has a dedicated command is refused
 * here and routed to that command, so `set-property` only ever handles the
 * "everything else" class the hook leaves to it.
 *
 * NOT guarded (so `set-property` handles them): `exo__Asset_isDefinedBy` (issue
 * #3848 — allowed, with a co-location warning), and any other scalar / boolean /
 * enum / wikilink property with no dedicated command.
 *
 * Looked up via {@link guardedReason} (own-key `hasOwnProperty` check) so a
 * user-supplied property name like `toString` / `constructor` never matches an
 * inherited Object.prototype key (#3795 review M2).
 */
const GUARDED_PROPERTIES: Record<string, string> = {
  // Status state machine (transitions carry preconditions).
  ems__Effort_status:
    "apply mark-done|move-to-backlog|move-to-todo|start-effort|set-draft-status <path>",
  // Criticality zone (not-a-prototype precondition guard).
  ems__Task_zone: "apply set-criticality-high|medium|low <path>",
  // Parent / label — dedicated guarded commands (#3779).
  ems__Effort_parent: 'apply set-parent <path> --input \'{"parent":"<uid>"}\'',
  exo__Asset_label: 'apply set-label <path> --input \'{"label":"<text>"}\'',
  // Reclassing — dedicated Convert commands (raw set desyncs class vs co-location).
  exo__Instance_class:
    "apply convert-to-task|convert-to-project <path>  (reclassing is a semantic operation with a precondition)",
  // Status-transition FACT timestamps (set only as status-transition side effects).
  ems__Effort_startTimestamp:
    "apply start-effort <path>  (or apply remove-start-timestamp <path>)",
  ems__Effort_endTimestamp:
    "apply mark-done <path>  (or apply remove-end-timestamp <path>)",
  ems__Effort_resolutionTimestamp: "apply mark-done <path>",
  // Plan / schedule dates — dedicated commands.
  ems__Effort_plannedStartTimestamp:
    "apply set-planned-start|plan-on-today|plan-for-evening|shift-day-forward|shift-day-backward <path>",
  ems__Effort_plannedEndTimestamp: "apply set-planned-end <path>",
  ems__Effort_scheduledDate: "apply set-scheduled-date <path>",
  // Votes — dedicated command.
  ems__Effort_votes: "apply vote-on-effort <path>",
  // Archive flag (bare `archived:` in frontmatter; `exo__Asset_archived` when
  // prefixed) — dedicated archive/un-archive commands (un-archive has a Done
  // precondition).
  archived: "apply archive-completed|archive-ontologically|un-archive <path>",
  exo__Asset_archived:
    "apply archive-completed|archive-ontologically|un-archive <path>",
};

/**
 * Properties `set-property` REFUSES as immutable identity / self-managed. The
 * value is the reason surfaced to the user.
 */
const IMMUTABLE_PROPERTIES: Record<string, string> = {
  exo__Asset_uid:
    "the asset identity — changing it breaks UID-canon filenames and every inbound [[uid]] wikilink",
  [UPDATED_AT_KEY]:
    "auto-managed by set-property (bumped on every mutation)",
};

/** Own-key lookup on a denylist that never matches inherited Object.prototype keys. */
function guardedReason(
  denylist: Record<string, string>,
  property: string,
): string | undefined {
  return Object.prototype.hasOwnProperty.call(denylist, property)
    ? denylist[property]
    : undefined;
}

/**
 * A settable value must be a scalar (string / number / boolean) or an array of
 * scalars. A nested object would serialise to the literal `[object Object]`
 * (silent corruption) and `null` is ambiguous with "unset" — reject both
 * fail-loud (#3795 review M1).
 */
function assertScalarOrScalarArray(value: unknown): void {
  const isScalar = (v: unknown): boolean =>
    typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  if (isScalar(value)) return;
  if (Array.isArray(value) && value.every(isScalar)) return;
  const kind =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "an array with non-scalar elements"
        : typeof value;
  throw new Error(
    `--input.value must be a scalar (string/number/boolean) or an array of scalars, not ${kind}`,
  );
}

interface SetPropertyOptions {
  vault: string;
  input?: string;
  property?: string;
  value?: string;
  skipWikilinkValidation?: boolean;
  timezone?: string;
  frozenClock?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Render `YYYY-MM-DDTHH:MM:SS` for the given instant in `timezone`. Uses
 * `Intl.DateTimeFormat` with an explicit `timeZone`, so the result is
 * deterministic regardless of the runner's local timezone (mirrors
 * `GenericAssetCreationService.generateTimestampInTimezone`).
 */
function stampTimestamp(now: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * Resolve the (property, value) pair from either `--input '{...}'` (JSON-typed
 * value) or the `--property <name> --value <string>` convenience form. Mutually
 * exclusive.
 */
function resolvePropertyAndValue(options: SetPropertyOptions): {
  property: string;
  value: unknown;
} {
  const hasInput = options.input !== undefined;
  const hasProperty = options.property !== undefined;

  if (hasInput && hasProperty) {
    throw new InvalidArgumentsError(
      "Pass --input OR --property/--value, not both.",
      `set-property <path> --input '{"property":"<name>","value":<v>}'`,
    );
  }

  if (hasInput) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.input as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`--input: invalid JSON (${msg})`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `--input must be a JSON object of the form {"property":"<name>","value":<v>}`,
      );
    }
    const obj = parsed as Record<string, unknown>;
    const property = obj.property;
    if (typeof property !== "string" || property.trim().length === 0) {
      throw new Error(`--input.property must be a non-empty string`);
    }
    if (!("value" in obj)) {
      throw new Error(`--input.value is required`);
    }
    return { property: property.trim(), value: obj.value };
  }

  if (hasProperty) {
    if (options.value === undefined) {
      throw new Error(
        `--property requires --value (or use --input for a typed/array value)`,
      );
    }
    return { property: (options.property as string).trim(), value: options.value };
  }

  throw new InvalidArgumentsError(
    "No property provided.",
    `set-property <path> --input '{"property":"<name>","value":<v>}'  OR  set-property <path> --property <name> --value <string>`,
  );
}

/**
 * Pre-format a value for `FrontmatterService.updateProperty` (which writes
 * verbatim — callers pre-format, mirroring `GroundingExecutor.executePropertySet`
 * and the create path). `serializeYamlScalar(v, true)` keeps booleans/numbers
 * bare, keeps ISO datetimes bare (native date type), quotes wikilinks (`[[uid]]`
 * → `"[[uid]]"`) and any YAML-unsafe / ambiguous scalar string so a JSON string
 * round-trips as a string.
 */
function serializeForWrite(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => serializeYamlScalar(v, true));
  }
  return serializeYamlScalar(value, true);
}

/**
 * `exocortex set-property <path>` — a generic, guarded CLI primitive that sets an
 * arbitrary non-guarded frontmatter property on an EXISTING vault asset, closing
 * the recurring "I had to raw-Edit a property" dogfooding gap (issue #3795) and
 * subsuming the `exo__Asset_isDefinedBy` repoint (issue #3848, with a co-location
 * re-validation warning).
 *
 * Homoiconicity Invariant (Q1/Q3): user-configurable SEMANTICS (status state
 * machine, criticality zones, parent/label with their preconditions) stay
 * homoiconic and keep their dedicated `exocmd__Command` groundings — the guard
 * here REFUSES those properties so they are not bypassed. An arbitrary
 * scalar/boolean/enum/wikilink property is not a state machine; per Q3 this is a
 * core-of-processing concern (a bare CLI verb, like `create`, that bypasses
 * groundings), so a single generic primitive is the right home.
 */
export function setPropertyCommand(): Command {
  return new Command("set-property")
    .description(
      "Set an arbitrary non-guarded frontmatter property on an existing vault asset (bumps exo__Asset_updatedAt). Refuses state-machine-guarded properties (status/zone/parent/label/fact-timestamps) — those keep their dedicated `apply` commands. Issues #3795 / #3848.",
    )
    .argument("<path>", "Vault-relative path to the target asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option(
      "--input <json>",
      'JSON {"property":"<name>","value":<v>} — value is JSON-typed (boolean/number/string/array). Primary form.',
    )
    .option(
      "--property <name>",
      "Property name (string-value convenience form; pair with --value; use --input for boolean/number/array values)",
    )
    .option(
      "--value <value>",
      "Property value as a string (pair with --property; use --input for typed/array values)",
    )
    .option(
      "--skip-wikilink-validation",
      "Skip [[...]] wikilink existence validation",
    )
    .option(
      "--timezone <tz>",
      "Timezone for the exo__Asset_updatedAt bump (defaults to Asia/Almaty)",
    )
    .option(
      "--frozen-clock <iso>",
      "Freeze the updatedAt clock to an ISO timestamp for test/replay",
    )
    .option("--dry-run", "Preview the resulting frontmatter without writing")
    .option(
      "--yes",
      "Accepted for symmetry with the apply/create subcommands (set-property is non-interactive; no-op)",
    )
    .action(async (pathArg: string, options: SetPropertyOptions) => {
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Resolve + guard the target path (must be inside the vault). Mirrors
        // `apply`'s vault-relative canonicalisation (issue #3788).
        const targetPath = resolve(vaultPath, pathArg);
        const vaultRelative = relative(vaultPath, targetPath);
        if (
          vaultRelative === ".." ||
          vaultRelative.startsWith(`..${pathSep}`) ||
          isAbsolute(vaultRelative)
        ) {
          throw new Error(
            `Target is outside the vault: ${pathArg} (vault: ${vaultPath})`,
          );
        }

        // Read directly and surface a friendly not-found on ENOENT — avoids an
        // `existsSync` check-then-read/write pair (js/file-system-race, #3907):
        // the file could change between the check and the later write. Mirrors
        // the same fix already applied in `repair-frontmatter.ts`.
        let original: string;
        try {
          original = readFileSync(targetPath, "utf-8");
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`Target file not found: ${pathArg}`);
          }
          throw readError;
        }
        // Only mutate a real asset (has an exo__Asset_uid). Refuse a bare
        // markdown file so `set-property` never silently mutates a non-asset.
        if (!/^\s*exo__Asset_uid:/m.test(original)) {
          throw new Error(
            `Not a vault asset (no exo__Asset_uid): ${vaultRelative}. set-property only mutates existing assets.`,
          );
        }

        const { property: rawProperty, value } = resolvePropertyAndValue(options);
        // Normalise a full-IRI-shaped property to prefixed form so the guard
        // denylists (prefixed keys) still match (mirrors executePropertySet).
        const property = FrontmatterService.normalizeIRI(rawProperty);

        // ── Guards (checked BEFORE any write → the file is untouched on a refusal) ──
        const immutableReason = guardedReason(IMMUTABLE_PROPERTIES, property);
        if (immutableReason !== undefined) {
          throw new Error(
            `Refusing to set "${property}" — ${immutableReason}.`,
          );
        }
        const guardedCommand = guardedReason(GUARDED_PROPERTIES, property);
        if (guardedCommand !== undefined) {
          throw new Error(
            `Refusing to set "${property}" via set-property — it has a dedicated guarded command so the state machine / precondition is not bypassed. Use:  exocortex ${guardedCommand} --vault <v>`,
          );
        }

        // Validate the property NAME against the mounted TBox (RFC 430e84f1, P2 —
        // parity with `create`). A NON-guarded key whose name does not exist in
        // the mounted TBox is rejected fail-loud with a fuzzy suggestion + a
        // machine-readable `{ unknown, suggestions }` structured error, so an LLM
        // agent's typo (`ems__Effort_parentEffort`) cannot silently write a DEAD
        // property. Runs AFTER the guard checks above (guarded/immutable props are
        // REAL names routed to dedicated commands — validation only sees the
        // "everything else" non-guarded class). Reuses the P1 collector: one-pass
        // mounted-TBox scan, fail-open when NO property defs are mounted
        // (degenerate/partial profile). No skip flag — no bot escape-hatch (#6).
        const propertyNameValidator = new PropertyNameValidator(vaultPath);
        await propertyNameValidator.validate([property]);

        // Reject a non-scalar / non-scalar-array value (fail-loud, #3795 review M1).
        assertScalarOrScalarArray(value);

        // Wikilink existence validation — the CLI/Bash write path bypasses the
        // PreToolUse validate-wikilinks hook, so validate here like `create`.
        if (!options.skipWikilinkValidation) {
          const validator = new WikilinkValidator(new NodeFsAdapter(vaultPath));
          const values = Array.isArray(value) ? value : [value];
          for (const v of values) {
            if (typeof v === "string") {
              await validator.validateValue(v);
            }
          }
        }

        // Apply the property, then bump exo__Asset_updatedAt.
        const fm = new FrontmatterService();
        const now = options.frozenClock
          ? new Date(options.frozenClock)
          : new Date();
        const timezone = options.timezone ?? DEFAULT_TIMEZONE;
        const updatedAt = stampTimestamp(now, timezone);

        let updated = fm.updateProperty(
          original,
          property,
          serializeForWrite(value),
        );
        updated = fm.updateProperty(updated, UPDATED_AT_KEY, updatedAt);

        // Issue #3848 — co-location re-validation for an isDefinedBy repoint.
        // The repoint itself succeeds; we WARN (non-fatal) when the file was not
        // physically moved under the new anchor's ontology folder, pointing at
        // `apply repair-folder` (which reads the just-written isDefinedBy). The
        // clean workflow is: set-property (repoint) → apply repair-folder (move).
        let coLocationWarning: string | undefined;
        if (property === ISDEFINEDBY_KEY) {
          const anchorRef = Array.isArray(value) ? value[0] : value;
          const coFolder = await resolveCoLocationFolder(
            new NodeFsAdapter(vaultPath),
            anchorRef,
          );
          if (coFolder !== null) {
            const currentDir = dirname(vaultRelative);
            const normCurrent = currentDir === "." ? "" : currentDir;
            if (normCurrent !== coFolder) {
              coLocationWarning =
                `⚠ co-location: exo__Asset_isDefinedBy now points at "${coFolder || "<vault root>"}" ` +
                `but the file is in "${normCurrent || "<vault root>"}". Move it to match:  ` +
                `exocortex apply repair-folder ${vaultRelative} --vault <v>`;
            }
          }
        }

        if (options.dryRun) {
          process.stderr.write(
            `--- DRY RUN PREVIEW ---\n${updated}\n--- END PREVIEW ---\n`,
          );
        } else {
          writeFileSync(targetPath, updated, "utf-8");
        }
        if (coLocationWarning) {
          process.stderr.write(coLocationWarning + "\n");
        }

        const output = {
          path: vaultRelative,
          property,
          value,
          updatedAt,
          ...(coLocationWarning ? { coLocationWarning: true } : {}),
        };
        process.stdout.write(JSON.stringify(output) + "\n");

        process.exit(0);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

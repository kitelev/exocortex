import { Command } from "commander";
import { resolve, relative, dirname, isAbsolute, sep as pathSep } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  FrontmatterService,
  serializeYamlScalar,
  STRING_SCALAR_PROPERTIES,
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
import {
  DEFAULT_TIMEZONE,
  UPDATED_AT_KEY,
  guardedRouteFor,
  renderGuardedRouteResolved,
  renderGuardRefusal,
  IMMUTABLE_PROPERTIES,
  canonicalYamlKey,
  guardedReason,
  stampTimestamp,
} from "./propertyMutationShared.js";
import { CommandNameRegistry } from "../services/CommandNameRegistry.js";

const ISDEFINEDBY_KEY = "exo__Asset_isDefinedBy";

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

/**
 * An EMPTY value is refused fail-loud (req 501cdf2c): writing `prop: ""` creates
 * a junk key that LOOKS like a successful clear, and a consumer branching on
 * "does the property exist" starts seeing it as present-with-an-empty-value.
 * Clearing has its own command (`remove-property`), which the message names.
 *
 * ⛔ The predicate is STRICT (`=== ""`), NOT `String(value).trim() === ""`.
 * A whitespace-ONLY value is legitimate and live: a measurement of all three
 * canonical vaults (34 327 files / 331 263 keys, 2026-08-23) found **0** carriers
 * of `key: ""` but **15** of `key: " "` — `exo__PrintedLiteral_literal` (9) and
 * `exo__DisplayNameSpec_separator` (6). `create --property k=<value>` strips the
 * surrounding spaces, so `set-property --value ' · '` is the ONLY documented way
 * to write them: a `trim()` predicate would make those two properties unwritable
 * by any command. Symmetry with the property-NAME check is restored in SPIRIT
 * (both sides are validated) but deliberately NOT in the letter of the predicate.
 *
 * ⛤ Wording is chosen against `classifyMessage` (ErrorHandler), which picks the
 * process exit code by SUBSTRING — "modified" would route to
 * CONCURRENT_MODIFICATION, "Invalid" to INVALID_ARGUMENTS. This message carries
 * none of those, so it classifies as GENERAL_ERROR, exactly like the sibling
 * name-check and guarded-route refusals.
 */
function assertNonEmptyValue(property: string, value: unknown): void {
  if (value !== "") return;
  throw new Error(
    `Refusing to set "${property}" to an EMPTY value — an empty string writes a junk key (${property}: "") ` +
      `rather than clearing the property. To delete it use:  exocortex remove-property <path> --property ${property} --vault <v>`,
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
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
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
    return {
      property: (options.property as string).trim(),
      value: options.value,
    };
  }

  throw new InvalidArgumentsError(
    "No property provided.",
    `set-property <path> --input '{"property":"<name>","value":<v>}'  OR  set-property <path> --property <name> --value <string>`,
  );
}

/**
 * Pre-format a value for `FrontmatterService.updateProperty` (which writes
 * verbatim — callers pre-format, mirroring `GroundingExecutor.executePropertySet`
 * and the create path). `serializeYamlScalar` keeps booleans/numbers bare, keeps
 * ISO datetimes bare (native date type), and quotes wikilinks (`[[uid]]` →
 * `"[[uid]]"`) plus any YAML-unsafe value.
 *
 * The second argument (`quoteAmbiguousScalars`) is decided PER PROPERTY, exactly
 * as the create path does it (`MetadataHelpers` → `STRING_SCALAR_PROPERTIES.has(key)`).
 * Passing a constant `true` — as this function used to — applied the
 * string-semantic rule to EVERY property, so a scalar-shaped `--value` string
 * (`2026-08-09`, `3`, `true`) was quoted and parsed back as a STRING on
 * properties that should keep their native YAML type. The same property written
 * by `create` stayed bare, so one property carried two types across the vault
 * depending on which command touched it last (ems__Bug 34b0a52c).
 *
 * ⛤ The lookup uses the CANONICAL yaml key (#3944), not the raw `--property`
 * value: `exo__Asset_aliases` is stored under the bare `aliases:` key, and
 * `aliases` is the member of `STRING_SCALAR_PROPERTIES` — keying on the raw name
 * would drop the quoting guarantee for that spelling. `exo__Asset_label` is the
 * other member of the set, but it is guarded to `apply set-label` and never
 * reaches this function — `aliases` is the only reachable member here.
 *
 * The `--input` JSON path is unaffected for a NUMBER or BOOLEAN value: it is not
 * a string, so `serializeYamlScalar` emits it bare regardless of this flag. A
 * JSON STRING shares this serializer with `--value` and therefore behaves
 * identically to it — by design, since the rule is per-property, not
 * per-input-form. A caller that needs a scalar-shaped value to survive as a
 * string on a non-string-semantic property pre-wraps it (`"value": "\"007\""`);
 * `serializeYamlScalar` passes an already-double-quoted scalar through verbatim.
 */
function serializeForWrite(value: unknown, yamlKey: string): unknown {
  const quoteAmbiguous = STRING_SCALAR_PROPERTIES.has(yamlKey);
  if (Array.isArray(value)) {
    return value.map((v) => serializeYamlScalar(v, quoteAmbiguous));
  }
  return serializeYamlScalar(value, quoteAmbiguous);
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

        const { property: rawProperty, value } =
          resolvePropertyAndValue(options);
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
        // Render the route against the LIVE vault: a listed cliName that `apply`
        // cannot resolve is not a sanctioned path, and offering it as one is how
        // three phantoms left users with no path at all (req 72419d3c, issue #4103).
        // An empty registry fails OPEN — see renderGuardedRouteResolved.
        const guardedRoute = guardedRouteFor(property);
        if (guardedRoute !== undefined) {
          const known = await new CommandNameRegistry(vaultPath).collect();
          throw new Error(
            renderGuardRefusal(
              "set",
              "set-property",
              property,
              renderGuardedRouteResolved(guardedRoute, known),
            ),
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

        // Reject an EMPTY value (req 501cdf2c). Runs HERE — with the other VALUE
        // checks, AFTER every NAME guard — not inside `resolvePropertyAndValue`.
        // Measured 2026-08-23 on the published CLI: `--property ems__Effort_status
        // --value ""` currently refuses with the dedicated-command route, and that
        // is the correct answer for a guarded property (the name is real, only the
        // route is wrong). Validating the value earlier would hijack it into
        // "empty value" and REGRESS a behavior the ticket records as correct.
        // Placing it here also covers BOTH doors (`--input` and `--property/--value`)
        // by construction, since both branches of `resolvePropertyAndValue` land here.
        assertNonEmptyValue(rawProperty, value);

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

        // Write under the CANONICAL YAML key (issue #3944): `exo__Asset_aliases`
        // maps to the bare `aliases:` key so we update it in place rather than
        // adding a duplicate literal `exo__Asset_aliases:` alongside it.
        const yamlKey = canonicalYamlKey(property);
        let updated = fm.updateProperty(
          original,
          yamlKey,
          serializeForWrite(value, yamlKey),
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

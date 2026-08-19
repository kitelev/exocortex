import { Command } from "commander";
import { resolve, relative, isAbsolute, sep as pathSep } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { FrontmatterService } from "@kitelev/exocortex-core";
import { PropertyNameValidator } from "../services/PropertyNameValidator.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import {
  VaultNotFoundError,
  InvalidArgumentsError,
} from "../utils/errors/index.js";
import {
  DEFAULT_TIMEZONE,
  UPDATED_AT_KEY,
  GUARDED_PROPERTIES,
  renderGuardRefusal,
  IMMUTABLE_PROPERTIES,
  canonicalYamlKey,
  guardedReason,
  stampTimestamp,
} from "./propertyMutationShared.js";

interface RemovePropertyOptions {
  vault: string;
  input?: string;
  property?: string;
  timezone?: string;
  frozenClock?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Resolve the property NAME from either `--input '{"property":"<name>"}'` (a JSON
 * object, symmetric with `set-property`'s `--input`) or the `--property <name>`
 * convenience form. Mutually exclusive. Removal has no value, so `--input` only
 * carries `{"property":"<name>"}`.
 */
function resolveProperty(options: RemovePropertyOptions): string {
  const hasInput = options.input !== undefined;
  const hasProperty = options.property !== undefined;

  if (hasInput && hasProperty) {
    throw new InvalidArgumentsError(
      "Pass --input OR --property, not both.",
      `remove-property <path> --property <name>`,
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
        `--input must be a JSON object of the form {"property":"<name>"}`,
      );
    }
    const property = (parsed as Record<string, unknown>).property;
    if (typeof property !== "string" || property.trim().length === 0) {
      throw new Error(`--input.property must be a non-empty string`);
    }
    return property.trim();
  }

  if (hasProperty) {
    const property = (options.property as string).trim();
    if (property.length === 0) {
      throw new Error(`--property must be a non-empty name`);
    }
    return property;
  }

  throw new InvalidArgumentsError(
    "No property provided.",
    `remove-property <path> --property <name>  OR  remove-property <path> --input '{"property":"<name>"}'`,
  );
}

/**
 * `exocortex remove-property <path>` — the DELETE-side counterpart of
 * `set-property` (#3795 / #3848). Removes a non-guarded frontmatter property
 * (scalar or multi-value list) from an EXISTING vault asset, closing the
 * "I had to raw-Edit / Bash-strip a frontmatter line" dogfooding gap (issue
 * #3926) — a Bash strip bypasses the PreToolUse hook-coverage + SHACL floor.
 *
 * It shares `set-property`'s guard denylists and canonical-YAML-key mapping
 * (#3944), but NOT its mounted-TBox property-name validation (RFC 430e84f1) —
 * that guard is deliberately ASYMMETRIC: the delete side ACCEPTS an undeclared
 * property (req 59220c17; rationale at the call site) and surfaces an unknown
 * name as a non-blocking hint instead. A state-machine /
 * precondition-guarded property (status/zone/parent/label/reclass/fact-timestamps/
 * plan-dates/votes/archive) is REFUSED (naming its dedicated `apply` command) so
 * the guard is not bypassed; the immutable identity properties (exo__Asset_uid,
 * exo__Asset_updatedAt) are refused too. Removing a property that is already
 * absent is an idempotent no-op success (updatedAt is bumped only when a change
 * actually occurred).
 *
 * Delegates the actual deletion to `FrontmatterService.removeProperty`.
 */
export function removePropertyCommand(): Command {
  return new Command("remove-property")
    .description(
      "Delete a non-guarded frontmatter property from an existing vault asset (bumps exo__Asset_updatedAt when a change occurs). The delete-side counterpart of set-property; refuses state-machine-guarded properties (status/zone/parent/label/fact-timestamps) — those keep their dedicated `apply` commands. Issue #3926.",
    )
    .argument("<path>", "Vault-relative path to the target asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option(
      "--input <json>",
      'JSON {"property":"<name>"} — the property to remove (symmetric with set-property\'s --input).',
    )
    .option(
      "--property <name>",
      "Property name to remove (convenience form; use --input for scripting)",
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
      "Accepted for symmetry with the apply/create subcommands (remove-property is non-interactive; no-op)",
    )
    .action(async (pathArg: string, options: RemovePropertyOptions) => {
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Resolve + guard the target path (must be inside the vault). Mirrors
        // `set-property`'s vault-relative canonicalisation (issue #3788).
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
        // `existsSync` check-then-read/write pair (js/file-system-race, #3907).
        let original: string;
        try {
          original = readFileSync(targetPath, "utf-8");
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`Target file not found: ${pathArg}`);
          }
          throw readError;
        }
        // Only mutate a real asset (has an exo__Asset_uid).
        if (!/^\s*exo__Asset_uid:/m.test(original)) {
          throw new Error(
            `Not a vault asset (no exo__Asset_uid): ${vaultRelative}. remove-property only mutates existing assets.`,
          );
        }

        const rawProperty = resolveProperty(options);
        // Normalise a full-IRI-shaped property to prefixed form so the guard
        // denylists (prefixed keys) still match (mirrors set-property).
        const property = FrontmatterService.normalizeIRI(rawProperty);

        // ── Guards (checked BEFORE any write → the file is untouched on a refusal) ──
        const immutableReason = guardedReason(IMMUTABLE_PROPERTIES, property);
        if (immutableReason !== undefined) {
          throw new Error(
            `Refusing to remove "${property}" — ${immutableReason}.`,
          );
        }
        const guardedCommand = guardedReason(GUARDED_PROPERTIES, property);
        if (guardedCommand !== undefined) {
          throw new Error(
            renderGuardRefusal(
              "remove",
              "remove-property",
              property,
              guardedCommand,
            ),
          );
        }

        // ⛤ The property NAME is deliberately NOT validated against the mounted
        // TBox here (req 59220c17) — the guard that `set-property` / `create`
        // apply (reqs c616a289 / 40a9a81b) is INVERTED on the delete side. It
        // exists against WRITE typos: a mistyped key would land a DEAD property
        // nothing reads. On DELETE the same input is the opposite case — a
        // property absent from the TBox has no consumers and is not
        // SHACL-validated, i.e. it is garbage by construction and precisely what
        // this command exists to remove; refusing it pushed the operation OUT of
        // the product (a raw Bash strip that bypasses the PreToolUse hooks +
        // SHACL floor), which is the very gap issue #3926 closed. A delete-side
        // typo is bounded by construction: `removeProperty` on an absent key is
        // an idempotent no-op and the output reports `removed: false` — so the
        // unknown-name signal is emitted as a non-blocking HINT below instead.

        // Remove under the CANONICAL YAML key (issue #3944): removing
        // `exo__Asset_aliases` deletes the bare `aliases:` key, not a literal
        // `exo__Asset_aliases:`. `removeProperty` returns the content UNCHANGED
        // when the key is absent → an idempotent no-op.
        const fm = new FrontmatterService();
        const afterRemove = fm.removeProperty(
          original,
          canonicalYamlKey(property),
        );
        const changed = afterRemove !== original;

        // Bump exo__Asset_updatedAt ONLY when a change actually occurred (an
        // idempotent no-op removal leaves the file byte-identical).
        let updated = afterRemove;
        let updatedAt: string | undefined;
        if (changed) {
          const now = options.frozenClock
            ? new Date(options.frozenClock)
            : new Date();
          const timezone = options.timezone ?? DEFAULT_TIMEZONE;
          updatedAt = stampTimestamp(now, timezone);
          updated = fm.updateProperty(afterRemove, UPDATED_AT_KEY, updatedAt);
        }

        // Nothing was removed → distinguish a legitimate idempotent no-op from a
        // TYPO by hinting when the name is also absent from the mounted TBox.
        // LAZY on purpose: the mounted-set walk runs ONLY on this branch, so the
        // success path no longer pays the vault scan the blocking guard took on
        // EVERY invocation. Never fatal (rc stays 0) — see the note above.
        if (!changed) {
          const nameHinter = new PropertyNameValidator(vaultPath);
          if (await nameHinter.isUnknownName(property)) {
            process.stderr.write(
              `⚠️  Nothing was removed, and "${property}" is not a property in the mounted TBox — check the spelling (an undeclared property is removable, so this is a hint, not a refusal).\n`,
            );
          }
        }

        if (options.dryRun) {
          process.stderr.write(
            `--- DRY RUN PREVIEW ---\n${updated}\n--- END PREVIEW ---\n`,
          );
        } else if (changed) {
          writeFileSync(targetPath, updated, "utf-8");
        }

        const output = {
          path: vaultRelative,
          property,
          removed: changed,
          ...(updatedAt ? { updatedAt } : {}),
        };
        process.stdout.write(JSON.stringify(output) + "\n");

        process.exit(0);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

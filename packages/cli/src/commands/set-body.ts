import { Command } from "commander";
import { resolve, relative, isAbsolute, sep as pathSep } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { FrontmatterService } from "@kitelev/exocortex-core";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { WikilinkValidator } from "../services/WikilinkValidator.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import {
  DEFAULT_TIMEZONE,
  UPDATED_AT_KEY,
  stampTimestamp,
} from "./propertyMutationShared.js";

interface SetBodyOptions {
  vault: string;
  body?: string;
  bodyFile?: string;
  dryRun?: boolean;
  timezone?: string;
  frozenClock?: string;
  skipWikilinkValidation?: boolean;
}

/** Read the whole of stdin as a string (for `--body -`). */
function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      rejectPromise(new Error(`Timed out reading body from stdin after ${timeoutMs}ms`));
    }, timeoutMs);
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolvePromise(Buffer.concat(chunks).toString("utf-8"));
    });
    process.stdin.on("error", (e) => {
      clearTimeout(timer);
      rejectPromise(e);
    });
  });
}

/**
 * Resolve the new body content from `--body-file` / `--body` / `--body -`
 * (stdin). `--body-file` takes precedence. Returns undefined when neither is
 * given (the caller rejects that).
 */
async function resolveNewBody(
  options: SetBodyOptions,
): Promise<string | undefined> {
  if (options.bodyFile) {
    if (!existsSync(options.bodyFile)) {
      throw new Error(`Body file not found: ${options.bodyFile}`);
    }
    return readFileSync(options.bodyFile, "utf-8");
  }
  if (options.body === "-") {
    return readStdin(30_000);
  }
  if (options.body !== undefined) {
    return options.body;
  }
  return undefined;
}

/**
 * `set-body <path>` — OVERWRITE the markdown BODY (everything after the
 * frontmatter block) of an existing vault asset, leaving the frontmatter block
 * byte-identical EXCEPT bumping `exo__Asset_updatedAt`. The dogfood body-rewrite
 * path (issue #3943): closes the gap where a body rewrite required a raw
 * `backup → rm → Write` (bypassing the PreToolUse hook-coverage + SHACL floor,
 * and — since the 2026-07-26 dogfood-cli-mutation hardening — needing an audited
 * sentinel window for CLI-creatable instance classes). Complements
 * `set-property` (#3795, frontmatter mutation) and `create --body-file` (#3744,
 * body on a NEW asset).
 *
 * Guards mirror `set-property`: refuses a target outside the vault, refuses a
 * non-asset (no `exo__Asset_uid`), and validates wikilinks in the NEW body
 * (the CLI/Bash write bypasses the validate-wikilinks hook) — an invalid
 * `[[uuid]]` is rejected fail-loud with the file left byte-unchanged.
 */
export function setBodyCommand(): Command {
  return new Command("set-body")
    .description(
      "Overwrite the markdown BODY of an existing vault asset (frontmatter untouched, exo__Asset_updatedAt bumped, new-body wikilinks validated). The dogfood body-rewrite path — no raw backup→rm→Write. Issue #3943.",
    )
    .argument("<path>", "Vault-relative path to the asset to rewrite")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--body-file <path>", "Read the new body from a file")
    .option("--body <text>", "New body text ('-' reads from stdin)")
    .option(
      "--timezone <tz>",
      "Timezone for the exo__Asset_updatedAt bump (defaults to Asia/Almaty)",
    )
    .option(
      "--frozen-clock <iso>",
      "Freeze the updatedAt clock to an ISO timestamp for test/replay",
    )
    .option("--dry-run", "Preview the resulting content without writing")
    .option(
      "--skip-wikilink-validation",
      "Skip wikilink existence validation for the new body",
    )
    .action(async (pathArg: string, options: SetBodyOptions) => {
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Resolve + guard the target path (must be inside the vault). Mirrors
        // set-property / apply's vault-relative canonicalisation (#3788).
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

        if (options.bodyFile === undefined && options.body === undefined) {
          throw new Error(
            "Provide the new body via --body-file <path>, --body <text>, or --body - (stdin).",
          );
        }

        // Read directly and surface a friendly not-found on ENOENT (avoids an
        // existsSync check-then-read race, #3907; mirrors set-property).
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
        // markdown file so set-body never silently rewrites a non-asset.
        if (!/^\s*exo__Asset_uid:/m.test(original)) {
          throw new Error(
            `Not a vault asset (no exo__Asset_uid): ${vaultRelative}. set-body only rewrites existing assets.`,
          );
        }

        // The frontmatter block MUST exist (guaranteed by the uid check above).
        const fm = new FrontmatterService();
        const parsed = fm.parse(original);
        if (!parsed.exists) {
          throw new Error(
            `No frontmatter block found in ${vaultRelative}; set-body preserves the frontmatter and only rewrites the body.`,
          );
        }
        // Reconstruct the exact original frontmatter block (byte-identical to
        // FRONTMATTER_REGEX's match: `---\n<yaml>\n---`).
        const frontmatterBlock = `---\n${parsed.content}\n---`;

        // Resolve + normalise the new body (parse `\n` escapes like create).
        let newBody = (await resolveNewBody(options)) ?? "";
        newBody = newBody.replace(/\\n/g, "\n");

        // Validate wikilinks in the NEW body (the CLI/Bash write bypasses the
        // PreToolUse validate-wikilinks hook — validate here like create /
        // set-property). An invalid [[uuid]] throws → file untouched.
        if (!options.skipWikilinkValidation) {
          const validator = new WikilinkValidator(new NodeFsAdapter(vaultPath));
          await validator.validateValue(newBody);
        }

        // Rebuild content: original frontmatter block + a single newline + the
        // new body (ensure a trailing newline for a non-empty body). Then bump
        // exo__Asset_updatedAt — updateProperty re-matches ONLY the frontmatter
        // block, leaving the just-written body intact.
        const bodyPart =
          newBody.length > 0
            ? newBody.endsWith("\n")
              ? newBody
              : `${newBody}\n`
            : "";
        const rebuilt = `${frontmatterBlock}\n${bodyPart}`;

        const now = options.frozenClock
          ? new Date(options.frozenClock)
          : new Date();
        const timezone = options.timezone ?? DEFAULT_TIMEZONE;
        const updatedAt = stampTimestamp(now, timezone);
        const updated = fm.updateProperty(rebuilt, UPDATED_AT_KEY, updatedAt);

        if (options.dryRun) {
          process.stderr.write(
            `--- DRY RUN PREVIEW ---\n${updated}\n--- END PREVIEW ---\n`,
          );
        } else {
          writeFileSync(targetPath, updated, "utf-8");
        }

        const output = {
          path: vaultRelative,
          updatedAt,
          // ⛔ Buffer.byteLength, NOT String.length. `.length` counts UTF-16 code
          // units, and the field is named bodyBytes — on Cyrillic prose the two
          // disagree by ~1.5x (measured: a 31,007-byte body reported as 19,980).
          // The failure is silent and reads as data loss: an operator who checks
          // the echo against the file size concludes half the body did not arrive
          // and re-runs a write that was already correct.
          bodyBytes: Buffer.byteLength(bodyPart, "utf8"),
        };
        process.stdout.write(JSON.stringify(output) + "\n");

        process.exit(0);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

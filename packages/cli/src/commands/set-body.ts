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
import { assertNoFrontmatterCopy } from "./bodyFrontmatterGuard.js";

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
 * Where the body text came from. Returned ALONGSIDE the text because the caller
 * must treat the three sources differently and cannot re-derive this safely:
 * only the `inline` form needs `\n` escapes expanded (issue #2288), and doing it
 * to the other two silently CORRUPTS prose — see the call site.
 */
type BodySource = "file" | "stdin" | "inline";

/**
 * Resolve the new body content from `--body-file` / `--body` / `--body -`
 * (stdin). `--body-file` takes precedence. Returns undefined when neither is
 * given (the caller rejects that).
 */
async function resolveNewBody(
  options: SetBodyOptions,
): Promise<{ text: string; source: BodySource } | undefined> {
  if (options.bodyFile) {
    if (!existsSync(options.bodyFile)) {
      throw new Error(`Body file not found: ${options.bodyFile}`);
    }
    return { text: readFileSync(options.bodyFile, "utf-8"), source: "file" };
  }
  if (options.body === "-") {
    return { text: await readStdin(30_000), source: "stdin" };
  }
  if (options.body !== undefined) {
    return { text: options.body, source: "inline" };
  }
  return undefined;
}

/**
 * `set-body <path>` — OVERWRITE the markdown BODY (everything after the
 * frontmatter block) of an existing vault asset, leaving the frontmatter block
 * byte-identical EXCEPT bumping `exo__Asset_updatedAt` — and only when the body
 * actually changed: a byte-identical body is a no-op (nothing written, no bump,
 * ticket 6ffac10e). The dogfood body-rewrite
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
      "Overwrite the markdown BODY of an existing vault asset (frontmatter untouched, exo__Asset_updatedAt bumped only when the body actually changed — a byte-identical body is a no-op, new-body wikilinks validated). The dogfood body-rewrite path — no raw backup→rm→Write. Issue #3943.",
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

        // Resolve the new body. `\n` escapes are expanded ONLY for the inline
        // `--body "a\nb"` form, which is what issue #2288 asked for: a single shell
        // argument has no way to carry a real newline.
        //
        // ⛔ NOT for --body-file or stdin. Those already carry real newlines, so any
        // backslash-n in them is text the author typed — a regex in prose, a Windows
        // path. Expanding it silently CORRUPTS the document and nothing reports it:
        // measured on a 2-line body containing `\n` and `C:\new`, the write produced
        // 4 lines and 0 backslashes. This code expanded unconditionally because the
        // call site could not see the source; the resolver now returns it.
        const resolved = await resolveNewBody(options);
        let newBody = resolved?.text ?? "";
        if (resolved?.source === "inline") {
          newBody = newBody.replace(/\\n/g, "\n");
        }

        // REFUSE a body that leads with a COPY of a frontmatter block (ticket
        // e6abe049): set-body preserves the file's OWN frontmatter, so such a
        // body would be stored as text and leave the asset carrying two blocks —
        // exactly how the program hub 31c2bdee acquired a stale 16-line duplicate.
        // Applies to ALL three sources (--body-file / --body / stdin): the
        // mistake is in the CONTENT, not in how it was delivered.
        assertNoFrontmatterCopy(newBody, "set-body");

        // Validate wikilinks in the NEW body (the CLI/Bash write bypasses the
        // PreToolUse validate-wikilinks hook — validate here like create /
        // set-property). An invalid [[uuid]] throws → file untouched.
        if (!options.skipWikilinkValidation) {
          const validator = new WikilinkValidator(new NodeFsAdapter(vaultPath));
          await validator.validateValue(newBody);
        }

        // Rebuild content: original frontmatter block + a single newline + the
        // new body (ensure a trailing newline for a non-empty body). Then, if
        // anything changed, bump exo__Asset_updatedAt — updateProperty re-matches ONLY the frontmatter
        // block, leaving the just-written body intact.
        const bodyPart =
          newBody.length > 0
            ? newBody.endsWith("\n")
              ? newBody
              : `${newBody}\n`
            : "";
        const rebuilt = `${frontmatterBlock}\n${bodyPart}`;

        // A no-op (the rebuilt content is byte-identical to the file — same body
        // INCLUDING the trailing newline set-body itself writes) is NOT a
        // modification: nothing is written and exo__Asset_updatedAt is left
        // untouched — the same semantics as `remove-property` of an absent key,
        // set-property and the executor's stampUpdatedAt (ticket 6ffac10e).
        // Compared against ORIGINAL, before the stamp: the stamp always differs.
        const changed = rebuilt !== original;
        let updated = rebuilt;
        let updatedAt: string | undefined;
        if (changed) {
          const now = options.frozenClock
            ? new Date(options.frozenClock)
            : new Date();
          const timezone = options.timezone ?? DEFAULT_TIMEZONE;
          updatedAt = stampTimestamp(now, timezone);
          updated = fm.updateProperty(rebuilt, UPDATED_AT_KEY, updatedAt);
        }

        if (options.dryRun) {
          process.stderr.write(
            `--- DRY RUN PREVIEW ---\n${updated}\n--- END PREVIEW ---\n`,
          );
        } else if (changed) {
          writeFileSync(targetPath, updated, "utf-8");
        }
        if (!changed) {
          process.stderr.write(
            "ℹ no change: the body is byte-identical — exo__Asset_updatedAt untouched\n",
          );
        }

        // `changed` + the OPTIONAL `updatedAt` mirror remove-property's echo: on
        // a no-op there is no stamp to report, so the field is omitted.
        const output = {
          path: vaultRelative,
          changed,
          ...(updatedAt ? { updatedAt } : {}),
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

import { Command } from "commander";
import { resolve, relative, isAbsolute, sep as pathSep } from "path";
import { existsSync, readFileSync } from "fs";
import { FrontmatterService } from "@kitelev/exocortex-core";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { guardStdioAgainstClosedReader } from "../utils/stdioClosedReader.js";

interface GetBodyOptions {
  vault: string;
  json?: boolean;
}

/**
 * `get-body <path>` — PRINT the markdown BODY (everything after the frontmatter
 * block) of an existing vault asset. The READ side of `set-body` (#3943), which
 * had no counterpart: the CLI could overwrite a body but never read one, so
 * appending a paragraph meant rewriting the whole body from memory.
 *
 * Requirement 9de09856-ffd6-4add-aa7c-56985808dc87. Measured motivation: a
 * headless consumer (the personal Telegram assistant) runs with a cwd OUTSIDE
 * the vault and no `--add-dir`, so every file channel is refused by the working
 * -directory gate; the graph carries no body prose either (only the wikilinks,
 * as exo__Asset_bodyLink). With `set-body` overwriting wholesale, that consumer
 * had NO read channel at all — and rewrote a body from memory.
 *
 * The load-bearing guarantee is the ROUND TRIP: piping this output straight back
 * into `set-body <same path> --body-file -` is a no-op (`changed:false`). Both
 * verbs therefore cut the frontmatter/body boundary identically — including the
 * trailing newline `set-body` appends itself. That single property locks the cut
 * position, the newline semantics, and the fact that the output is usable as
 * input; a mutant shifting the cut by one character reddens it.
 *
 * Read-only by construction: nothing is written, exo__Asset_updatedAt is not
 * stamped, and the file is left byte-identical. Guards mirror `set-body` so the
 * two verbs accept exactly the same targets: a path outside the vault, a
 * non-asset (no `exo__Asset_uid`) and a missing file are refused fail-loud.
 */
export function getBodyCommand(): Command {
  return new Command("get-body")
    .description(
      "Print the markdown BODY of an existing vault asset to stdout (everything after the frontmatter block; read-only — the file is left byte-identical). The READ counterpart of set-body: its output piped into `set-body --body-file -` is a no-op, so a body can be appended to instead of rewritten from memory. Requirement 9de09856.",
    )
    .argument("<path>", "Vault-relative path to the asset to read")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option(
      "--json",
      "Print {path, bodyBytes, body} as JSON instead of the raw body",
    )
    .action(async (pathArg: string, options: GetBodyOptions) => {
      // ⛔ FIRST statement of the action, and the second half of "no
      // process.exit(0)" below (#4447). #4434 landed only the first half: the exit
      // used to terminate the process synchronously, BEFORE the OS delivered the
      // asynchronous EPIPE that a reader closing its end mid-write causes. Without
      // the exit AND without this guard, that EPIPE is an unhandled 'error' event
      // on stdout — an uncaught exception: rc=1 plus a Node stack trace printed to
      // the user, on the very channel this command documents
      // (`get-body <p> | head -c 200`, `| less` quit with `q`). Measured on the
      // built bundle with a 549 528-byte body:
      //     reader reads to EOF                  rc=0, 549 528 bytes
      //     reader leaves after 200 B, no guard  rc=1 + "Error: write EPIPE"  5/5
      //     `set-body` (guard shipped in #4443)  rc=0                         3/3
      // Locked by the real-pipe axis P6 in get-body-9de09856-pipe.harness.ts; the
      // jest axes CANNOT see it (they mock process.stdout.write, so no pipe and no
      // reader ever exist — integration-test-revert-verify §A66).
      guardStdioAgainstClosedReader();
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Resolve + guard the target path (must be inside the vault). Mirrors
        // set-body / set-property / apply's vault-relative canonicalisation
        // (#3788) so the read and write verbs accept the same targets.
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

        // Read directly and surface a friendly not-found on ENOENT (avoids an
        // existsSync check-then-read race, #3907; mirrors set-body).
        let original: string;
        try {
          original = readFileSync(targetPath, "utf-8");
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`Target file not found: ${pathArg}`);
          }
          throw readError;
        }

        const fm = new FrontmatterService();
        const parsed = fm.parse(original);
        if (!parsed.exists) {
          throw new Error(
            `No frontmatter block found in ${vaultRelative}; get-body prints the body that FOLLOWS the frontmatter block.`,
          );
        }

        // Only read a real asset (the FRONTMATTER declares an exo__Asset_uid), so
        // get-body never serves a bare markdown file as if it were an asset body —
        // the same boundary set-body draws on the write side.
        //
        // ⛤ Tested against `parsed.content`, NOT the whole file, which is a
        // DELIBERATE divergence from set-body (it tests `original`). Over the whole
        // file the key can be satisfied by the BODY — a yaml fence in documentation,
        // a template skeleton — and a non-asset would have its body printed. Live
        // count of the false-positive population (uid present in the body ONLY):
        // 0 of 46 164 assets across vault-exodev + vault-my, so this corrects a
        // latent hole rather than a live defect, and the stricter side is the safe
        // side for a reader. The write-side verb keeps its own wording on purpose:
        // widening a guard that refuses to WRITE is not this requirement's scope.
        if (!/^\s*exo__Asset_uid:/m.test(parsed.content)) {
          throw new Error(
            `Not a vault asset (no exo__Asset_uid): ${vaultRelative}. get-body only reads existing assets.`,
          );
        }

        // The body is whatever follows the frontmatter block. The block is
        // reconstructed exactly as FRONTMATTER_REGEX matched it
        // (`---\n<yaml>\n---`, the trailing newline NOT captured), which is the
        // same reconstruction set-body writes back — that identity is what makes
        // the round trip a no-op rather than an approximation.
        const frontmatterBlock = `---\n${parsed.content}\n---`;
        const afterBlock = original.slice(frontmatterBlock.length);
        // Drop the single separator newline set-body puts between the block and
        // the body (tolerating CRLF, which set-body normalises to LF on write).
        // A file ending right at the closing `---` has no separator and no body.
        const body = afterBlock.replace(/^\r?\n/, "");

        if (options.json) {
          process.stdout.write(
            JSON.stringify({
              path: vaultRelative,
              // ⛔ Buffer.byteLength, NOT String.length — `.length` counts UTF-16
              // code units and the field is named bodyBytes. On Cyrillic prose the
              // two disagree by ~1.5x, and the mismatch reads as data loss: an
              // operator comparing the echo against the file size concludes half
              // the body is missing. Same floor as set-body's bodyBytes.
              bodyBytes: Buffer.byteLength(body, "utf8"),
              body,
            }) + "\n",
          );
        } else {
          // Raw body, byte-for-byte, with NOTHING appended: the body already
          // carries the trailing newline set-body guarantees, so adding one here
          // would make the round trip a modification instead of a no-op. An empty
          // body prints nothing and still exits 0 — an asset with no body is a
          // legitimate state, not an error.
          process.stdout.write(body);
        }

        // ⛔ NO process.exit(0) here — the process must end naturally so stdout
        // DRAINS. `process.exit` does not wait for an asynchronous write to
        // flush, and stdout is asynchronous whenever it is a PIPE, which is the
        // primary documented channel for this command:
        //     get-body <p> | set-body <p> --body-file -
        // Measured on the built bundle with the largest live asset (424 964-byte
        // body, aiknow/1d04c4d9): to a FILE 424 964 bytes arrived, through a PIPE
        // only 65 536 — 84.6 % silently lost, and `--json` came out as truncated,
        // unparseable JSON. Piping that into set-body WRITES the truncated body,
        // i.e. destroys the tail of the asset — the exact silent loss this
        // requirement exists to prevent. Nothing here holds the event loop open
        // (the only I/O is a synchronous read), so falling off the end of the
        // action is both sufficient and correct; the exit code stays 0.
        // Locked by the real-pipe axis in get-body-9de09856-pipe.harness.ts —
        // the jest axes CANNOT see this: they mock process.stdout.write and
        // process.exit, so no pipe and no flush is ever exercised
        // (integration-test-revert-verify §A66 — the axes judge an intermediate
        // record, the product is the DELIVERED effect).
        //
        // ⛤ Dropping the exit is only HALF the fix: it also stops terminating the
        // process before an asynchronous EPIPE can arrive. The paired half is
        // guardStdioAgainstClosedReader() at the top of this action (#4447) —
        // without it this command exits 1 with a stack trace whenever the reader
        // leaves early, which is ordinary use of a pipe.
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

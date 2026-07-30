import { execFile } from "child_process";

/**
 * Result of one wrapped `exocortex-cli` invocation.
 *
 * The runner NEVER rejects: a non-zero exit is data (`exitCode`), not an
 * exception, so a failing CLI call becomes an MCP tool error rather than a
 * crash of the long-lived stdio server (req 264ccef6, design point 6).
 */
export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Executes the CLI with an explicit argument VECTOR.
 *
 * The vector is the whole point of the MCP server: because the arguments are
 * passed as an array to `execFile` (which does NOT spawn a shell), no value can
 * be reinterpreted — `$`, backticks, `()`, quotes, globs and newlines all reach
 * the CLI byte-identically. This is the transport defect class the MCP surface
 * exists to remove.
 */
export type CliRunner = (args: readonly string[]) => Promise<CliRunResult>;

/**
 * 32 MiB — a `create` body or an `apply --json` envelope is orders of magnitude
 * smaller, but a generous ceiling keeps a large body from truncating silently.
 */
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/**
 * Build a {@link CliRunner} that re-invokes THIS CLI as a child process.
 *
 * Running the real CLI (rather than re-implementing creation in-process) is what
 * makes the MCP tools inherit every guarantee the creation path already has —
 * co-location by `exo__Asset_isDefinedBy`, dangling-wikilink VALUE rejection,
 * unknown-property-NAME rejection (req 40a9a81b) and SHACL-lite conformance
 * (req dd9ab956) — with zero changes to `create.ts` / `apply.ts`.
 *
 * @param entryPath Path to the CLI entry script (normally `process.argv[1]`).
 */
export function createSelfCliRunner(entryPath: string): CliRunner {
  return (args) =>
    new Promise<CliRunResult>((resolvePromise) => {
      execFile(
        process.execPath,
        [entryPath, ...args],
        { maxBuffer: MAX_BUFFER_BYTES },
        (error, stdout, stderr) => {
          let exitCode = 0;
          if (error) {
            const raw = (error as { code?: unknown }).code;
            // `code` is the child's exit status for a normal non-zero exit; a
            // spawn failure (ENOENT, killed by signal) surfaces as a string or
            // undefined — normalise those to 1 so callers only branch on 0/non-0.
            exitCode = typeof raw === "number" ? raw : 1;
          }
          resolvePromise({ stdout, stderr, exitCode });
        },
      );
    });
}

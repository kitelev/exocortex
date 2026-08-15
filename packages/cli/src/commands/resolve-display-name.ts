import { Command } from "commander";
import { existsSync } from "fs";
import { resolve, relative, isAbsolute, basename as pathBasename, sep as pathSep } from "path";
import {
  PrintNameRuleService,
  DisplayNameResolver,
  DEFAULT_DISPLAY_NAME_SETTINGS,
  type IFile,
} from "@kitelev/exocortex-core";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { FsVaultMetadataAdapter } from "../adapters/FsVaultMetadataAdapter.js";

/**
 * `resolve-display-name <target>` — req f17f7c57. The authoritative oracle for the name an
 * asset RENDERS as, answerable outside Obsidian.
 *
 * Sibling of `resolve-buttons`: that one answers "which buttons appear on this asset", this one
 * answers "what is this asset called". Both exist because the plugin's answer was previously
 * unreachable from CI, from the autonomous loop, and from any machine without the plugin
 * installed — a gap in the UI/CLI Parity invariant (#3417).
 *
 * ⛤ It runs the SAME engine the plugin runs (moved to `packages/core` by this requirement), over
 * the same vault specs, differing only in the VaultMetadataPort implementation. That is what makes
 * it an oracle rather than an approximation: a divergence between this output and the rendered
 * name is a bug in one of the two adapters, not two naming implementations drifting apart.
 *
 * Motivating case: `exocmd__Grounding_omitLabel` (v16.219.0) creates assets with NO
 * `exo__Asset_label` — their name is composed per-render by an `exo__DisplayNameSpec`. Before this
 * command the only ways to check that name were the human eye and the plugin's jest harness.
 */

export interface ResolveDisplayNameOptions {
  vault: string;
  json?: boolean;
}

/** Where the printed name came from — the half that makes the output diagnostic, not just a string. */
export type DisplayNameSource =
  /** An `exo__DisplayNameSpec` (or the TBox `prefix#slug` projection) composed it. */
  | "spec"
  /** No spec participated; the raw `exo__Asset_label` is the name. */
  | "label"
  /** Neither — the engine fell back to the filename stem. For a UID-canon vault that means a
   *  bare UID is showing, which is the signal that a label-less asset has NO spec covering it. */
  | "basename";

export interface ResolveDisplayNameResult {
  /** Vault-relative path of the asset. */
  target: string;
  /** Its `exo__Asset_uid`, when present. */
  uid: string | null;
  /** The filename stem — the engine's last-resort fallback. */
  basename: string;
  /** The composed name, exactly as the plugin would render it. */
  displayName: string;
  source: DisplayNameSource;
}

export async function resolveDisplayName(
  vaultPath: string,
  targetRelative: string,
): Promise<ResolveDisplayNameResult> {
  const resolvedVault = resolve(vaultPath);
  if (!existsSync(resolvedVault)) {
    throw new VaultNotFoundError(resolvedVault);
  }

  const targetPath = resolve(resolvedVault, targetRelative);
  if (!existsSync(targetPath)) {
    throw new Error(`Target file not found: ${targetRelative}`);
  }

  // Same containment check as resolve-buttons: an escaping path would read a file the caller
  // has no business naming, and would key nothing in the vault's own spec scan.
  const vaultRelative = relative(resolvedVault, targetPath);
  if (
    vaultRelative === ".." ||
    vaultRelative.startsWith(`..${pathSep}`) ||
    isAbsolute(vaultRelative)
  ) {
    throw new Error(
      `Target is outside the vault: ${targetRelative} (vault: ${resolvedVault})`,
    );
  }

  const vaultAdapter = new FileSystemVaultAdapter(resolvedVault);

  // Scan the vault for exo__DisplayNameSpec assets — the same scan the plugin runs on load.
  // ⛔ No host functions are registered: their predicates are platform-specific (the plugin
  // seeds isEffortBlocked/isEpisodeOngoing). The engine is fail-closed, so a spec naming an
  // unregistered function simply never participates — the CLI under-reports such a spec rather
  // than guessing at it. Surfacing host functions to the CLI is deliberately a separate step.
  const ruleService = new PrintNameRuleService(new FsVaultMetadataAdapter(vaultAdapter));
  ruleService.initialize();

  const resolver = new DisplayNameResolver(
    DEFAULT_DISPLAY_NAME_SETTINGS,
    ruleService,
    ruleService.createMetadataResolver(),
  );

  const node = vaultAdapter.getAbstractFileByPath(vaultRelative);
  const file = node !== null && "basename" in node ? (node as IFile) : null;
  const metadata = (file ? vaultAdapter.getFrontmatter(file) : null) ?? {};
  const basename = pathBasename(vaultRelative).replace(/\.md$/, "");

  const composed = resolver.resolve({
    metadata: metadata as Record<string, unknown>,
    basename,
  });
  const displayName = composed ?? basename;

  const rawLabel = (metadata as Record<string, unknown>).exo__Asset_label;
  const hasLabel = typeof rawLabel === "string" && rawLabel.trim().length > 0;

  // `source` is DERIVED from the engine's own inputs and output — never by re-deciding which
  // spec applies. Re-implementing that choice here is exactly the drift this command exists to
  // make impossible.
  const source: DisplayNameSource = hasLabel
    ? displayName === (rawLabel as string)
      ? "label"
      : "spec"
    : displayName === basename
      ? "basename"
      : "spec";

  const uid = (metadata as Record<string, unknown>).exo__Asset_uid;

  return {
    target: vaultRelative,
    uid: typeof uid === "string" && uid.trim() ? uid.trim() : null,
    basename,
    displayName,
    source,
  };
}

export function resolveDisplayNameCommand(): Command {
  return new Command("resolve-display-name")
    .description(
      "Print the composed display name an asset renders as — the same engine the plugin " +
        "runs, over the same vault exo__DisplayNameSpec assets (req f17f7c57). The " +
        "authoritative naming oracle outside Obsidian; --json adds `source`, which " +
        "distinguishes a spec-composed name from a raw exo__Asset_label.",
    )
    .argument("<target>", "Vault-relative path to the target asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--json", "Emit structured JSON instead of the bare name")
    .action(async (targetArg: string, options: ResolveDisplayNameOptions) => {
      ErrorHandler.setFormat((options.json ? "json" : "text") as OutputFormat);
      try {
        const result = await resolveDisplayName(options.vault, targetArg);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          // Bare name on stdout so the common case composes in a shell pipeline.
          console.log(result.displayName);
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
        process.exit(ExitCodes.OPERATION_FAILED);
      }
    });
}

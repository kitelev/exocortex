import { Command } from "commander";
import { existsSync } from "fs";
import { resolve, relative, isAbsolute, basename as pathBasename, sep as pathSep } from "path";
import {
  PrintNameRuleService,
  DisplayNameResolver,
  DEFAULT_DISPLAY_NAME_SETTINGS,
  createDisplayMatcherHostFunctions,
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

/**
 * Where the printed name came from — the half that makes the output diagnostic, not just a string.
 *
 * ⛤ Reported BY THE ENGINE (`resolveWithProvenance`), never inferred by comparing the output to
 * the raw label. That inference inverts in a reachable case — a spec composing to exactly the
 * filename stem would read as `basename`, i.e. as the very "no spec covers this asset" alarm this
 * command exists to raise — so provenance has to come from the code that decides it.
 */
export type DisplayNameSource =
  /** A vault `exo__DisplayNameSpec` participated. */
  | "spec"
  /** The TBox `prefix#slug` projection fired (a class/property definition). */
  | "tboxProjection"
  /** A settings-level `classTemplates` entry matched (empty under CLI defaults). */
  | "classTemplate"
  /** Nothing matched; the default template rendered the asset's own `exo__Asset_label`. */
  | "label"
  /** Nothing matched AND there is no label — a bare filename stem is showing. In a UID-canon
   *  vault that is a bare UID: the signal that a label-less asset has NO spec covering it. */
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
  //
  // ⛤ The built-in host functions ARE registered (req 5cd9fffe). Until they moved to core, this
  // command passed no registry at all, and since the engine is fail-closed a spec naming
  // isEffortBlocked/isEpisodeOngoing simply never participated: the CLI under-reported 2 of the
  // 35 specs, silently, over the 83 assets carrying the properties they read. Registering them
  // here is what makes this an oracle for EVERY spec rather than for most of them.
  //
  // The port doubles as the registry's vault handle: these predicates close over it rather than
  // reading the engine's opaque `host`, so this command needs no `host` argument — there is no
  // `App` on this side to pass.
  const port = new FsVaultMetadataAdapter(vaultAdapter);
  const ruleService = new PrintNameRuleService(
    port,
    createDisplayMatcherHostFunctions(port),
  );
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

  const resolved = resolver.resolveWithProvenance({
    metadata: metadata as Record<string, unknown>,
    basename,
  });
  const rawLabel = (metadata as Record<string, unknown>).exo__Asset_label;
  const hasLabel = typeof rawLabel === "string" && rawLabel.trim().length > 0;
  const labelText = hasLabel ? (rawLabel as string).trim() : null;

  // ⛔ The label tier is not optional politeness — it is what req c67e4c69 scenario D1 requires:
  // when a spec DECLINES (render → null) "the label is what a consumer prints", and this command
  // is a consumer. `?? basename` skipped straight past an existing label, so a labelled asset
  // under a declining spec showed a bare UID here while Obsidian showed its label (TabTitlePatch
  // and GraphViewPatch run exactly this null → label → basename chain). The divergence predates
  // c67e4c69 — a separator-mode decline did the same — but only separator specs declined then,
  // so it was unreachable in practice until c67e4c69 widened the declining set.
  const displayName = resolved.displayName ?? labelText ?? basename;

  // ⛔ A null render shares its branch with provenance "default", and that is not tidiness.
  // `render()` returns null even when a spec PARTICIPATED — the engine documents the path ("every
  // field empty → the affixes alone are not a name") and req c67e4c69 made it reachable for every
  // plain spec, not just separator ones. Reporting the engine's provenance there would announce
  // "a spec named this" over a name the spec refused to compose — the alarm this command exists
  // to raise, silenced. So both branches report WHICH FALLBACK TIER actually produced the printed
  // string, which is a property of the ASSET (does it carry a label?), not a naming decision
  // re-made on this side: label if one exists, else the stem.
  //
  // ⛤ Previously the null branch was hard-wired to "basename" — true while nothing consulted the
  // label, false once `displayName` above began falling to it. The two are now derived from the
  // same `hasLabel`, so `source` cannot drift from what was printed.
  const source: DisplayNameSource =
    resolved.displayName === null || resolved.provenance === "default"
      ? hasLabel
        ? "label"
        : "basename"
      : resolved.provenance;

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

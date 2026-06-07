import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import type { IConfirmGate } from "exocortex";
import { CliFocusProfileResolver } from "../services/CliFocusProfileResolver.js";
import {
  CliHardSwitchService,
  TsFloorViolationError,
} from "../services/CliHardSwitchService.js";
import { BootstrapAssetSpaceService } from "../services/BootstrapAssetSpaceService.js";
import { HeadlessConfirmGate } from "../services/HeadlessConfirmGate.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import {
  VaultNotFoundError,
  InvalidArgumentsError,
} from "../utils/errors/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";

/**
 * Options surface for `exocortex hard-switch <profile-uid>`.
 */
export interface HardSwitchCommandOptions {
  vault: string;
  yes?: boolean;
  verbose?: boolean;
  /** Git ref to pull when materialising AssetSpaces. Default `main`. */
  ref?: string;
  /** GitHub PAT for private-repo materialisation (or env GITHUB_TOKEN/GH_TOKEN). */
  token?: string;
}

/**
 * Internal action handler — exported for integration tests, which inject
 * a fake `IConfirmGate` to verify the wiring without spinning a real CLI
 * subprocess.
 */
export interface HardSwitchActionDeps {
  /** Override the confirm gate (test seam). */
  confirmGate?: IConfirmGate;
  /**
   * Override the resolver factory (test seam). Production omits and the
   * action constructs `CliFocusProfileResolver` from CLI options.
   */
  resolverFactory?: (opts: HardSwitchCommandOptions) => CliFocusProfileResolver;
  /**
   * Override the hard-switch service factory (test seam). Production omits and
   * the action constructs a `CliHardSwitchService` backed by a
   * `BootstrapAssetSpaceService` (Node `fetch` mount mechanics). Tests inject a
   * service with a fake `fetchImpl` so materialisation needs no network.
   */
  hardSwitchServiceFactory?: (
    opts: HardSwitchCommandOptions,
    vaultPath: string,
  ) => CliHardSwitchService;
  /**
   * Override stdout sink. The default writes to `process.stdout`; tests
   * inject `() => {}` to silence. Either way, lines are also captured
   * exactly once into the returned `HardSwitchResult.stdout`.
   */
  out?: (msg: string) => void;
  /** Override stderr sink — same capture-once contract as `out`. */
  err?: (msg: string) => void;
}

/**
 * Run the hard-switch flow. Throws typed `CLIError` subclasses on
 * validation failure; the caller (commander action handler OR test) is
 * responsible for routing those through `ErrorHandler.handle` or capturing
 * them.
 *
 * @returns A struct with the exit code and informational messages so
 *   tests can assert on outcomes without spying on process streams.
 */
export interface HardSwitchResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runHardSwitch(
  profileUid: string,
  opts: HardSwitchCommandOptions,
  deps: HardSwitchActionDeps = {},
): Promise<HardSwitchResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSink =
    deps.out ?? ((msg: string) => process.stdout.write(`${msg}\n`));
  const stderrSink =
    deps.err ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  const out = (msg: string) => {
    stdout.push(msg);
    stdoutSink(msg);
  };
  const err = (msg: string) => {
    stderr.push(msg);
    stderrSink(msg);
  };

  if (!opts.vault) {
    throw new InvalidArgumentsError("--vault is required");
  }
  const vaultPath = resolve(opts.vault);
  if (!existsSync(vaultPath)) {
    throw new VaultNotFoundError(vaultPath);
  }

  if (!profileUid || profileUid.length === 0) {
    throw new InvalidArgumentsError(
      "profile-uid argument is required",
      "exocortex hard-switch <profile-uid> --vault <path>",
    );
  }

  // Validate + resolve the profile's effective AssetSpace set. The resolver
  // scans the vault filesystem once; the hard-switch service does a second scan
  // for AssetSpace descriptor metadata (git URL + derived mount folder).
  const resolver =
    deps.resolverFactory?.(opts) ??
    new CliFocusProfileResolver({
      vaultPath,
      warn: (msg) => err(msg),
    });
  const outcome = await resolver.resolveFilter(profileUid);

  if (outcome.outcome === "missing-profile") {
    throw new InvalidArgumentsError(
      `Profile not found: ${profileUid}`,
      "Run `exocortex find --class exo__FocusProfile` to list available profiles",
    );
  }
  if (outcome.outcome === "error") {
    err(`[hard-switch] Resolver error: ${outcome.reason}`);
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }
  // `degraded` means the resolved effective set is empty (or overlaps nothing
  // in the vault — R15 self-brick mitigation). Hard switch with a degraded
  // outcome would destroy assetspaces against a profile that resolves to
  // nothing useful — refuse outright before touching the gate.
  if (outcome.outcome === "degraded") {
    err(
      `[hard-switch] Refused: profile resolution degraded — ${outcome.reason}. Hard switch aborted to prevent vault corruption.`,
    );
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }
  if (outcome.outcome !== "engaged") {
    // `no-profile` is unreachable (profileUid validated non-empty above);
    // guard defensively so TS narrows `outcome` to the engaged variant.
    err(`[hard-switch] Unexpected resolver outcome: ${outcome.outcome}`);
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }
  const engaged = outcome.result;

  // Build the hard-switch service. Token precedence: --token > GITHUB_TOKEN env
  // > GH_TOKEN env (mirrors the `bootstrap` command). `||` not `??` so an empty
  // env var falls through.
  const token =
    opts.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
  const service =
    deps.hardSwitchServiceFactory?.(opts, vaultPath) ??
    new CliHardSwitchService({
      vaultPath,
      ref: opts.ref ?? "main",
      mount: new BootstrapAssetSpaceService({ token }),
    });

  const { infos, profileLabels } = service.scanVault();
  // The resolver does NOT surface the profile label (Issue #3416 keeps it
  // unchanged); read it from the descriptor scan, falling back to the UID.
  const targetProfileLabel = profileLabels.get(profileUid) ?? profileUid;

  // Compute the real mount-state diff + plan. R24 TS-floor guard throws here,
  // BEFORE any mutation OR the confirmation gate (anti-self-brick).
  let diff;
  try {
    diff = service.buildDiff({
      targetProfileUid: profileUid,
      targetProfileLabel,
      // The CLI is stateless — it diffs against on-disk mount state, not a
      // persisted active profile — so the source is unknown.
      sourceProfileUid: null,
      sourceProfileLabel: "<unknown>",
      result: engaged,
      infos,
    });
  } catch (e) {
    if (e instanceof TsFloorViolationError) {
      err(`[hard-switch] Refused: ${e.message}`);
      return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
    }
    throw e;
  }

  // Confirmation gate — renders the REAL plan (verbose) + enforces `--yes`.
  const gate =
    deps.confirmGate ??
    new HeadlessConfirmGate({
      yes: opts.yes ?? false,
      verbose: opts.verbose ?? false,
      log: (msg) => err(msg),
    });
  const approved = await gate.confirmHardSwitch(diff.plan);
  if (!approved) {
    // Gate already logged "Refused: --yes required". Exit 0 — explicit decline.
    return { exitCode: ExitCodes.SUCCESS, stdout, stderr };
  }

  // Idempotent no-op: target already in mount-state ⇒ nothing to mutate.
  if (diff.toDestroy.length === 0 && diff.toMaterialize.length === 0) {
    out(
      `[hard-switch] Already in target mount-state for ${targetProfileLabel} — no-op.`,
    );
    return { exitCode: ExitCodes.SUCCESS, stdout, stderr };
  }

  let execResult;
  try {
    execResult = await service.execute(diff);
  } catch (e) {
    err(
      `[hard-switch] Execution failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }

  out(
    `[hard-switch] Switched to ${targetProfileLabel}: ${execResult.destroyed.length} AssetSpace(s) torn down, ${execResult.materialized.length} materialized.`,
  );
  return { exitCode: ExitCodes.SUCCESS, stdout, stderr };
}

export function hardSwitchCommand(): Command {
  const cmd = new Command("hard-switch")
    .description(
      "Hard switch to specified FocusProfile (mount-state filesystem mutation). Requires --yes for headless mode.",
    )
    .argument("<profile-uid>", "Target FocusProfile UID")
    .requiredOption("--vault <path>", "Path to Obsidian vault")
    .option(
      "--yes",
      "Confirm hard switch (headless mode safety override per RFC 22b50a17 Decision #2)",
      false,
    )
    .option("--verbose", "Print plan summary to stderr before deciding", false)
    .option("--ref <branch>", "Git ref to pull when materialising AssetSpaces", "main")
    .option(
      "--token <pat>",
      "GitHub PAT for private-repo materialisation (or env GITHUB_TOKEN / GH_TOKEN)",
    )
    .action(async (profileUid: string, opts: HardSwitchCommandOptions) => {
      try {
        const result = await runHardSwitch(profileUid, opts);
        process.exit(result.exitCode);
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
  return cmd;
}

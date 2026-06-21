import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import type { IConfirmGate } from "@kitelev/exocortex-core";
import { CliProfileResolver } from "../services/CliProfileResolver.js";
import {
  CliApplyProfileService,
  TsFloorViolationError,
} from "../services/CliApplyProfileService.js";
import { BootstrapAssetSpaceService } from "../services/BootstrapAssetSpaceService.js";
import { nodeMountBaseStore } from "./exosync-sync.js";
import { HeadlessConfirmGate } from "../services/HeadlessConfirmGate.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import {
  VaultNotFoundError,
  InvalidArgumentsError,
} from "../utils/errors/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";

/**
 * Options surface for `exocortex apply-profile <profile-uid>`.
 */
export interface ApplyProfileCommandOptions {
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
export interface ApplyProfileActionDeps {
  /** Override the confirm gate (test seam). */
  confirmGate?: IConfirmGate;
  /**
   * Override the resolver factory (test seam). Production omits and the
   * action constructs `CliProfileResolver` from CLI options.
   */
  resolverFactory?: (opts: ApplyProfileCommandOptions) => CliProfileResolver;
  /**
   * Override the apply-profile service factory (test seam). Production omits and
   * the action constructs a `CliApplyProfileService` backed by a
   * `BootstrapAssetSpaceService` (Node `fetch` mount mechanics). Tests inject a
   * service with a fake `fetchImpl` so materialisation needs no network.
   */
  applyServiceFactory?: (
    opts: ApplyProfileCommandOptions,
    vaultPath: string,
  ) => CliApplyProfileService;
  /**
   * Override stdout sink. The default writes to `process.stdout`; tests
   * inject `() => {}` to silence. Either way, lines are also captured
   * exactly once into the returned `ApplyProfileResult.stdout`.
   */
  out?: (msg: string) => void;
  /** Override stderr sink — same capture-once contract as `out`. */
  err?: (msg: string) => void;
}

/**
 * Run the apply-profile flow. Throws typed `CLIError` subclasses on
 * validation failure; the caller (commander action handler OR test) is
 * responsible for routing those through `ErrorHandler.handle` or capturing
 * them.
 *
 * @returns A struct with the exit code and informational messages so
 *   tests can assert on outcomes without spying on process streams.
 */
export interface ApplyProfileResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export async function runApplyProfile(
  profileUid: string,
  opts: ApplyProfileCommandOptions,
  deps: ApplyProfileActionDeps = {},
): Promise<ApplyProfileResult> {
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
      "exocortex apply-profile <profile-uid> --vault <path>",
    );
  }

  // Validate + resolve the profile's effective AssetSpace set. The resolver
  // scans the vault filesystem once; the apply-profile service does a second scan
  // for AssetSpace descriptor metadata (git URL + derived mount folder).
  const resolver =
    deps.resolverFactory?.(opts) ??
    new CliProfileResolver({
      vaultPath,
      warn: (msg) => err(msg),
    });
  const outcome = await resolver.resolveFilter(profileUid);

  if (outcome.outcome === "missing-profile") {
    throw new InvalidArgumentsError(
      `Profile not found: ${profileUid}`,
      "Run `exocortex find --class exo__Profile` to list available profiles",
    );
  }
  if (outcome.outcome === "error") {
    err(`[apply-profile] Resolver error: ${outcome.reason}`);
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }
  // `degraded` means the resolved effective set is empty (or overlaps nothing
  // in the vault — R15 self-brick mitigation). Apply with a degraded
  // outcome would destroy assetspaces against a profile that resolves to
  // nothing useful — refuse outright before touching the gate.
  if (outcome.outcome === "degraded") {
    err(
      `[apply-profile] Refused: profile resolution degraded — ${outcome.reason}. Apply aborted to prevent vault corruption.`,
    );
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }
  if (outcome.outcome !== "engaged") {
    // `no-profile` is unreachable (profileUid validated non-empty above);
    // guard defensively so TS narrows `outcome` to the engaged variant.
    err(`[apply-profile] Unexpected resolver outcome: ${outcome.outcome}`);
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }
  const engaged = outcome.result;

  // Build the apply-profile service. Token precedence: --token > GITHUB_TOKEN env
  // > GH_TOKEN env (mirrors the `bootstrap` command). `||` not `??` so an empty
  // env var falls through.
  const token =
    opts.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
  const service =
    deps.applyServiceFactory?.(opts, vaultPath) ??
    new CliApplyProfileService({
      vaultPath,
      ref: opts.ref ?? "main",
      // #3590 — record each mounted AssetSpace's commit SHA as the first-sync
      // 3-way merge base (same device-local file `exosync sync` reads).
      mount: new BootstrapAssetSpaceService({
        token,
        mountBaseStore: nodeMountBaseStore(vaultPath),
      }),
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
      err(`[apply-profile] Refused: ${e.message}`);
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
  const approved = await gate.confirmApply(diff.plan);
  if (!approved) {
    // Gate already logged "Refused: --yes required". Exit 0 — explicit decline.
    return { exitCode: ExitCodes.SUCCESS, stdout, stderr };
  }

  // Idempotent no-op: target already in mount-state ⇒ nothing to mutate.
  if (diff.toDestroy.length === 0 && diff.toMaterialize.length === 0) {
    out(
      `[apply-profile] Already in target mount-state for ${targetProfileLabel} — no-op.`,
    );
    return { exitCode: ExitCodes.SUCCESS, stdout, stderr };
  }

  let execResult;
  try {
    execResult = await service.execute(diff);
  } catch (e) {
    err(
      `[apply-profile] Execution failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { exitCode: ExitCodes.OPERATION_FAILED, stdout, stderr };
  }

  out(
    `[apply-profile] Switched to ${targetProfileLabel}: ${execResult.destroyed.length} AssetSpace(s) torn down, ${execResult.materialized.length} materialized.`,
  );
  return { exitCode: ExitCodes.SUCCESS, stdout, stderr };
}

export function applyProfileCommand(): Command {
  const cmd = new Command("apply-profile")
    .description(
      "Apply the specified Profile (mount-state filesystem mutation). Requires --yes for headless mode.",
    )
    .argument("<profile-uid>", "Target Profile UID")
    .requiredOption("--vault <path>", "Path to Obsidian vault")
    .option(
      "--yes",
      "Confirm apply (headless mode safety override per RFC 22b50a17 Decision #2)",
      false,
    )
    .option("--verbose", "Print plan summary to stderr before deciding", false)
    .option("--ref <branch>", "Git ref to pull when materialising AssetSpaces", "main")
    .option(
      "--token <pat>",
      "GitHub PAT for private-repo materialisation (or env GITHUB_TOKEN / GH_TOKEN)",
    )
    .action(async (profileUid: string, opts: ApplyProfileCommandOptions) => {
      try {
        const result = await runApplyProfile(profileUid, opts);
        process.exit(result.exitCode);
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
  return cmd;
}

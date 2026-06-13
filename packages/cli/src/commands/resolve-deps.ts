import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  RegistryDependencyResolver,
  type ResolveDepsOutcome,
} from "../services/RegistryDependencyResolver.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { InvalidArgumentsError } from "../utils/errors/index.js";

/**
 * `exocortex resolve-deps` (issue #3513, builds on #3511).
 *
 * Given a checked-out central registry (`kitelev/exoas-registry`) and the
 * identity of an AssetSpace repo, resolve the repo's transitive
 * `exo__AssetSpace_dependsOn` closure and print the git URLs of every
 * dependency to clone. The per-AssetSpace SHACL CI gate uses this to materialise
 * the dependent TBox so cross-repo class references resolve during
 * `validate schema --shapes-mode` (eliminating false-negatives / unresolvable
 * cross-repo warnings).
 *
 * Output formats:
 *   - `urls` (default) — one dependency clone URL per line (self excluded).
 *     Empty output + exit 0 when self has no dependencies.
 *   - `json` — full diagnostic struct (self, dependencies, missing descriptors,
 *     sourceless deps).
 *
 * Exit codes:
 *   - 0  — resolved (even with zero deps), OR self-not-found in lenient mode.
 *   - 2  — self-not-found and `--strict` (CI fail-fast on an unregistered repo).
 *
 * The default lenient behaviour is deliberate: a repo not yet in the registry
 * still validates standalone (no deps to clone) rather than erroring the whole
 * CI run. `--strict` opts into fail-fast for repos that MUST be registered.
 */

export interface ResolveDepsOptions {
  registry: string;
  self: string;
  format?: "urls" | "json";
  strict?: boolean;
}

export async function runResolveDeps(
  options: ResolveDepsOptions,
  io: {
    out?: (msg: string) => void;
    err?: (msg: string) => void;
  } = {},
): Promise<{ exitCode: number; outcome: ResolveDepsOutcome }> {
  const out = io.out ?? ((m: string) => process.stdout.write(`${m}\n`));
  const err = io.err ?? ((m: string) => process.stderr.write(`${m}\n`));

  if (!options.registry) {
    throw new InvalidArgumentsError("--registry <path> is required");
  }
  if (!options.self) {
    throw new InvalidArgumentsError(
      "--self <owner/repo | git-url | namespace> is required",
    );
  }
  const registryPath = resolve(options.registry);
  if (!existsSync(registryPath)) {
    throw new InvalidArgumentsError(
      `Registry path does not exist: ${registryPath}`,
      "Clone kitelev/exoas-registry first, then pass --registry <path>",
    );
  }

  const resolver = new RegistryDependencyResolver({ warn: (m) => err(m) });
  const outcome = await resolver.resolve(registryPath, options.self);
  const format = options.format ?? "urls";

  if (outcome.outcome === "self-not-found") {
    const msg =
      `[resolve-deps] self '${options.self}' not found among ${outcome.descriptorCount} registry descriptor(s) — ` +
      `validating standalone (no dependencies to materialise).`;
    if (options.strict) {
      err(
        `[resolve-deps] STRICT: self '${options.self}' not registered. ` +
          `Add an exo__AssetSpace descriptor to kitelev/exoas-registry.`,
      );
      if (format === "json") out(JSON.stringify(outcome, null, 2));
      return { exitCode: 2, outcome };
    }
    err(msg);
    if (format === "json") out(JSON.stringify(outcome, null, 2));
    // urls format: print nothing (no deps) → caller validates standalone.
    return { exitCode: 0, outcome };
  }

  if (outcome.missingDescriptors.length > 0) {
    err(
      `[resolve-deps] ⚠️  ${outcome.missingDescriptors.length} dangling dependsOn edge(s) (no descriptor in registry): ` +
        outcome.missingDescriptors.join(", "),
    );
  }
  if (outcome.sourceless.length > 0) {
    err(
      `[resolve-deps] ⚠️  ${outcome.sourceless.length} dependency descriptor(s) have no source URL (cannot clone): ` +
        outcome.sourceless.map((d) => d.namespace ?? d.uid).join(", "),
    );
  }

  if (format === "json") {
    out(JSON.stringify(outcome, null, 2));
  } else {
    for (const dep of outcome.dependencies) {
      if (dep.source && dep.source.length > 0) out(dep.source);
    }
  }
  return { exitCode: 0, outcome };
}

export function resolveDepsCommand(): Command {
  return new Command("resolve-deps")
    .description(
      "Resolve an AssetSpace repo's transitive dependsOn closure from the central registry and print dependency clone URLs (issue #3513). Used by the per-AssetSpace SHACL CI gate to materialise dependent TBox.",
    )
    .requiredOption(
      "--registry <path>",
      "Path to a checked-out central registry (kitelev/exoas-registry)",
    )
    .requiredOption(
      "--self <id>",
      "Identity of the calling repo: an owner/repo slug (e.g. kitelev/exoas-exo, matches GitHub's github.repository), a full git URL, or a bare namespace",
    )
    .option(
      "--format <type>",
      "Output format: urls (one clone URL per line) | json (full diagnostics)",
      "urls",
    )
    .option(
      "--strict",
      "Exit non-zero (2) when self is not registered, instead of validating standalone",
      false,
    )
    .action(async (options: ResolveDepsOptions) => {
      try {
        const { exitCode } = await runResolveDeps(options);
        process.exit(exitCode);
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
}

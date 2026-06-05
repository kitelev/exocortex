import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RestPushService } from "../services/RestPushService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { InvalidArgumentsError } from "../utils/errors/index.js";

/**
 * `exocortex experimental` — opt-in unstable features.
 *
 * Everything under this verb is gated behind `EXOCORTEX_EXPERIMENTAL_REST_PUSH=1`
 * (env) OR `--experimental` (flag). Default OFF — normal users are unaffected.
 * APIs here may change or be removed without a major-version bump.
 */
export function experimentalCommand(): Command {
  const cmd = new Command("experimental").description(
    "Opt-in experimental features (gated by EXOCORTEX_EXPERIMENTAL_REST_PUSH=1 or --experimental). Unstable — may change or be removed.",
  );
  cmd.addCommand(restPushCommand());
  return cmd;
}

export interface RestPushOptions {
  repo: string;
  branch: string;
  file: string;
  content?: string;
  contentFile?: string;
  message: string;
  tokenFromGh?: boolean;
  token?: string;
  experimental?: boolean;
  apiBase?: string;
  json?: boolean;
}

/** Minimal push-capable surface — lets tests inject a fake service. */
export interface RestPusher {
  push(
    owner: string,
    repo: string,
    branch: string,
    files: Map<string, string>,
    message: string,
  ): Promise<string>;
}

/** Injectable dependencies for `runRestPush` (all default to real impls). */
export interface RestPushDeps {
  serviceFactory?: (opts: { token: string; apiBase?: string }) => RestPusher;
  ghTokenRunner?: () => string;
  readFileImpl?: (path: string) => string;
  env?: NodeJS.ProcessEnv;
}

export interface RestPushResult {
  ok: true;
  repo: string;
  branch: string;
  file: string;
  sha: string;
  url: string;
  transport: "fetch";
  method: "git-data-api";
}

/** Flag gate: env var `=1` OR `--experimental`. */
export function experimentalEnabled(
  opts: RestPushOptions,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    opts.experimental === true || env.EXOCORTEX_EXPERIMENTAL_REST_PUSH === "1"
  );
}

/** Split `owner/repo` into segments; throw on malformed input. */
export function parseRepoSlug(slug: string): { owner: string; repo: string } {
  if (typeof slug !== "string" || slug.length === 0) {
    throw new InvalidArgumentsError("--repo is required (owner/repo)");
  }
  const parts = slug.split("/");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new InvalidArgumentsError(
      `--repo must be exactly <owner>/<repo>, got: ${slug}`,
    );
  }
  const [owner, repo] = parts;
  // Mirror plugin requireOwnerRepo allowlist — block path-traversal / flag shapes.
  if (/[^a-zA-Z0-9_-]/.test(owner) || /[^a-zA-Z0-9_.-]/.test(repo)) {
    throw new InvalidArgumentsError(
      `--repo has invalid characters in owner/repo: ${slug}`,
    );
  }
  if (
    owner === ".." ||
    repo === ".." ||
    repo.startsWith(".") ||
    repo.startsWith("-") ||
    owner.startsWith("-")
  ) {
    throw new InvalidArgumentsError(
      `--repo has path-traversal/flag pattern: ${slug}`,
    );
  }
  return { owner, repo };
}

/**
 * Pure (testable) core of the rest-push command: validate, resolve content +
 * token, push via the (injectable) service, return a structured result. No
 * `process.exit`, no direct env/fs/network coupling — all injected.
 */
export async function runRestPush(
  options: RestPushOptions,
  deps: RestPushDeps = {},
): Promise<RestPushResult> {
  const env = deps.env ?? process.env;
  const readFileImpl =
    deps.readFileImpl ?? ((p: string) => readFileSync(resolve(p), "utf8"));
  const serviceFactory =
    deps.serviceFactory ?? ((opts) => new RestPushService(opts));

  if (!experimentalEnabled(options, env)) {
    throw new InvalidArgumentsError(
      "rest-push is experimental and opt-in. Enable with EXOCORTEX_EXPERIMENTAL_REST_PUSH=1 or pass --experimental.",
    );
  }

  const { owner, repo } = parseRepoSlug(options.repo);
  const branch = options.branch || "main";

  if (typeof options.message !== "string" || options.message.length === 0) {
    throw new InvalidArgumentsError("--message is required");
  }
  if (typeof options.file !== "string" || options.file.length === 0) {
    throw new InvalidArgumentsError("--file is required");
  }

  // Resolve content: --content inline OR --content-file from disk. Exactly one.
  if (options.content !== undefined && options.contentFile !== undefined) {
    throw new InvalidArgumentsError(
      "Pass exactly one of --content or --content-file, not both",
    );
  }
  let content: string;
  if (options.content !== undefined) {
    content = options.content;
  } else if (options.contentFile !== undefined) {
    content = readFileImpl(options.contentFile);
  } else {
    throw new InvalidArgumentsError(
      "Provide file content via --content <text> or --content-file <localPath>",
    );
  }

  // Token precedence: --token-from-gh > --token > GITHUB_TOKEN > GH_TOKEN.
  // `||` (not `??`) so an empty-string env var falls through.
  let token: string | undefined;
  if (options.tokenFromGh) {
    token = RestPushService.resolveGhToken(deps.ghTokenRunner);
  } else {
    token = options.token || env.GITHUB_TOKEN || env.GH_TOKEN || undefined;
  }
  if (!token) {
    throw new InvalidArgumentsError(
      "A GitHub token is required to push. Use --token-from-gh, --token <pat>, or set GITHUB_TOKEN / GH_TOKEN.",
    );
  }

  const svc = serviceFactory({ token, apiBase: options.apiBase });
  const files = new Map<string, string>([[options.file, content]]);
  const sha = await svc.push(owner, repo, branch, files, options.message);

  return {
    ok: true,
    repo: `${owner}/${repo}`,
    branch,
    file: options.file,
    sha,
    url: `https://github.com/${owner}/${repo}/commit/${sha}`,
    transport: "fetch",
    method: "git-data-api",
  };
}

/**
 * `exocortex experimental rest-push` — commit+push a file to GitHub via pure
 * REST (no `git` binary). RFC 01a83de8 Phase 0 PoC: de-risks iOS write-back.
 */
export function restPushCommand(): Command {
  return new Command("rest-push")
    .description(
      "EXPERIMENTAL: commit+push a file to a GitHub repo via pure REST Git Data API (no git binary). Gated behind EXOCORTEX_EXPERIMENTAL_REST_PUSH=1 or --experimental.",
    )
    .requiredOption("--repo <owner/repo>", "Target repo as owner/repo")
    .option("--branch <branch>", "Branch to commit on", "main")
    .requiredOption("--file <repoPath>", "Path WITHIN the repo to write")
    .option("--content <text>", "Inline file content")
    .option("--content-file <localPath>", "Read file content from a local path")
    .requiredOption("--message <msg>", "Commit message")
    .option(
      "--token-from-gh",
      "Resolve PAT via `gh auth token` (GitHub CLI must be authenticated)",
      false,
    )
    .option(
      "--token <pat>",
      "GitHub PAT (or env GITHUB_TOKEN / GH_TOKEN). Prefer --token-from-gh.",
    )
    .option(
      "--experimental",
      "Opt into experimental command (alternative to EXOCORTEX_EXPERIMENTAL_REST_PUSH=1)",
      false,
    )
    .option("--api-base <url>", "GitHub API base URL", "https://api.github.com")
    .option("--json", "Emit result as JSON", false)
    .action(async (options: RestPushOptions) => {
      try {
        if (options.json) {
          ErrorHandler.setFormat("json");
        }
        process.stderr.write(
          `[rest-push] Committing ${options.file} → ${options.repo}@${options.branch} via REST (no git binary)...\n`,
        );
        const result = await runRestPush(options);
        if (options.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          process.stdout.write(`\n✓ Pushed via REST (no git binary)\n`);
          process.stdout.write(`  Repo:   ${result.repo}@${result.branch}\n`);
          process.stdout.write(`  File:   ${result.file}\n`);
          process.stdout.write(`  Commit: ${result.sha}\n`);
          process.stdout.write(`  URL:    ${result.url}\n`);
        }
        process.exit(0);
      } catch (e) {
        // Redact any PAT that slipped into the error before ErrorHandler prints.
        // Both message AND stack: ErrorHandler prints err.stack in debug mode,
        // and a frozen stack can retain the original unredacted message.
        const err = e instanceof Error ? e : new Error(String(e));
        const redactor = new RestPushService();
        err.message = redactor.redact(err.message);
        if (err.stack) err.stack = redactor.redact(err.stack);
        ErrorHandler.handle(err);
      }
    });
}

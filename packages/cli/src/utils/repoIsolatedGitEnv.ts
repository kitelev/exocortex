/**
 * git's repository-local environment variables — the list `git rev-parse
 * --local-env-vars` prints (git 2.33). Inside a git hook, git exports these for
 * the repository being committed; a `git` child process that inherits them
 * works on THAT repository whatever `-C <dir>` says (`-C` moves the working
 * directory, GIT_DIR still names the repository). git removes exactly these
 * before it runs a command in another repository (submodules), so the CLI does
 * the same before running git against the vault.
 *
 * Test-side twin: packages/test-utils/src/jest/stripRepoGitEnv.cjs (PR #4380);
 * the cli test pins both lists to each other and to git's own output.
 * Req 91b2c01a.
 */
export const REPO_LOCAL_GIT_ENV: readonly string[] = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/** A copy of `base` without git's repository-local variables. */
export function repoIsolatedGitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of REPO_LOCAL_GIT_ENV) delete env[name];
  return env;
}

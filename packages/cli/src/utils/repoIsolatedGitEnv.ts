/**
 * git's repository-local environment variables (`git rev-parse
 * --local-env-vars`, 16 on git 2.33) minus the two config channels. Inside a
 * git hook git exports them for the repository being committed; a `git` child
 * that inherits them works on THAT repository whatever `-C <dir>` says (`-C`
 * moves the working directory, GIT_DIR still names the repository).
 *
 * Kept on purpose: GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT (with the
 * GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n they index). They carry the caller's
 * `-c` and env-provided config — e.g. `safe.directory` in a container — which is
 * not tied to a repository. git keeps them itself when it runs a command inside
 * a submodule (measured on git 2.33: `git -c k=v submodule foreach` and
 * GIT_CONFIG_COUNT both still resolve inside, while GIT_DIR is replaced).
 * Stripping them turned an env-configured `safe.directory` into «dubious
 * ownership» (review of #4388).
 *
 * The jest globalSetup twin (packages/test-utils/src/jest/stripRepoGitEnv.cjs)
 * strips the whole list, config included: there hermetic tests are the goal.
 * Req 91b2c01a.
 */
export const REPO_LOCAL_GIT_ENV: readonly string[] = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
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

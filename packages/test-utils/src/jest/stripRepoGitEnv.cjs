// Jest globalSetup shared by every package's jest config.
//
// Runs once in the jest PARENT process, before any worker is spawned, so every
// worker — and every `git` a test or the code under test spawns without an
// explicit `env` — inherits an environment that does not point at the
// ENCLOSING repository. (Deleting these in a setupFiles* module only edits the
// sandbox's copy of process.env; child_process still uses the real one.)
//
// Why: inside a git hook (pre-commit → lint-staged → jest --findRelatedTests)
// git exports GIT_DIR / GIT_INDEX_FILE / … for the repository being committed.
// A test that runs `git init` / `add -A` / `commit` in a temp dir then operates
// on THAT repository — observed 2026-09-25 (PR #4371): a stray commit deleting
// all 2540 files on the developer's branch and a wedged lint-staged restore.
//
// The list is git's own (`git rev-parse --local-env-vars`, git 2.33): the
// variables git clears before running a subprocess in another repository.
const REPO_LOCAL_GIT_ENV = [
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

async function stripRepoGitEnv(env = process.env) {
  for (const name of REPO_LOCAL_GIT_ENV) delete env[name];
}

module.exports = stripRepoGitEnv;
module.exports.REPO_LOCAL_GIT_ENV = REPO_LOCAL_GIT_ENV;

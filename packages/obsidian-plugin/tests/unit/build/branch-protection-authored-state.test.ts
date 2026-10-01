import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import * as path from "path";

/**
 * Branch-protection state is DERIVED, never authored (issue #4494).
 *
 * `.github/scripts/setup-branch-protection.sh` carried a protection payload as a literal and
 * `.github/BRANCH_PROTECTION.md` told you to run it. MEASURED against the live protection on
 * 2026-10-02 the two disagreed in FOUR fields, not one:
 *
 *   | field                           | the script sent        | live                       |
 *   | required_status_checks.contexts | build-and-test,        | 14 other contexts — and    |
 *   |                                 | e2e-tests              | `e2e-tests` exists only as |
 *   |                                 |                        | a NON-REQUIRED aggregator  |
 *   | enforce_admins                  | true                   | false                      |
 *   | required_linear_history         | true                   | false                      |
 *   | required_pull_request_reviews   | an object              | absent                     |
 *
 * `PUT /repos/{o}/{r}/branches/{b}/protection` is a FULL REPLACE, so running the script by its
 * own documentation would not have produced "a slightly different protection" — it would have
 * swapped 14 live required contexts for one name nothing emits plus one non-required
 * aggregator, and dropped the admin-enforcement and linear-history settings on the way. It
 * exited 0 and printed a success banner while doing it; the only casualty was the protection,
 * and that is not logged anywhere.
 *
 * ⛤ The defect is a CLASS, not that one script. The same literal lived in
 * `.github/GITHUB_SETTINGS.md` presented as "Current Protection on `main`", and
 * `docs/reference/ci/required-checks.md` — the page the repo DECLARES as its single source —
 * said 13 required checks while the live set had 14 and a comment in `.github/workflows/ci.yml`
 * said 14. So the class is "a document states the protection and drifts from it silently", and
 * these axes judge the class:
 *
 *   • B1/B3 — nobody AUTHORS a protection payload under the scanned roots (B3 covers all four
 *     diverging fields, not just the context list: an axis on `contexts` alone would judge one
 *     quarter of the damage).
 *   • B2 — nobody INSTRUCTS a full-replace `PUT` on the protection object (a `PATCH` of a single
 *     sub-resource stays allowed; that is the safe shape the doc now recommends).
 *   • B4 — nobody states the required-check COUNT as a bare fact. A dated measurement that says
 *     so about itself is fine; `There are N required status checks` is not.
 *   • B5 — the two surviving carriers hand the reader the command that prints the live set.
 *   • B6 — defect B's class: nothing in `.github/scripts/` is referenced by no workflow at all.
 *     `validate-workflows.sh` had ZERO callers repo-wide and required five workflows of which
 *     four no longer exist; a doc reference is NOT execution, which is exactly how the sibling
 *     script stayed "live" while nothing ran it.
 *   • B7 — the two retired scripts stay retired (the instance half).
 *   • B8 — the input canary: the scan has to have actually read the files it judges, otherwise
 *     every verdict above is vacuously green on an empty listing.
 *   • B9 — the positive control: the predicates must RED on the historical shapes. Without it a
 *     clean sweep is indistinguishable from a dead sweep.
 *
 * Issue #4494. Bug-fix / CI-config change — no `@req:` binding (RFC 0003 exempts bug fixes),
 * consistent with the sibling guard axes in this directory.
 */
describe("branch protection is derived, not authored (#4494)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");

  /** Roots whose documents speak about `main`'s protection. `.github/workflows/ci.yml` is in
   * scope as a file but trips none of the predicates: its comment names the set in prose next
   * to the code that reads it from the API at run time. */
  const SCAN_ROOTS = [".github", "docs/reference/ci"];
  const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);

  type ScannedFile = { rel: string; text: string };

  function walk(absDir: string, rel: string, out: ScannedFile[]): void {
    for (const entry of readdirSync(absDir)) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      const abs = path.join(absDir, entry);
      const relPath = rel.length > 0 ? rel + "/" + entry : entry;
      let isDir = false;
      let isFile = false;
      try {
        // statSync FOLLOWS symlinks; Dirent predicates would silently skip a symlinked
        // subtree (harness-invocation-surface §A10).
        const st = statSync(abs);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
      if (isDir) {
        walk(abs, relPath, out);
      } else if (isFile) {
        try {
          out.push({ rel: relPath, text: readFileSync(abs, "utf8") });
        } catch {
          continue;
        }
      }
    }
  }

  function scan(): ScannedFile[] {
    const out: ScannedFile[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = path.join(repoRoot, root);
      if (existsSync(abs)) walk(abs, root, out);
    }
    return out;
  }

  // ---- predicates (pure over text, so B9 can exercise them on fixtures) -------------------

  const AUTHORED_CONTEXTS_RE = /"contexts"\s*:\s*\[/;
  const POLICY_KEY_RE =
    /"(enforce_admins|required_linear_history|required_pull_request_reviews|allow_force_pushes|allow_deletions|block_creations|required_conversation_resolution|lock_branch|allow_fork_syncing)"\s*:/g;
  /** The FULL-REPLACE object — `/protection` not followed by a sub-resource segment. */
  const PROTECTION_OBJECT_RE = /branches\/[^/\s"'`]+\/protection(?![/\w])/;
  const PUT_METHOD_RE = /--method\s+PUT\b/;
  const COUNT_AS_FACT_RE = /\d+\s*\**\s*required\s+(?:status\s+)?checks/i;

  function authorsContextList(text: string): boolean {
    return AUTHORED_CONTEXTS_RE.test(text);
  }

  function authorsPolicyPayload(text: string): boolean {
    const keys = new Set<string>();
    for (const m of text.matchAll(POLICY_KEY_RE)) keys.add(m[1]);
    return keys.size >= 2;
  }

  function instructsFullReplace(text: string): boolean {
    return PUT_METHOD_RE.test(text) && PROTECTION_OBJECT_RE.test(text);
  }

  function statesCountAsFact(text: string): boolean {
    return COUNT_AS_FACT_RE.test(text);
  }

  function orphanScripts(files: ScannedFile[]): string[] {
    const workflows = files.filter((f) =>
      /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.rel),
    );
    const scripts = files.filter((f) =>
      /^\.github\/scripts\/[^/]+$/.test(f.rel),
    );
    return scripts
      .filter((s) => {
        const base = path.basename(s.rel);
        return !workflows.some((w) => w.text.includes(base));
      })
      .map((s) => s.rel);
  }

  const DERIVED_COMMAND =
    "gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks";

  /** Verbatim shape of what `.github/scripts/setup-branch-protection.sh` used to send. */
  const RETIRED_PAYLOAD = [
    "gh api \\",
    "  --method PUT \\",
    '  "/repos/$REPO/branches/$BRANCH/protection" \\',
    "  --input - <<EOF",
    "{",
    '  "required_status_checks": {',
    '    "strict": true,',
    '    "contexts": ["build-and-test", "e2e-tests"]',
    "  },",
    '  "enforce_admins": true,',
    '  "required_linear_history": true',
    "}",
    "EOF",
  ].join("\n");

  const files = scan();

  it("B1 no file under the scanned roots authors a required-check context list", () => {
    expect(
      files.filter((f) => authorsContextList(f.text)).map((f) => f.rel),
    ).toEqual([]);
  });

  it("B2 no file instructs a full-replace PUT on the protection object", () => {
    expect(
      files.filter((f) => instructsFullReplace(f.text)).map((f) => f.rel),
    ).toEqual([]);
  });

  it("B3 no file authors a protection policy payload (all four diverging fields, not just contexts)", () => {
    expect(
      files.filter((f) => authorsPolicyPayload(f.text)).map((f) => f.rel),
    ).toEqual([]);
  });

  it("B4 no file states the required-check count as a bare fact", () => {
    expect(
      files.filter((f) => statesCountAsFact(f.text)).map((f) => f.rel),
    ).toEqual([]);
  });

  it("B5 both surviving carriers hand the reader the command that prints the live set", () => {
    const carriers = [
      ".github/BRANCH_PROTECTION.md",
      "docs/reference/ci/required-checks.md",
    ];
    const missing = carriers.filter((rel) => {
      const f = files.find((x) => x.rel === rel);
      return f === undefined || !f.text.includes(DERIVED_COMMAND);
    });
    expect(missing).toEqual([]);
  });

  it("B6 every file in .github/scripts/ is referenced by at least one workflow", () => {
    expect(orphanScripts(files)).toEqual([]);
  });

  it("B7 the retired scripts stay retired", () => {
    const retired = [
      ".github/scripts/setup-branch-protection.sh",
      ".github/scripts/validate-workflows.sh",
    ];
    expect(
      retired.filter((rel) => existsSync(path.join(repoRoot, rel))),
    ).toEqual([]);
  });

  it("B8 input canary — the scan actually read the files it judges", () => {
    expect(files.length).toBeGreaterThan(10);
    const rels = new Set(files.map((f) => f.rel));
    for (const expected of [
      ".github/BRANCH_PROTECTION.md",
      ".github/GITHUB_SETTINGS.md",
      ".github/workflows/ci.yml",
      ".github/scripts/release-required-gate.mjs",
      "docs/reference/ci/required-checks.md",
    ]) {
      expect(rels.has(expected)).toBe(true);
    }
    // at least one workflow and one script, or B6 would be vacuous
    expect(
      files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.rel))
        .length,
    ).toBeGreaterThan(0);
    expect(
      files.filter((f) => /^\.github\/scripts\/[^/]+$/.test(f.rel)).length,
    ).toBeGreaterThan(0);
  });

  it("B9 positive control — the predicates RED on the historical shapes", () => {
    expect(authorsContextList(RETIRED_PAYLOAD)).toBe(true);
    expect(instructsFullReplace(RETIRED_PAYLOAD)).toBe(true);
    expect(authorsPolicyPayload(RETIRED_PAYLOAD)).toBe(true);
    expect(
      statesCountAsFact("There are **13 required status checks** on `main`:"),
    ).toBe(true);
    // a PATCH of one sub-resource is the shape the doc recommends — must stay allowed
    expect(
      instructsFullReplace(
        "gh api --method PATCH repos/o/r/branches/main/protection/required_status_checks",
      ),
    ).toBe(false);
    // a read-only GET of the whole object must stay allowed
    expect(
      instructsFullReplace("gh api repos/o/r/branches/main/protection"),
    ).toBe(false);
    // orphan detection sees a script no workflow names
    expect(
      orphanScripts([
        {
          rel: ".github/workflows/ci.yml",
          text: "runs: node .github/scripts/alive.mjs",
        },
        { rel: ".github/scripts/alive.mjs", text: "" },
        { rel: ".github/scripts/orphan.sh", text: "" },
      ]),
    ).toEqual([".github/scripts/orphan.sh"]);
  });
});

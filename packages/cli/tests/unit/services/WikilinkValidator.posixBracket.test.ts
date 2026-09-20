import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * Issue #4219 — `[[:space:]]` in a body is a POSIX character class quoted in
 * text, not a link, so the validator must not demand a file for it.
 *
 * ⛔ Before the fix, `set-body` refused any body quoting a bash pattern:
 *
 *     ❌ Error: Wikilink [[:space:]] — file not found in vault      (rc=3)
 *
 * The only escape was `--skip-wikilink-validation`, which drops validation for
 * the WHOLE body — the corpus floor forbids that as a fix, because it silently
 * un-guards every real link in the same note.
 *
 * The skip is the same predicate the indexer uses (`isPosixBracketExpression`,
 * exported from core), so what is not indexed is not validated either: the two
 * sides cannot drift into disagreeing about what counts as a link.
 */

const mockFsAdapter = {
  getMarkdownFiles: jest.fn(),
  getFileMetadata: jest.fn(),
  readFile: jest.fn(),
  fileExists: jest.fn<(path: string) => Promise<boolean>>(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata:
    jest.fn<(query: Record<string, unknown>) => Promise<string[]>>(),
  findFileByUID: jest.fn<(uid: string) => Promise<string | null>>(),
  findFileByUidFilename: jest.fn<(uid: string) => Promise<string | null>>(),
  findFileByLinkpath: jest.fn<(target: string) => Promise<string | null>>(),
};

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => mockFsAdapter),
}));

const { WikilinkValidator, WikilinkNotFoundError } = await import(
  "../../../src/services/WikilinkValidator.js"
);

describe("WikilinkValidator — POSIX bracket expressions (#4219)", () => {
  let validator: InstanceType<typeof WikilinkValidator>;

  beforeEach(() => {
    jest.clearAllMocks();
    validator = new WikilinkValidator(mockFsAdapter as never);
    // Nothing resolves: any target the validator still asks about would throw.
    mockFsAdapter.findFileByLinkpath.mockResolvedValue(null);
    mockFsAdapter.findFileByUID.mockResolvedValue(null);
    mockFsAdapter.findFileByUidFilename.mockResolvedValue(null);
  });

  it("accepts a body quoting a bash pattern with [[:space:]]", async () => {
    await expect(
      validator.validateValue("    grep -qE '(^|[[:space:]])--help'"),
    ).resolves.toBeUndefined();
    // Not merely "did not throw" — the target was never looked up at all.
    expect(mockFsAdapter.findFileByLinkpath).not.toHaveBeenCalled();
  });

  it("accepts the non-Latin documentation form too (#4219 — measured in corpus)", async () => {
    await expect(
      validator.validateValue("`[[:слово:]]` — POSIX character class"),
    ).resolves.toBeUndefined();
  });

  it("accepts the PADDED form — the indexer skips it too (#4301 review)", async () => {
    // The validator trims before the check; the indexer now decides on the
    // trimmed target as well, so both sides agree on `[[ :space: ]]`. Locked on
    // this side too, so a future "simplify the trim away" shows up here.
    await expect(
      validator.validateValue("padded [[ :space: ]] and [[\t:alpha:\t]]"),
    ).resolves.toBeUndefined();
    expect(mockFsAdapter.findFileByLinkpath).not.toHaveBeenCalled();
  });

  it("⛔ still refuses a REAL unresolvable link in the SAME body", async () => {
    // The skip must be targeted. A body that quotes a bash pattern AND carries
    // a genuinely broken link is still refused — otherwise the fix would be a
    // quiet `--skip-wikilink-validation` for the whole value.
    await expect(
      validator.validateValue(
        "grep -qE '[[:space:]]' and also [[flow__NoSuchThing]]",
      ),
    ).rejects.toThrow(WikilinkNotFoundError);
  });

  it("⛔ still refuses a target that merely LOOKS colon-ish but is not the shape", async () => {
    await expect(validator.validateValue("[[:space]]")).rejects.toThrow(
      WikilinkNotFoundError,
    );
    await expect(validator.validateValue("[[space:]]")).rejects.toThrow(
      WikilinkNotFoundError,
    );
  });

  it("a resolving link is still accepted NEXT TO a bracket expression", async () => {
    // ⛔ The first version of this axis mocked `findFileByLinkpath` to resolve
    // EVERY argument, so `:digit:` "resolved" too and the axis stayed green
    // with the guard removed — vacuous. Caught by the revert-verify predicting
    // 3 red and getting 2. The mock now resolves ONLY the real target, so the
    // axis fails the moment `:digit:` reaches the lookup.
    mockFsAdapter.findFileByLinkpath.mockImplementation(async (target: string) =>
      target === "ems__Task" ? "assetspaces/x/ems__Task.md" : null,
    );
    await expect(
      validator.validateValue("[[ems__Task]] next to [[:digit:]]"),
    ).resolves.toBeUndefined();
  });
});

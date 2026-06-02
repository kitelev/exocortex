import {
  GitSubmoduleOps,
  validateVaultPathArg,
  validateGitUrl,
  stripGitmodulesEntry,
  parseGitmodulesPaths,
} from "../../../../src/infrastructure/adapters/GitSubmoduleOps";

describe("validateVaultPathArg", () => {
  it.each([
    "assetspaces/ems",
    "assetspaces/exo",
    "assetspaces/shared-identities",
    "assetspaces/ems/sub/folder",
  ])("accepts %s", (arg) => {
    expect(validateVaultPathArg(arg)).toEqual(arg.replace(/\/+$/, ""));
  });

  it("strips trailing slash", () => {
    expect(validateVaultPathArg("assetspaces/ems/")).toBe("assetspaces/ems");
  });

  it.each([
    "",
    "/absolute/path",
    "assetspaces/../../etc",
    "assetspaces/..",
    "-rf",
    "assetspaces/ems;rm -rf",
    "assetspaces/ems`cmd`",
    "assetspaces/ems$x",
    "assetspaces\nems",
  ])("rejects %s", (arg) => {
    expect(() => validateVaultPathArg(arg)).toThrow();
  });
});

describe("validateGitUrl", () => {
  it.each([
    "https://github.com/test/foo",
    "https://github.com/test/foo.git",
    "https://github.com/kitelev/exocortex-exo-ontology",
    "file:///tmp/test-fixture/repo.git",
  ])("accepts %s", (url) => {
    expect(validateGitUrl(url)).toEqual(url);
  });

  it.each([
    "",
    "http://insecure/foo",
    "javascript:alert(1)",
    "https://evil.com/foo",
    "https://github.com/test/foo;rm -rf",
    "ssh://git@github.com/test/foo",
    "-flag",
  ])("rejects %s", (url) => {
    expect(() => validateGitUrl(url)).toThrow();
  });
});

describe("stripGitmodulesEntry", () => {
  it("removes the stanza for the specified path", () => {
    const input = `[submodule "assetspaces/ems"]
\tpath = assetspaces/ems
\turl = https://github.com/test/ems-ontology
[submodule "assetspaces/kpc"]
\tpath = assetspaces/kpc
\turl = https://github.com/test/kpc-ontology
`;
    const result = stripGitmodulesEntry(input, "assetspaces/ems");
    expect(result).toContain("kpc");
    expect(result).not.toContain('"assetspaces/ems"');
  });

  it("returns input unchanged when stanza not found", () => {
    const input = `[submodule "assetspaces/ems"]
\tpath = assetspaces/ems
\turl = https://github.com/test/ems-ontology
`;
    const result = stripGitmodulesEntry(input, "assetspaces/nonexistent");
    expect(result).toBe(input);
  });

  it("strips correctly when target stanza is last", () => {
    const input = `[submodule "assetspaces/kpc"]
\tpath = assetspaces/kpc
\turl = https://github.com/test/kpc-ontology
[submodule "assetspaces/ems"]
\tpath = assetspaces/ems
\turl = https://github.com/test/ems-ontology
`;
    const result = stripGitmodulesEntry(input, "assetspaces/ems");
    expect(result).toContain("kpc");
    expect(result).not.toContain('"assetspaces/ems"');
  });
});

describe("parseGitmodulesPaths", () => {
  it("extracts all submodule paths", () => {
    const content = `[submodule "assetspaces/ems"]
\tpath = assetspaces/ems
\turl = https://github.com/test/ems-ontology
[submodule "assetspaces/kpc"]
\tpath = assetspaces/kpc
\turl = https://github.com/test/kpc-ontology
`;
    const paths = parseGitmodulesPaths(content);
    expect(paths.has("assetspaces/ems")).toBe(true);
    expect(paths.has("assetspaces/kpc")).toBe(true);
    expect(paths.size).toBe(2);
  });

  it("returns empty set on empty input", () => {
    expect(parseGitmodulesPaths("").size).toBe(0);
  });

  it("ignores malformed stanzas", () => {
    const content = `[submodule "assetspaces/ems"]
no-path-here = whatever
[submodule "assetspaces/kpc"]
\tpath = assetspaces/kpc
\turl = https://github.com/test/kpc-ontology
`;
    const paths = parseGitmodulesPaths(content);
    expect(paths.has("assetspaces/kpc")).toBe(true);
    // ems stanza had no `path =` line so it's not included.
    expect(paths.has("assetspaces/ems")).toBe(false);
  });
});

describe("GitSubmoduleOps.run security", () => {
  it("rejects unknown leading-dash args", async () => {
    const ops = new GitSubmoduleOps({
      vaultRootPath: "/fake",
      execFileFn: jest.fn() as never,
    });
    await expect(ops.run(["-c", "core.x=y", "status"])).rejects.toThrow(/disallowed flag/);
  });

  it("rejects empty arg list", async () => {
    const ops = new GitSubmoduleOps({ vaultRootPath: "/fake", execFileFn: jest.fn() as never });
    await expect(ops.run([])).rejects.toThrow();
  });
});

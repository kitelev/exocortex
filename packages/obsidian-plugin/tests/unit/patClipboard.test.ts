import { resolvePastedSecret } from "@plugin/presentation/settings/patClipboard";

describe("resolvePastedSecret — RFC 0002 §3.9 PAT paste affordance", () => {
  it("trims surrounding whitespace from a pasted token", () => {
    expect(resolvePastedSecret("  github_pat_abc123  ")).toEqual({
      kind: "filled",
      value: "github_pat_abc123",
    });
  });

  it("strips a trailing newline (common when copying a token)", () => {
    expect(resolvePastedSecret("github_pat_abc123\n")).toEqual({
      kind: "filled",
      value: "github_pat_abc123",
    });
  });

  it("reports an empty clipboard rather than clearing the field", () => {
    expect(resolvePastedSecret("")).toEqual({ kind: "empty" });
    expect(resolvePastedSecret("   \n\t ")).toEqual({ kind: "empty" });
  });

  it("preserves an already-clean token verbatim", () => {
    expect(resolvePastedSecret("github_pat_XYZ")).toEqual({
      kind: "filled",
      value: "github_pat_XYZ",
    });
  });
});

import { vaultPathToIRI, iriToVaultPath, OBSIDIAN_VAULT_SCHEME } from "../../../../src/infrastructure/vault/iri";
import "reflect-metadata";
import { NoteToRDFConverter } from "../../../../src/services/NoteToRDFConverter";
import { NullLogger } from "../../../../src/infrastructure/NullLogger";
import type { IVaultAdapter } from "../../../../src/interfaces/IVaultAdapter";

describe("vaultPathToIRI", () => {
  it("uses obsidian://vault/ scheme", () => {
    expect(OBSIDIAN_VAULT_SCHEME).toBe("obsidian://vault/");
  });

  it("encodes spaces to %20 (canonical RFC contract)", () => {
    expect(vaultPathToIRI("03 Knowledge/kitelev/abc.md")).toBe(
      "obsidian://vault/03%20Knowledge/kitelev/abc.md",
    );
  });

  it("preserves forward slashes (not %2F)", () => {
    const iri = vaultPathToIRI("a/b/c.md");
    expect(iri).toBe("obsidian://vault/a/b/c.md");
    expect(iri).not.toContain("%2F");
  });

  it("encodes unicode (cyrillic) characters", () => {
    const iri = vaultPathToIRI("Заметки/Файл.md");
    expect(iri.startsWith("obsidian://vault/")).toBe(true);
    expect(iri).toBe(`obsidian://vault/${encodeURI("Заметки/Файл.md")}`);
  });

  it("strips leading ./ prefix", () => {
    expect(vaultPathToIRI("./03 Knowledge/x.md")).toBe(
      "obsidian://vault/03%20Knowledge/x.md",
    );
  });

  it("handles deeply nested folders", () => {
    expect(vaultPathToIRI("a/b/c/d/e/f/file.md")).toBe(
      "obsidian://vault/a/b/c/d/e/f/file.md",
    );
  });

  it("encodes special chars (#, ?, etc.) like encodeURI", () => {
    expect(vaultPathToIRI("Tasks/Review PR #123.md")).toBe(
      `obsidian://vault/${encodeURI("Tasks/Review PR #123.md")}`,
    );
  });

  it("is idempotent on repeated invocations", () => {
    const path = "01 Areas/02 Projects/My Project.md";
    expect(vaultPathToIRI(path)).toBe(vaultPathToIRI(path));
  });
});

describe("vaultPathToIRI ↔ NoteToRDFConverter.notePathToIRI round-trip", () => {
  const fakeVault = {} as IVaultAdapter;
  const converter = new NoteToRDFConverter(fakeVault, NullLogger);
  const samplePaths = [
    "simple.md",
    "03 Knowledge/kitelev/f2dccb6a-802d-48d3-8e8a-2c4264197692.md",
    "Tasks/Review PR #123.md",
    "01 Areas/02 Projects/My Project.md",
    "Заметки/Мой файл.md",
    "Notes/My (Important) Note [v2].md",
    "a/b/c/d/e/f/deep.md",
    "01 Inbox/GetAreaChain (exo__Query<ems__Area>).md",
    "Generic<Types>/SpecificType.md",
  ];

  it.each(samplePaths)("matches notePathToIRI for path: %s", (path) => {
    expect(vaultPathToIRI(path)).toBe(converter.notePathToIRI(path).value);
  });
});

describe("iriToVaultPath", () => {
  it("strips the obsidian://vault/ prefix", () => {
    expect(iriToVaultPath("obsidian://vault/simple.md")).toBe("simple.md");
  });

  it("URL-decodes %20-encoded spaces", () => {
    expect(iriToVaultPath("obsidian://vault/03%20Knowledge/file.md")).toBe(
      "03 Knowledge/file.md",
    );
  });

  it("decodes unicode (cyrillic) characters", () => {
    expect(
      iriToVaultPath(`obsidian://vault/${encodeURI("Заметки/Файл.md")}`),
    ).toBe("Заметки/Файл.md");
  });

  it("preserves forward slashes (not converted to %2F by encodeURI)", () => {
    expect(iriToVaultPath("obsidian://vault/a/b/c.md")).toBe("a/b/c.md");
  });

  it("returns null for IRIs that don't carry the obsidian://vault/ scheme", () => {
    expect(iriToVaultPath("https://example.com/foo")).toBeNull();
    expect(iriToVaultPath("file:///etc/passwd")).toBeNull();
    expect(iriToVaultPath("not an iri at all")).toBeNull();
  });

  it("returns null for malformed escape sequences", () => {
    // decodeURI throws URIError on malformed %-escape
    expect(iriToVaultPath("obsidian://vault/bad%ZZescape.md")).toBeNull();
  });
});

describe("vaultPathToIRI ↔ iriToVaultPath round-trip", () => {
  const samplePaths = [
    "simple.md",
    "03 Knowledge/kitelev/f2dccb6a-802d-48d3-8e8a-2c4264197692.md",
    "Tasks/Review PR #123.md",
    "01 Areas/02 Projects/My Project.md",
    "Заметки/Мой файл.md",
    "Notes/My (Important) Note [v2].md",
    "a/b/c/d/e/f/deep.md",
    "Generic<Types>/SpecificType.md",
  ];

  it.each(samplePaths)("round-trips path: %s", (path) => {
    const iri = vaultPathToIRI(path);
    expect(iriToVaultPath(iri)).toBe(path);
  });
});

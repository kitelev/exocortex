import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scanVaultNamespaces } from "../../../src/utils/VaultNamespaceScanner.js";

describe("scanVaultNamespaces", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `vault-ns-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return empty map for empty vault", () => {
    const result = scanVaultNamespaces(tempDir);
    expect(result.size).toBe(0);
  });

  it("should detect namespace directories with .md files", () => {
    // Create: 03 Knowledge/kitelev/uuid.md
    const knowledgeDir = join(tempDir, "03 Knowledge");
    const nsDir = join(knowledgeDir, "kitelev");
    mkdirSync(nsDir, { recursive: true });
    writeFileSync(join(nsDir, "test-uuid.md"), "---\n---\n");

    const result = scanVaultNamespaces(tempDir);

    expect(result.has("kitelev")).toBe(true);
    expect(result.get("kitelev")).toBe(
      "obsidian://vault/03%20Knowledge/kitelev/"
    );
  });

  it("should detect multiple namespace directories", () => {
    const knowledgeDir = join(tempDir, "03 Knowledge");

    const ns1 = join(knowledgeDir, "kitelev");
    mkdirSync(ns1, { recursive: true });
    writeFileSync(join(ns1, "file1.md"), "content");

    const ns2 = join(knowledgeDir, "shared");
    mkdirSync(ns2, { recursive: true });
    writeFileSync(join(ns2, "file2.md"), "content");

    const result = scanVaultNamespaces(tempDir);

    expect(result.has("kitelev")).toBe(true);
    expect(result.has("shared")).toBe(true);
  });

  it("should skip directories without .md files", () => {
    const knowledgeDir = join(tempDir, "03 Knowledge");
    const emptyNs = join(knowledgeDir, "emptyns");
    mkdirSync(emptyNs, { recursive: true });
    writeFileSync(join(emptyNs, "readme.txt"), "not markdown");

    const result = scanVaultNamespaces(tempDir);

    expect(result.has("emptyns")).toBe(false);
  });

  it("should skip hidden directories", () => {
    const knowledgeDir = join(tempDir, "03 Knowledge");
    const hiddenNs = join(knowledgeDir, ".hidden");
    mkdirSync(hiddenNs, { recursive: true });
    writeFileSync(join(hiddenNs, "file.md"), "content");

    const result = scanVaultNamespaces(tempDir);

    expect(result.has(".hidden")).toBe(false);
  });

  it("should skip directories with invalid prefix names", () => {
    const knowledgeDir = join(tempDir, "03 Knowledge");
    // Directory name starting with digit (invalid SPARQL prefix)
    const invalidNs = join(knowledgeDir, "123invalid");
    mkdirSync(invalidNs, { recursive: true });
    writeFileSync(join(invalidNs, "file.md"), "content");

    const result = scanVaultNamespaces(tempDir);

    expect(result.has("123invalid")).toBe(false);
  });

  it("should handle directories under different top-level dirs", () => {
    // Create namespaces under different parent dirs
    const dir1 = join(tempDir, "01 Projects");
    const ns1 = join(dir1, "myns");
    mkdirSync(ns1, { recursive: true });
    writeFileSync(join(ns1, "file.md"), "content");

    const result = scanVaultNamespaces(tempDir);

    expect(result.has("myns")).toBe(true);
    expect(result.get("myns")).toBe("obsidian://vault/01%20Projects/myns/");
  });

  it("should return empty map for non-existent vault path", () => {
    const result = scanVaultNamespaces("/non/existent/path");
    expect(result.size).toBe(0);
  });

  it("should encode spaces in parent directory names", () => {
    const knowledgeDir = join(tempDir, "03 Knowledge");
    const nsDir = join(knowledgeDir, "testns");
    mkdirSync(nsDir, { recursive: true });
    writeFileSync(join(nsDir, "file.md"), "content");

    const result = scanVaultNamespaces(tempDir);

    expect(result.get("testns")).toContain("03%20Knowledge");
  });
});

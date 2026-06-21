import {
  IRI,
  type IFile,
  type IFolder,
  type IVaultFileReader,
  vaultPathToIRI,
} from "@kitelev/exocortex-core";
import { ObsidianFileResolver } from "@plugin/infrastructure/ObsidianFileResolver";

describe("ObsidianFileResolver", () => {
  /**
   * Test-only IVaultFileReader: maps paths → IFile/IFolder/null. Lets us
   * exercise every resolution branch without spinning up a real Obsidian
   * vault.
   */
  class FakeVaultReader implements IVaultFileReader {
    private readonly entries = new Map<string, IFile | IFolder>();

    registerFile(path: string): IFile {
      const file: IFile = {
        path,
        basename: path.split("/").pop()!.replace(/\.md$/, ""),
        name: path.split("/").pop()!,
        parent: null,
      };
      this.entries.set(path, file);
      return file;
    }

    registerFolder(path: string): IFolder {
      const folder: IFolder = {
        path,
        name: path.split("/").pop()!,
      };
      this.entries.set(path, folder);
      return folder;
    }

    read(): Promise<string> {
      throw new Error("not used in resolver tests");
    }
    exists(path: string): Promise<boolean> {
      return Promise.resolve(this.entries.has(path));
    }
    getAllFiles(): IFile[] {
      return Array.from(this.entries.values()).filter(
        (e): e is IFile => "basename" in e,
      );
    }
    getAbstractFileByPath(path: string): IFile | IFolder | null {
      return this.entries.get(path) ?? null;
    }
  }

  let reader: FakeVaultReader;
  let resolver: ObsidianFileResolver;

  beforeEach(() => {
    reader = new FakeVaultReader();
    resolver = new ObsidianFileResolver(reader);
  });

  describe("happy paths", () => {
    it("resolves a vault IRI back to its IFile", () => {
      const file = reader.registerFile("simple.md");
      const iri = new IRI(vaultPathToIRI("simple.md"));

      const result = resolver.resolveByIRI(iri);

      expect(result).toBe(file);
    });

    it("URL-decodes %20 in the path correctly", () => {
      const file = reader.registerFile("03 Knowledge/My Note.md");
      const iri = new IRI(vaultPathToIRI("03 Knowledge/My Note.md"));

      const result = resolver.resolveByIRI(iri);

      expect(result).toBe(file);
    });

    it("decodes unicode (cyrillic) paths", () => {
      const file = reader.registerFile("Заметки/Файл.md");
      const iri = new IRI(vaultPathToIRI("Заметки/Файл.md"));

      const result = resolver.resolveByIRI(iri);

      expect(result).toBe(file);
    });

    it("decodes characters reserved by encodeURI (#, ?, etc.)", () => {
      const file = reader.registerFile("Tasks/Review PR #123.md");
      const iri = new IRI(vaultPathToIRI("Tasks/Review PR #123.md"));

      const result = resolver.resolveByIRI(iri);

      expect(result).toBe(file);
    });
  });

  describe("null-returning branches", () => {
    it("returns null when the IRI doesn't carry the obsidian://vault/ scheme", () => {
      const iri = new IRI("https://example.com/some-page.md");
      expect(resolver.resolveByIRI(iri)).toBeNull();
    });

    it("returns null when the path doesn't resolve to anything", () => {
      const iri = new IRI(vaultPathToIRI("not-registered.md"));
      expect(resolver.resolveByIRI(iri)).toBeNull();
    });

    it("returns null when the IRI resolves to a FOLDER, not a file", () => {
      reader.registerFolder("03 Knowledge");
      const iri = new IRI(vaultPathToIRI("03 Knowledge"));
      expect(resolver.resolveByIRI(iri)).toBeNull();
    });

    it("returns null for malformed URL-escape sequences", () => {
      // iriToVaultPath returns null on URIError; resolver propagates null
      const iri = new IRI("obsidian://vault/bad%ZZescape.md");
      expect(resolver.resolveByIRI(iri)).toBeNull();
    });
  });

  describe("contract — exceptions propagate (reserved for genuine I/O errors)", () => {
    it("propagates an exception thrown by the vaultReader", () => {
      const throwingReader: IVaultFileReader = {
        read: () => {
          throw new Error("not used");
        },
        exists: () => Promise.resolve(false),
        getAllFiles: () => [],
        getAbstractFileByPath: () => {
          throw new Error("simulated I/O failure");
        },
      };
      const throwingResolver = new ObsidianFileResolver(throwingReader);
      const iri = new IRI(vaultPathToIRI("any-file.md"));
      expect(() => throwingResolver.resolveByIRI(iri)).toThrow(
        "simulated I/O failure",
      );
    });
  });
});

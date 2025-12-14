import { IVaultContext } from "../../../src/interfaces/IVaultContext";
import { IVaultAdapter, IFile, IFolder, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";

class MockVaultAdapter implements IVaultAdapter {
  async read(_file: IFile): Promise<string> {
    return "mock content";
  }

  async create(path: string, _content: string): Promise<IFile> {
    return { path, basename: path.split("/").pop() || "", name: path, parent: null };
  }

  async modify(_file: IFile, _newContent: string): Promise<void> {}

  async delete(_file: IFile): Promise<void> {}

  async exists(_path: string): Promise<boolean> {
    return true;
  }

  getAbstractFileByPath(_path: string): IFile | IFolder | null {
    return null;
  }

  getAllFiles(): IFile[] {
    return [];
  }

  getFrontmatter(_file: IFile): IFrontmatter | null {
    return null;
  }

  async updateFrontmatter(
    _file: IFile,
    _updater: (current: IFrontmatter) => IFrontmatter,
  ): Promise<void> {}

  async rename(_file: IFile, _newPath: string): Promise<void> {}

  async createFolder(_path: string): Promise<void> {}

  getFirstLinkpathDest(_linkpath: string, _sourcePath: string): IFile | null {
    return null;
  }

  async process(_file: IFile, fn: (content: string) => string): Promise<string> {
    return fn("mock content");
  }

  getDefaultNewFileParent(): IFolder | null {
    return null;
  }

  async updateLinks(
    _oldPath: string,
    _newPath: string,
    _oldBasename: string,
  ): Promise<void> {}
}

class MockVaultContext implements IVaultContext {
  readonly vaultId: string;
  readonly vaultName: string;
  readonly vaultAdapter: IVaultAdapter;
  readonly isActive: boolean;
  readonly vaultPath?: string;

  constructor(
    vaultId: string,
    vaultName: string,
    isActive: boolean = false,
    vaultPath?: string,
  ) {
    this.vaultId = vaultId;
    this.vaultName = vaultName;
    this.vaultAdapter = new MockVaultAdapter();
    this.isActive = isActive;
    this.vaultPath = vaultPath;
  }
}

describe("IVaultContext contract", () => {
  describe("required properties", () => {
    it("should have vaultId", () => {
      const context = new MockVaultContext("vault-1", "My Vault");

      expect(context.vaultId).toBe("vault-1");
    });

    it("should have vaultName", () => {
      const context = new MockVaultContext("vault-1", "My Vault");

      expect(context.vaultName).toBe("My Vault");
    });

    it("should have vaultAdapter", () => {
      const context = new MockVaultContext("vault-1", "My Vault");

      expect(context.vaultAdapter).toBeDefined();
      expect(typeof context.vaultAdapter.read).toBe("function");
    });

    it("should have isActive", () => {
      const context = new MockVaultContext("vault-1", "My Vault", true);

      expect(context.isActive).toBe(true);
    });
  });

  describe("optional properties", () => {
    it("should support optional vaultPath", () => {
      const context = new MockVaultContext(
        "vault-1",
        "My Vault",
        false,
        "/path/to/vault",
      );

      expect(context.vaultPath).toBe("/path/to/vault");
    });

    it("should allow undefined vaultPath", () => {
      const context = new MockVaultContext("vault-1", "My Vault");

      expect(context.vaultPath).toBeUndefined();
    });
  });

  describe("interface compliance", () => {
    it("should be assignable to IVaultContext", () => {
      const context: IVaultContext = new MockVaultContext("vault-1", "My Vault");

      expect(context.vaultId).toBeDefined();
      expect(context.vaultName).toBeDefined();
      expect(context.vaultAdapter).toBeDefined();
      expect(typeof context.isActive).toBe("boolean");
    });

    it("should have consistent property types", () => {
      const context = new MockVaultContext("vault-1", "My Vault", true, "/path");

      expect(typeof context.vaultId).toBe("string");
      expect(typeof context.vaultName).toBe("string");
      expect(typeof context.isActive).toBe("boolean");
      expect(typeof context.vaultPath).toBe("string");
    });
  });

  describe("vault adapter integration", () => {
    it("should provide access to vault operations", async () => {
      const context = new MockVaultContext("vault-1", "My Vault");
      const adapter = context.vaultAdapter;

      const file = await adapter.create("test.md", "content");
      expect(file.path).toBe("test.md");
    });

    it("should allow reading files through adapter", async () => {
      const context = new MockVaultContext("vault-1", "My Vault");
      const adapter = context.vaultAdapter;

      const file: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };

      const content = await adapter.read(file);
      expect(content).toBe("mock content");
    });

    it("should allow checking file existence", async () => {
      const context = new MockVaultContext("vault-1", "My Vault");
      const adapter = context.vaultAdapter;

      const exists = await adapter.exists("test.md");
      expect(exists).toBe(true);
    });
  });

  describe("multiple contexts", () => {
    it("should support multiple independent contexts", () => {
      const context1 = new MockVaultContext("vault-1", "Personal Vault", true);
      const context2 = new MockVaultContext("vault-2", "Work Vault", false);

      expect(context1.vaultId).not.toBe(context2.vaultId);
      expect(context1.isActive).toBe(true);
      expect(context2.isActive).toBe(false);
    });

    it("should have independent vault adapters", () => {
      const context1 = new MockVaultContext("vault-1", "Personal Vault");
      const context2 = new MockVaultContext("vault-2", "Work Vault");

      expect(context1.vaultAdapter).not.toBe(context2.vaultAdapter);
    });
  });
});

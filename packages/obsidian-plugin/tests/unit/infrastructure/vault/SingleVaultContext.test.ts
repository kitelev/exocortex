import { SingleVaultContext } from "../../../../src/infrastructure/vault/SingleVaultContext";
import { IVaultAdapter, IFile, IFolder, IFrontmatter } from "exocortex";

class MockVaultAdapter implements IVaultAdapter {
  async read(_file: IFile): Promise<string> {
    return "mock content";
  }

  async create(path: string, _content: string): Promise<IFile> {
    return {
      path,
      basename: path.split("/").pop() || "",
      name: path,
      parent: null,
    };
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

describe("SingleVaultContext", () => {
  let mockAdapter: IVaultAdapter;

  beforeEach(() => {
    mockAdapter = new MockVaultAdapter();
  });

  describe("constructor", () => {
    it("should create context with required properties", () => {
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
      );

      expect(context.vaultId).toBe("vault-1");
      expect(context.vaultName).toBe("My Vault");
      expect(context.vaultAdapter).toBe(mockAdapter);
      expect(context.isActive).toBe(true);
    });

    it("should create context with optional vaultPath", () => {
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
        true,
        "/path/to/vault",
      );

      expect(context.vaultPath).toBe("/path/to/vault");
    });

    it("should allow undefined vaultPath", () => {
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
      );

      expect(context.vaultPath).toBeUndefined();
    });

    it("should allow setting isActive to false", () => {
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
        false,
      );

      expect(context.isActive).toBe(false);
    });
  });

  describe("vault adapter integration", () => {
    it("should provide access to vault operations", async () => {
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
      );
      const adapter = context.vaultAdapter;

      const file = await adapter.create("test.md", "content");
      expect(file.path).toBe("test.md");
    });

    it("should allow reading files through adapter", async () => {
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
      );
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
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
      );
      const adapter = context.vaultAdapter;

      const exists = await adapter.exists("test.md");
      expect(exists).toBe(true);
    });
  });

  describe("IVaultContext interface compliance", () => {
    it("should have all required properties", () => {
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
      );

      expect(context.vaultId).toBeDefined();
      expect(context.vaultName).toBeDefined();
      expect(context.vaultAdapter).toBeDefined();
      expect(typeof context.isActive).toBe("boolean");
    });

    it("should have consistent property types", () => {
      const context = new SingleVaultContext(
        "vault-1",
        "My Vault",
        mockAdapter,
        true,
        "/path",
      );

      expect(typeof context.vaultId).toBe("string");
      expect(typeof context.vaultName).toBe("string");
      expect(typeof context.isActive).toBe("boolean");
      expect(typeof context.vaultPath).toBe("string");
    });
  });
});

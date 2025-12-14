import { SingleVaultManager } from "../../../../src/infrastructure/vault/SingleVaultManager";
import {
  IVaultContext,
  IVaultAdapter,
  IFile,
  IFolder,
  IFrontmatter,
} from "exocortex";

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

function createMockVaultContext(
  vaultId: string,
  vaultName: string,
  isActive: boolean = true,
): IVaultContext {
  return {
    vaultId,
    vaultName,
    vaultAdapter: new MockVaultAdapter(),
    isActive,
  };
}

describe("SingleVaultManager", () => {
  let manager: SingleVaultManager;
  let vault: IVaultContext;

  beforeEach(() => {
    vault = createMockVaultContext("vault-1", "My Vault", true);
    manager = new SingleVaultManager(vault);
  });

  describe("getCurrentVault", () => {
    it("should return the single vault", () => {
      const current = manager.getCurrentVault();

      expect(current).toBe(vault);
      expect(current.vaultId).toBe("vault-1");
    });
  });

  describe("setCurrentVault", () => {
    it("should accept the current vault id", async () => {
      await expect(manager.setCurrentVault("vault-1")).resolves.toBeUndefined();
    });

    it("should throw for different vault id", async () => {
      await expect(manager.setCurrentVault("other-vault")).rejects.toThrow(
        "Cannot switch to vault other-vault: only single vault vault-1 is available",
      );
    });
  });

  describe("getVault", () => {
    it("should return vault for matching id", () => {
      const result = manager.getVault("vault-1");

      expect(result).toBe(vault);
    });

    it("should return null for non-matching id", () => {
      const result = manager.getVault("other-vault");

      expect(result).toBeNull();
    });
  });

  describe("listVaults", () => {
    it("should return array with single vault", () => {
      const vaults = manager.listVaults();

      expect(vaults).toHaveLength(1);
      expect(vaults[0]).toBe(vault);
    });
  });

  describe("registerVault", () => {
    it("should accept registration of same vault", () => {
      expect(() => manager.registerVault(vault)).not.toThrow();
    });

    it("should throw when registering different vault", () => {
      const otherVault = createMockVaultContext("vault-2", "Other Vault");

      expect(() => manager.registerVault(otherVault)).toThrow(
        "SingleVaultManager does not support multiple vaults. Cannot register vault vault-2",
      );
    });
  });

  describe("unregisterVault", () => {
    it("should throw when unregistering the only vault", () => {
      expect(() => manager.unregisterVault("vault-1")).toThrow(
        "Cannot unregister the only vault in SingleVaultManager",
      );
    });

    it("should not throw for non-existent vault", () => {
      expect(() => manager.unregisterVault("other-vault")).not.toThrow();
    });
  });

  describe("hasVault", () => {
    it("should return true for the single vault", () => {
      expect(manager.hasVault("vault-1")).toBe(true);
    });

    it("should return false for other vaults", () => {
      expect(manager.hasVault("other-vault")).toBe(false);
    });
  });

  describe("getVaultCount", () => {
    it("should always return 1", () => {
      expect(manager.getVaultCount()).toBe(1);
    });
  });

  describe("onVaultChanged", () => {
    it("should return unsubscribe function", () => {
      const callback = jest.fn();
      const unsubscribe = manager.onVaultChanged(callback);

      expect(typeof unsubscribe).toBe("function");
    });

    it("should allow unsubscribe", () => {
      const callback = jest.fn();
      const unsubscribe = manager.onVaultChanged(callback);

      unsubscribe();
    });

    it("should support multiple callbacks", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const unsubscribe1 = manager.onVaultChanged(callback1);
      const unsubscribe2 = manager.onVaultChanged(callback2);

      expect(typeof unsubscribe1).toBe("function");
      expect(typeof unsubscribe2).toBe("function");
    });
  });

  describe("IMultiVaultManager interface compliance", () => {
    it("should implement all required methods", () => {
      expect(typeof manager.getCurrentVault).toBe("function");
      expect(typeof manager.setCurrentVault).toBe("function");
      expect(typeof manager.getVault).toBe("function");
      expect(typeof manager.listVaults).toBe("function");
      expect(typeof manager.registerVault).toBe("function");
      expect(typeof manager.unregisterVault).toBe("function");
      expect(typeof manager.onVaultChanged).toBe("function");
      expect(typeof manager.hasVault).toBe("function");
      expect(typeof manager.getVaultCount).toBe("function");
    });
  });
});

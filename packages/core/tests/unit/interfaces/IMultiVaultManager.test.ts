import { IMultiVaultManager, VaultChangeCallback } from "../../../src/interfaces/IMultiVaultManager";
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

function createMockVaultContext(
  vaultId: string,
  vaultName: string,
  isActive: boolean = false,
): IVaultContext {
  return {
    vaultId,
    vaultName,
    vaultAdapter: new MockVaultAdapter(),
    isActive,
  };
}

class MockMultiVaultManager implements IMultiVaultManager {
  private vaults: Map<string, IVaultContext> = new Map();
  private currentVaultId: string | null = null;
  private callbacks: VaultChangeCallback[] = [];

  getCurrentVault(): IVaultContext {
    if (!this.currentVaultId) {
      throw new Error("No vault is currently active");
    }
    const vault = this.vaults.get(this.currentVaultId);
    if (!vault) {
      throw new Error(`Current vault ${this.currentVaultId} not found`);
    }
    return vault;
  }

  async setCurrentVault(vaultId: string): Promise<void> {
    if (!this.vaults.has(vaultId)) {
      throw new Error(`Vault ${vaultId} not found`);
    }

    const previousId = this.currentVaultId;
    this.currentVaultId = vaultId;

    if (previousId && previousId !== vaultId) {
      const previousVault = this.vaults.get(previousId)!;
      this.vaults.set(previousId, { ...previousVault, isActive: false });
    }

    const newVault = this.vaults.get(vaultId)!;
    const activeVault: IVaultContext = { ...newVault, isActive: true };
    this.vaults.set(vaultId, activeVault);

    this.callbacks.forEach((callback) => callback(activeVault));
  }

  getVault(vaultId: string): IVaultContext | null {
    return this.vaults.get(vaultId) || null;
  }

  listVaults(): IVaultContext[] {
    return Array.from(this.vaults.values());
  }

  registerVault(context: IVaultContext): void {
    if (this.vaults.has(context.vaultId)) {
      throw new Error(`Vault ${context.vaultId} is already registered`);
    }
    this.vaults.set(context.vaultId, context);

    if (!this.currentVaultId) {
      this.currentVaultId = context.vaultId;
    }
  }

  unregisterVault(vaultId: string): void {
    if (this.currentVaultId === vaultId) {
      throw new Error("Cannot unregister the currently active vault");
    }
    this.vaults.delete(vaultId);
  }

  onVaultChanged(callback: VaultChangeCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  hasVault(vaultId: string): boolean {
    return this.vaults.has(vaultId);
  }

  getVaultCount(): number {
    return this.vaults.size;
  }
}

describe("IMultiVaultManager contract", () => {
  let manager: IMultiVaultManager;
  let vault1: IVaultContext;
  let vault2: IVaultContext;
  let vault3: IVaultContext;

  beforeEach(() => {
    manager = new MockMultiVaultManager();
    vault1 = createMockVaultContext("vault-1", "Personal Vault");
    vault2 = createMockVaultContext("vault-2", "Work Vault");
    vault3 = createMockVaultContext("vault-3", "Archive Vault");
  });

  describe("registerVault", () => {
    it("should register a new vault", () => {
      manager.registerVault(vault1);

      expect(manager.hasVault("vault-1")).toBe(true);
    });

    it("should throw when registering duplicate vault", () => {
      manager.registerVault(vault1);

      expect(() => manager.registerVault(vault1)).toThrow(
        "Vault vault-1 is already registered",
      );
    });

    it("should set first registered vault as current", () => {
      manager.registerVault(vault1);

      expect(manager.getCurrentVault().vaultId).toBe("vault-1");
    });
  });

  describe("unregisterVault", () => {
    beforeEach(() => {
      manager.registerVault(vault1);
      manager.registerVault(vault2);
    });

    it("should unregister a vault", async () => {
      await manager.setCurrentVault("vault-1");

      manager.unregisterVault("vault-2");

      expect(manager.hasVault("vault-2")).toBe(false);
    });

    it("should throw when unregistering active vault", async () => {
      await manager.setCurrentVault("vault-1");

      expect(() => manager.unregisterVault("vault-1")).toThrow(
        "Cannot unregister the currently active vault",
      );
    });
  });

  describe("getCurrentVault", () => {
    it("should return current vault", () => {
      manager.registerVault(vault1);

      const current = manager.getCurrentVault();

      expect(current.vaultId).toBe("vault-1");
    });

    it("should throw when no vault is active", () => {
      expect(() => manager.getCurrentVault()).toThrow(
        "No vault is currently active",
      );
    });
  });

  describe("setCurrentVault", () => {
    beforeEach(() => {
      manager.registerVault(vault1);
      manager.registerVault(vault2);
    });

    it("should change current vault", async () => {
      await manager.setCurrentVault("vault-2");

      expect(manager.getCurrentVault().vaultId).toBe("vault-2");
    });

    it("should throw for non-existent vault", async () => {
      await expect(manager.setCurrentVault("unknown")).rejects.toThrow(
        "Vault unknown not found",
      );
    });

    it("should mark new vault as active", async () => {
      await manager.setCurrentVault("vault-2");

      const current = manager.getCurrentVault();
      expect(current.isActive).toBe(true);
    });
  });

  describe("getVault", () => {
    beforeEach(() => {
      manager.registerVault(vault1);
      manager.registerVault(vault2);
    });

    it("should return vault by id", () => {
      const vault = manager.getVault("vault-1");

      expect(vault).not.toBeNull();
      expect(vault?.vaultName).toBe("Personal Vault");
    });

    it("should return null for non-existent vault", () => {
      const vault = manager.getVault("unknown");

      expect(vault).toBeNull();
    });
  });

  describe("listVaults", () => {
    it("should return empty array when no vaults", () => {
      const vaults = manager.listVaults();

      expect(vaults).toEqual([]);
    });

    it("should return all registered vaults", () => {
      manager.registerVault(vault1);
      manager.registerVault(vault2);
      manager.registerVault(vault3);

      const vaults = manager.listVaults();

      expect(vaults.length).toBe(3);
      expect(vaults.map((v) => v.vaultId)).toContain("vault-1");
      expect(vaults.map((v) => v.vaultId)).toContain("vault-2");
      expect(vaults.map((v) => v.vaultId)).toContain("vault-3");
    });
  });

  describe("hasVault", () => {
    it("should return true for registered vault", () => {
      manager.registerVault(vault1);

      expect(manager.hasVault("vault-1")).toBe(true);
    });

    it("should return false for non-registered vault", () => {
      expect(manager.hasVault("vault-1")).toBe(false);
    });
  });

  describe("getVaultCount", () => {
    it("should return 0 for empty manager", () => {
      expect(manager.getVaultCount()).toBe(0);
    });

    it("should return correct count", () => {
      manager.registerVault(vault1);
      manager.registerVault(vault2);

      expect(manager.getVaultCount()).toBe(2);
    });
  });

  describe("onVaultChanged", () => {
    beforeEach(() => {
      manager.registerVault(vault1);
      manager.registerVault(vault2);
    });

    it("should notify when vault changes", async () => {
      const callback = jest.fn();
      manager.onVaultChanged(callback);

      await manager.setCurrentVault("vault-2");

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ vaultId: "vault-2" }),
      );
    });

    it("should return unsubscribe function", async () => {
      const callback = jest.fn();
      const unsubscribe = manager.onVaultChanged(callback);

      unsubscribe();
      await manager.setCurrentVault("vault-2");

      expect(callback).not.toHaveBeenCalled();
    });

    it("should support multiple callbacks", async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      manager.onVaultChanged(callback1);
      manager.onVaultChanged(callback2);

      await manager.setCurrentVault("vault-2");

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe("multi-vault workflow", () => {
    it("should support typical multi-vault workflow", async () => {
      manager.registerVault(vault1);
      manager.registerVault(vault2);
      manager.registerVault(vault3);

      expect(manager.getVaultCount()).toBe(3);
      expect(manager.getCurrentVault().vaultId).toBe("vault-1");

      await manager.setCurrentVault("vault-2");
      expect(manager.getCurrentVault().vaultName).toBe("Work Vault");

      manager.unregisterVault("vault-3");
      expect(manager.getVaultCount()).toBe(2);

      await manager.setCurrentVault("vault-1");
      expect(manager.getCurrentVault().vaultName).toBe("Personal Vault");
    });

    it("should provide vault adapter through context", async () => {
      manager.registerVault(vault1);

      const current = manager.getCurrentVault();
      const adapter = current.vaultAdapter;

      const exists = await adapter.exists("test.md");
      expect(typeof exists).toBe("boolean");
    });
  });
});

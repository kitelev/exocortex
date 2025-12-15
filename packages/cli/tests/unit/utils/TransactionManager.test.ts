import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";

const { TransactionManager } = await import("../../../src/utils/TransactionManager.js");

describe("TransactionManager", () => {
  let manager: InstanceType<typeof TransactionManager>;

  let existsSyncSpy: jest.SpiedFunction<typeof fs.existsSync>;
  let readFileSpy: jest.SpiedFunction<typeof fs.readFile>;
  let writeFileSpy: jest.SpiedFunction<typeof fs.writeFile>;
  let removeSpy: jest.SpiedFunction<typeof fs.remove>;
  let copySpy: jest.SpiedFunction<typeof fs.copy>;

  beforeEach(() => {
    manager = new TransactionManager();

    existsSyncSpy = jest.spyOn(fs, "existsSync");
    readFileSpy = jest.spyOn(fs, "readFile");
    writeFileSpy = jest.spyOn(fs, "writeFile");
    removeSpy = jest.spyOn(fs, "remove");
    copySpy = jest.spyOn(fs, "copy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("begin()", () => {
    it("should create backup of existing file", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue("file content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");

      expect(readFileSpy).toHaveBeenCalledWith("/path/to/file.md", "utf-8");
      expect(writeFileSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/path\/to\/file\.md\.backup\.\d+$/),
        "file content",
        "utf-8"
      );
    });

    it("should throw error for non-existent file", async () => {
      existsSyncSpy.mockReturnValue(false);

      await expect(manager.begin("/path/to/missing.md")).rejects.toThrow(
        "Cannot backup non-existent file"
      );
    });

    it("should track file in transaction", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");

      expect(manager.getTrackedFiles()).toContain("/path/to/file.md");
    });

    it("should support multiple files in transaction", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file1.md");
      await manager.begin("/path/to/file2.md");

      expect(manager.getTrackedFiles()).toHaveLength(2);
      expect(manager.getTrackedFiles()).toContain("/path/to/file1.md");
      expect(manager.getTrackedFiles()).toContain("/path/to/file2.md");
    });
  });

  describe("verify()", () => {
    it("should return true if file unchanged", async () => {
      const content = "original content";
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue(content as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");

      // Same content returns same hash
      const result = await manager.verify("/path/to/file.md");
      expect(result).toBe(true);
    });

    it("should return false if file modified", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy
        .mockResolvedValueOnce("original content" as any)
        .mockResolvedValueOnce("modified content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");

      const result = await manager.verify("/path/to/file.md");
      expect(result).toBe(false);
    });

    it("should return false if file deleted", async () => {
      existsSyncSpy
        .mockReturnValueOnce(true) // begin check
        .mockReturnValueOnce(false); // verify check
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");

      const result = await manager.verify("/path/to/file.md");
      expect(result).toBe(false);
    });

    it("should return true for untracked file", async () => {
      const result = await manager.verify("/path/to/untracked.md");
      expect(result).toBe(true);
    });
  });

  describe("commit()", () => {
    it("should remove backup files", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);
      removeSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");
      await manager.commit();

      expect(removeSpy).toHaveBeenCalled();
      expect(manager.getTrackedFiles()).toHaveLength(0);
    });

    it("should handle missing backup gracefully", async () => {
      existsSyncSpy
        .mockReturnValueOnce(true) // begin check
        .mockReturnValueOnce(false); // commit check - backup doesn't exist
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");

      await expect(manager.commit()).resolves.not.toThrow();
    });

    it("should clear tracked files after commit", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);
      removeSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");
      await manager.commit();

      expect(manager.getTrackedFiles()).toHaveLength(0);
    });
  });

  describe("rollback()", () => {
    it("should restore files from backup", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);
      copySpy.mockResolvedValue(undefined as any);
      removeSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");
      await manager.rollback();

      expect(copySpy).toHaveBeenCalledWith(
        expect.stringMatching(/\.backup\.\d+$/),
        "/path/to/file.md",
        { overwrite: true }
      );
      expect(removeSpy).toHaveBeenCalled();
    });

    it("should handle missing backup gracefully", async () => {
      existsSyncSpy
        .mockReturnValueOnce(true) // begin check
        .mockReturnValueOnce(false); // rollback check - backup doesn't exist
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");

      await expect(manager.rollback()).resolves.not.toThrow();
      expect(copySpy).not.toHaveBeenCalled();
    });

    it("should clear tracked files after rollback", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);
      copySpy.mockResolvedValue(undefined as any);
      removeSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file.md");
      await manager.rollback();

      expect(manager.getTrackedFiles()).toHaveLength(0);
    });
  });

  describe("getTrackedFiles()", () => {
    it("should return empty array initially", () => {
      expect(manager.getTrackedFiles()).toEqual([]);
    });

    it("should return tracked files", async () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSpy.mockResolvedValue("content" as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await manager.begin("/path/to/file1.md");
      await manager.begin("/path/to/file2.md");

      const tracked = manager.getTrackedFiles();
      expect(tracked).toHaveLength(2);
      expect(tracked).toContain("/path/to/file1.md");
      expect(tracked).toContain("/path/to/file2.md");
    });
  });
});

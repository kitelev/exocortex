import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { AssetConversionService } from "../../../src/services/AssetConversionService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

describe("AssetConversionService", () => {
  let service: AssetConversionService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      read: jest.fn<(file: IFile) => Promise<string>>(),
      modify: jest.fn<(file: IFile, content: string) => Promise<void>>(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    service = new (AssetConversionService as any)(mockVault);
  });

  describe("convertTaskToProject", () => {
    it("should replace Task class with Project class", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockResolvedValue(
        '---\nexo__Asset_uid: abc\nexo__Instance_class:\n  - "[[ems__Task]]"\nems__Effort_status: "[[ems__EffortStatusDoing]]"\n---\n\nContent',
      );

      await service.convertTaskToProject(file);

      const updatedContent = mockVault.modify.mock.calls[0][1];
      expect(updatedContent).toContain("ems__Project");
      expect(updatedContent).not.toMatch(/exo__Instance_class:.*ems__Task/);
    });

    it("should preserve other metadata", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockResolvedValue(
        '---\nexo__Asset_uid: abc-123\nexo__Instance_class:\n  - "[[ems__Task]]"\nexo__Asset_label: My Task\n---\n\nContent body',
      );

      await service.convertTaskToProject(file);

      const updatedContent = mockVault.modify.mock.calls[0][1];
      expect(updatedContent).toContain("exo__Asset_uid: abc-123");
      expect(updatedContent).toContain("exo__Asset_label: My Task");
      expect(updatedContent).toContain("Content body");
    });

    it("should return the file", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockResolvedValue(
        '---\nexo__Instance_class:\n  - "[[ems__Task]]"\n---\n',
      );

      const result = await service.convertTaskToProject(file);

      expect(result).toBe(file);
    });

    it("should throw on read error", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockRejectedValue(new Error("Read failed"));

      await expect(service.convertTaskToProject(file)).rejects.toThrow(
        "Failed to convert Task to Project",
      );
    });

    it("should throw on modify error with non-Error", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockResolvedValue(
        '---\nexo__Instance_class:\n  - "[[ems__Task]]"\n---\n',
      );
      mockVault.modify.mockRejectedValue("string error");

      await expect(service.convertTaskToProject(file)).rejects.toThrow(
        "Failed to convert Task to Project",
      );
    });

    it("should handle single-line Instance_class", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockResolvedValue(
        '---\nexo__Instance_class: ["[[ems__Task]]"]\n---\n',
      );

      await service.convertTaskToProject(file);

      const updatedContent = mockVault.modify.mock.calls[0][1];
      expect(updatedContent).toContain("ems__Project");
    });
  });

  describe("convertProjectToTask", () => {
    it("should replace Project class with Task class", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockResolvedValue(
        '---\nexo__Instance_class:\n  - "[[ems__Project]]"\n---\n',
      );

      await service.convertProjectToTask(file);

      const updatedContent = mockVault.modify.mock.calls[0][1];
      expect(updatedContent).toContain("ems__Task");
    });

    it("should throw on read error", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockRejectedValue(new Error("Permission denied"));

      await expect(service.convertProjectToTask(file)).rejects.toThrow(
        "Failed to convert Project to Task",
      );
    });

    it("should throw on modify error with non-Error thrown", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockResolvedValue(
        '---\nexo__Instance_class:\n  - "[[ems__Project]]"\n---\n',
      );
      mockVault.modify.mockRejectedValue(42);

      await expect(service.convertProjectToTask(file)).rejects.toThrow(
        "Failed to convert Project to Task",
      );
    });

    it("should handle content without frontmatter", async () => {
      const file = { path: "test.md", basename: "test" } as IFile;
      mockVault.read.mockResolvedValue("No frontmatter content");

      await service.convertProjectToTask(file);

      expect(mockVault.modify).toHaveBeenCalled();
    });
  });

  // =============================================================================
  // RFC-028 Finding 5 — Convert to Task regression lock
  // =============================================================================
  //
  // Belt-and-suspenders regression lock for the Project→Task conversion service.
  // Per design spec (vault 85440451 §3.1 Triad C): `convertProjectToTask` method
  // already exists and flips class correctly — this block asserts the full
  // behaviour (class flip + per-property preservation) so any future refactor
  // that accidentally drops metadata is caught.
  //
  // Orchestrator decision 2026-04-19T11:45 (per user): Option A — IMPLEMENT
  // Project→Task conversion. Single-branch assertion (no OR).
  //
  // Note: this suite may pass pre-fix (service already works) — the actual
  // end-to-end bug lives in GroundingExecutor wiring (see GroundingExecutor.test.ts
  // EOF block). Kept as regression lock per §3.1.
  // =============================================================================
  describe("convertProjectToTask — regression lock (Finding 5)", () => {
    it("flips exo__Instance_class to [[ems__Task]] and preserves all other frontmatter properties", async () => {
      const projectFile = {
        path: "project.md",
        basename: "project-uuid",
        name: "project.md",
      } as IFile;
      const originalContent = [
        "---",
        "exo__Asset_uid: project-uuid",
        'exo__Asset_label: "Audit Project"',
        'exo__Asset_isDefinedBy: "[[!toos_areas]]"',
        "exo__Instance_class:",
        '  - "[[ems__Project]]"',
        'ems__Effort_area: "[[area-uuid]]"',
        'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
        "exo__Asset_createdAt: 2026-04-19T05:53:45Z",
        "---",
        "",
        "Body content preserved too",
      ].join("\n");
      mockVault.read.mockResolvedValue(originalContent);

      await service.convertProjectToTask(projectFile);

      const updated = mockVault.modify.mock.calls[0][1];

      // Assert: class flipped to ems__Task, no lingering ems__Project reference
      expect(updated).toMatch(/exo__Instance_class:\s*\[?\s*"\[\[ems__Task\]\]"/);
      expect(updated).not.toMatch(
        /exo__Instance_class:[\s\S]*?ems__Project/,
      );

      // Assert: every other frontmatter property preserved verbatim
      expect(updated).toContain("exo__Asset_uid: project-uuid");
      expect(updated).toContain('exo__Asset_label: "Audit Project"');
      expect(updated).toContain('exo__Asset_isDefinedBy: "[[!toos_areas]]"');
      expect(updated).toContain('ems__Effort_area: "[[area-uuid]]"');
      expect(updated).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
      );
      expect(updated).toContain("exo__Asset_createdAt: 2026-04-19T05:53:45Z");

      // Assert: body preserved
      expect(updated).toContain("Body content preserved too");
    });
  });
});

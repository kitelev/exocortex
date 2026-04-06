import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { SupervisionCreationService } from "../../../src/services/SupervisionCreationService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import type { IVaultSettings } from "../../../src/interfaces/IVaultSettings";
import type { SupervisionFormData } from "../../../src/types/SupervisionFormData";

function createMockVaultSettings(): IVaultSettings {
  return {
    getOwnerIdentity: jest.fn<() => string>().mockReturnValue('"[[!kitelev]]"'),
    getDefaultInboxFolder: jest.fn<() => string>().mockReturnValue("01 Inbox"),
    getFleetingNoteClassUID: jest.fn<() => string>().mockReturnValue("fca0a931-a01f-48e4-b72a-4af206c94bc7"),
  };
}

describe("SupervisionCreationService", () => {
  let service: SupervisionCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockVaultSettings: IVaultSettings;

  beforeEach(() => {
    mockVault = {
      create: jest.fn<(path: string, content: string) => Promise<IFile>>(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockVault.create.mockResolvedValue({ path: "01 Inbox/test.md", basename: "test" } as IFile);

    mockVaultSettings = createMockVaultSettings();

    service = new (SupervisionCreationService as any)(mockVault, mockVaultSettings);
  });

  describe("createSupervision", () => {
    const formData: SupervisionFormData = {
      situation: "Meeting at work",
      emotions: "Anxiety, stress",
      thoughts: "I cannot handle this",
      behavior: "Avoidance",
      shortTermConsequences: "Relief",
      longTermConsequences: "Increased anxiety",
      desiredBehavior: "Assertive communication",
    };

    it("should create file in 01 Inbox folder", async () => {
      await service.createSupervision(formData);

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("01 Inbox/"),
        expect.any(String),
      );
    });

    it("should create file with .md extension", async () => {
      await service.createSupervision(formData);

      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).toMatch(/\.md$/);
    });

    it("should include frontmatter with required fields", async () => {
      await service.createSupervision(formData);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("exo__Asset_uid");
      expect(content).toContain("exo__Asset_createdAt");
      expect(content).toContain("exo__Instance_class");
      expect(content).toContain("exo__Asset_isDefinedBy");
    });

    it("should include body with all form fields", async () => {
      await service.createSupervision(formData);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("Meeting at work");
      expect(content).toContain("Anxiety, stress");
      expect(content).toContain("I cannot handle this");
      expect(content).toContain("Avoidance");
      expect(content).toContain("Relief");
      expect(content).toContain("Increased anxiety");
    });
  });

  describe("generateFrontmatter", () => {
    it("should include fleeting note type", () => {
      const fm = service.generateFrontmatter("test-uid");
      expect(fm["ztlk__FleetingNote_type"]).toContain("CBT-Diary Record");
    });

    it("should use provided uid", () => {
      const fm = service.generateFrontmatter("my-custom-uid");
      expect(fm["exo__Asset_uid"]).toBe("my-custom-uid");
    });

    it("should include isDefinedBy", () => {
      const fm = service.generateFrontmatter("uid");
      expect(fm["exo__Asset_isDefinedBy"]).toContain("!kitelev");
    });

    it("should include createdAt timestamp", () => {
      const fm = service.generateFrontmatter("uid");
      expect(fm["exo__Asset_createdAt"]).toBeDefined();
    });
  });

  describe("generateBody", () => {
    it("should format all fields as markdown list", () => {
      const formData: SupervisionFormData = {
        situation: "Test situation",
        emotions: "Test emotions",
        thoughts: "Test thoughts",
        behavior: "Test behavior",
        shortTermConsequences: "Short term",
        longTermConsequences: "Long term",
        desiredBehavior: "Better response",
      };

      const body = service.generateBody(formData);

      expect(body).toContain("- Ситуация/триггер: Test situation");
      expect(body).toContain("- Эмоции: Test emotions");
      expect(body).toContain("- Мысли: Test thoughts");
      expect(body).toContain("- Поведение: Test behavior");
      expect(body).toContain("- Краткосрочные последствия поведения: Short term");
      expect(body).toContain("- Долгосрочные последствия поведения: Long term");
    });
  });
});

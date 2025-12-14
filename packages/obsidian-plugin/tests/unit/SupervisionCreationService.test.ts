import {
  SupervisionCreationService,
  type SupervisionFormData,
} from "exocortex";

describe("SupervisionCreationService", () => {
  let service: SupervisionCreationService;
  let mockVault: any;

  beforeEach(() => {
    mockVault = {
      create: jest.fn().mockResolvedValue({ path: "01 Inbox/test-uuid.md" }),
    };
    service = new SupervisionCreationService(mockVault);
  });

  describe("generateFrontmatter", () => {
    it("should generate frontmatter with all required properties", () => {
      const uid = "test-uuid-12345";
      const frontmatter = service.generateFrontmatter(uid);

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[!kitelev]]"');
      expect(frontmatter.exo__Asset_uid).toBe(uid);
      expect(frontmatter.exo__Asset_createdAt).toBeDefined();
      expect(frontmatter.exo__Instance_class).toEqual([
        '"[[ztlk__FleetingNote]]"',
      ]);
      expect(frontmatter.ztlk__FleetingNote_type).toBe(
        '"[[CBT-Diary Record]]"',
      );
    });

    it("should generate ISO 8601 timestamp for exo__Asset_createdAt", () => {
      const uid = "test-uuid";
      const frontmatter = service.generateFrontmatter(uid);

      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
      expect(frontmatter.exo__Asset_createdAt).toMatch(isoPattern);
    });

    it("should maintain property order: isDefinedBy, uid, createdAt, Instance_class, type", () => {
      const uid = "test-uuid";
      const frontmatter = service.generateFrontmatter(uid);

      const keys = Object.keys(frontmatter);
      expect(keys).toEqual([
        "exo__Asset_isDefinedBy",
        "exo__Asset_uid",
        "exo__Asset_createdAt",
        "exo__Instance_class",
        "ztlk__FleetingNote_type",
      ]);
    });
  });

  describe("generateBody", () => {
    it("should generate body with all 6 fields when all are filled", () => {
      const formData: SupervisionFormData = {
        situation: "Встреча с начальником",
        emotions: "Тревога, страх",
        thoughts: "Меня сейчас будут ругать",
        behavior: "Защищаюсь, оправдываюсь",
        shortTermConsequences: "Конфликт усиливается",
        longTermConsequences: "Потеря доверия",
      };

      const body = service.generateBody(formData);

      expect(body).toContain("- Ситуация/триггер: Встреча с начальником");
      expect(body).toContain("- Эмоции: Тревога, страх");
      expect(body).toContain("- Мысли: Меня сейчас будут ругать");
      expect(body).toContain("- Поведение: Защищаюсь, оправдываюсь");
      expect(body).toContain(
        "- Краткосрочные последствия поведения: Конфликт усиливается",
      );
      expect(body).toContain(
        "- Долгосрочные последствия поведения: Потеря доверия",
      );
    });

    it("should generate body with empty values when fields are not filled", () => {
      const formData: SupervisionFormData = {
        situation: "",
        emotions: "",
        thoughts: "",
        behavior: "",
        shortTermConsequences: "",
        longTermConsequences: "",
      };

      const body = service.generateBody(formData);

      expect(body).toContain("- Ситуация/триггер: ");
      expect(body).toContain("- Эмоции: ");
      expect(body).toContain("- Мысли: ");
      expect(body).toContain("- Поведение: ");
      expect(body).toContain("- Краткосрочные последствия поведения: ");
      expect(body).toContain("- Долгосрочные последствия поведения: ");
    });

    it("should generate body with mix of filled and empty fields", () => {
      const formData: SupervisionFormData = {
        situation: "Критика от коллеги",
        emotions: "",
        thoughts: "Я всё делаю неправильно",
        behavior: "",
        shortTermConsequences: "Замкнулся в себе",
        longTermConsequences: "",
      };

      const body = service.generateBody(formData);

      expect(body).toContain("- Ситуация/триггер: Критика от коллеги");
      expect(body).toContain("- Эмоции: ");
      expect(body).toContain("- Мысли: Я всё делаю неправильно");
      expect(body).toContain("- Поведение: ");
      expect(body).toContain(
        "- Краткосрочные последствия поведения: Замкнулся в себе",
      );
      expect(body).toContain("- Долгосрочные последствия поведения: ");
    });

    it("should separate fields with newlines", () => {
      const formData: SupervisionFormData = {
        situation: "Test",
        emotions: "Test",
        thoughts: "Test",
        behavior: "Test",
        shortTermConsequences: "Test",
        longTermConsequences: "Test",
      };

      const body = service.generateBody(formData);
      const lines = body.split("\n");

      expect(lines).toHaveLength(6);
      expect(lines[0]).toBe("- Ситуация/триггер: Test");
      expect(lines[5]).toBe("- Долгосрочные последствия поведения: Test");
    });
  });

  describe("createSupervision", () => {
    it("should create file in 01 Inbox folder with UUID filename", async () => {
      const formData: SupervisionFormData = {
        situation: "Test situation",
        emotions: "Test emotions",
        thoughts: "Test thoughts",
        behavior: "Test behavior",
        shortTermConsequences: "Test short",
        longTermConsequences: "Test long",
      };

      await service.createSupervision(formData);

      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockVault.create.mock.calls[0];

      expect(filePath).toMatch(
        /^01 Inbox\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/,
      );
    });

    it("should create file with correct frontmatter and body", async () => {
      const formData: SupervisionFormData = {
        situation: "Situation text",
        emotions: "Emotions text",
        thoughts: "Thoughts text",
        behavior: "Behavior text",
        shortTermConsequences: "Short term",
        longTermConsequences: "Long term",
      };

      await service.createSupervision(formData);

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain('exo__Asset_isDefinedBy: "[[!kitelev]]"');
      expect(content).toContain("exo__Asset_uid:");
      expect(content).toContain("exo__Asset_createdAt:");
      expect(content).toContain(
        'exo__Instance_class:\n  - "[[ztlk__FleetingNote]]"',
      );
      expect(content).toContain(
        'ztlk__FleetingNote_type: "[[CBT-Diary Record]]"',
      );

      expect(content).toContain("- Ситуация/триггер: Situation text");
      expect(content).toContain("- Эмоции: Emotions text");
      expect(content).toContain("- Мысли: Thoughts text");
      expect(content).toContain("- Поведение: Behavior text");
      expect(content).toContain(
        "- Краткосрочные последствия поведения: Short term",
      );
      expect(content).toContain(
        "- Долгосрочные последствия поведения: Long term",
      );
    });

    it("should return created file reference", async () => {
      const formData: SupervisionFormData = {
        situation: "",
        emotions: "",
        thoughts: "",
        behavior: "",
        shortTermConsequences: "",
        longTermConsequences: "",
      };

      const result = await service.createSupervision(formData);

      expect(result).toEqual({ path: "01 Inbox/test-uuid.md" });
    });
  });
});

/**
 * Unit tests — GroundingExecutor `body_template` step (homoiconic templating
 * Веха 3, subproject 17f58ebe).
 *
 * The `body_template` step copies a body template's resolved markdown into the
 * BODY of the target file (frontmatter preserved). Source = inline
 * `bodyTemplate` literal OR `templateRef` (an exotemplate__Template asset loaded
 * via the injected TemplateLoaderPort). `$token` markers resolve via the shared
 * SubstitutionResolverRegistry (Веха 4). Inside a composite it writes into the
 * most-recently created asset (the composite threads create_instance's openPath).
 *
 * Uses an in-memory fs (mirrors the real read-after-write contract) so the
 * composite create_instance → body_template thread can be asserted end-to-end.
 */

import {
  GroundingExecutor,
  ServiceRegistry,
  type TemplateLoaderPort,
} from "../../../src/services/GroundingExecutor";
import {
  clearResolvers,
  installDefaultResolvers,
  registerResolver,
} from "../../../src/services/SubstitutionResolverRegistry";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";

/** In-memory fs that honours read-after-write (unlike the bare jest mocks). */
function makeFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const reader = {
    readFile: jest.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    }),
    fileExists: jest.fn(async (path: string) => files.has(path)),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
  const writer = {
    createFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
      return "";
    }),
    updateFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    writeFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    deleteFile: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
  return { files, reader, writer };
}

function gnd(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-bt",
    label: "Body template",
    ...overrides,
  } as unknown as GroundingDefinition;
}

const TARGET_IRI = "https://exocortex.my/assets/area-123";

describe("GroundingExecutor — body_template (Веха 3)", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  describe("standalone — inline bodyTemplate", () => {
    it("replaces the target file's body, preserving frontmatter", async () => {
      const { files, reader, writer } = makeFs({
        "/vault/note.md": "---\nexo__Asset_uid: x\n---\nOLD BODY",
      });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());
      const res = await exec.execute(
        gnd({ type: GroundingType.BODY_TEMPLATE, bodyTemplate: "## Plan\n- step" }),
        TARGET_IRI,
        "/vault/note.md",
      );
      expect(res.success).toBe(true);
      expect(files.get("/vault/note.md")).toBe(
        "---\nexo__Asset_uid: x\n---\n## Plan\n- step",
      );
    });

    it("resolves $token markers in the body", async () => {
      registerResolver("nowDate", () => "2026-06-20");
      const { files, reader, writer } = makeFs({
        "/vault/n.md": "---\na: b\n---\n",
      });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());
      await exec.execute(
        gnd({
          type: GroundingType.BODY_TEMPLATE,
          bodyTemplate: "## Log\n- opened $nowDate",
        }),
        TARGET_IRI,
        "/vault/n.md",
      );
      expect(files.get("/vault/n.md")).toBe(
        "---\na: b\n---\n## Log\n- opened 2026-06-20",
      );
    });

    it("writes the whole body when the target has no frontmatter", async () => {
      const { files, reader, writer } = makeFs({ "/vault/raw.md": "anything" });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());
      await exec.execute(
        gnd({ type: GroundingType.BODY_TEMPLATE, bodyTemplate: "# Fresh" }),
        TARGET_IRI,
        "/vault/raw.md",
      );
      expect(files.get("/vault/raw.md")).toBe("# Fresh");
    });
  });

  describe("templateRef + TemplateLoaderPort", () => {
    it("loads the referenced template body and writes it", async () => {
      const loader: TemplateLoaderPort = jest.fn(async (uid) =>
        uid === "tpl-1" ? "## From template\n- $nowDate" : null,
      );
      registerResolver("nowDate", () => "2026-06-20");
      const { files, reader, writer } = makeFs({
        "/vault/n.md": "---\na: b\n---\n",
      });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry(), undefined, {
        templateLoader: loader,
      });
      const res = await exec.execute(
        gnd({ type: GroundingType.BODY_TEMPLATE, templateRef: "tpl-1" }),
        TARGET_IRI,
        "/vault/n.md",
      );
      expect(res.success).toBe(true);
      expect(loader).toHaveBeenCalledWith("tpl-1");
      expect(files.get("/vault/n.md")).toBe(
        "---\na: b\n---\n## From template\n- 2026-06-20",
      );
    });

    it("prefers templateRef over inline bodyTemplate when a loader is wired", async () => {
      const loader: TemplateLoaderPort = jest.fn(async () => "FROM REF");
      const { files, reader, writer } = makeFs({ "/vault/n.md": "---\na: b\n---\n" });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry(), undefined, {
        templateLoader: loader,
      });
      await exec.execute(
        gnd({
          type: GroundingType.BODY_TEMPLATE,
          templateRef: "tpl-1",
          bodyTemplate: "INLINE",
        }),
        TARGET_IRI,
        "/vault/n.md",
      );
      expect(files.get("/vault/n.md")).toBe("---\na: b\n---\nFROM REF");
    });

    it("falls back to inline bodyTemplate when templateRef is set but NO loader is wired", async () => {
      const { files, reader, writer } = makeFs({ "/vault/n.md": "---\na: b\n---\n" });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());
      const res = await exec.execute(
        gnd({
          type: GroundingType.BODY_TEMPLATE,
          templateRef: "tpl-1",
          bodyTemplate: "INLINE FALLBACK",
        }),
        TARGET_IRI,
        "/vault/n.md",
      );
      expect(res.success).toBe(true);
      expect(files.get("/vault/n.md")).toBe("---\na: b\n---\nINLINE FALLBACK");
    });

    it("fails loud when templateRef set, no loader, and no inline fallback", async () => {
      const { reader, writer } = makeFs({ "/vault/n.md": "---\na: b\n---\n" });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());
      const res = await exec.execute(
        gnd({ type: GroundingType.BODY_TEMPLATE, templateRef: "tpl-1" }),
        TARGET_IRI,
        "/vault/n.md",
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/templateRef.*no TemplateLoaderPort/);
    });

    it("fails loud when the loader returns null (template unresolvable)", async () => {
      const loader: TemplateLoaderPort = jest.fn(async () => null);
      const { reader, writer } = makeFs({ "/vault/n.md": "---\na: b\n---\n" });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry(), undefined, {
        templateLoader: loader,
      });
      const res = await exec.execute(
        gnd({ type: GroundingType.BODY_TEMPLATE, templateRef: "missing" }),
        TARGET_IRI,
        "/vault/n.md",
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/did not resolve to a template body/);
    });
  });

  describe("config errors", () => {
    it("fails loud when neither bodyTemplate nor templateRef is set", async () => {
      const { reader, writer } = makeFs({ "/vault/n.md": "---\na: b\n---\n" });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());
      const res = await exec.execute(
        gnd({ type: GroundingType.BODY_TEMPLATE }),
        TARGET_IRI,
        "/vault/n.md",
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/requires bodyTemplate or templateRef/);
    });
  });

  describe("composite — create_instance THEN body_template threads the created path", () => {
    it("writes the template body into the NEWLY created asset, not the click target", async () => {
      registerResolver("nowDate", () => "2026-06-20");
      const { files, reader, writer } = makeFs({
        "/vault/areas/area-123.md":
          "---\nexo__Asset_uid: area-123\nexo__Asset_label: My Area\n---\nArea body",
      });
      const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

      const composite = gnd({
        type: GroundingType.COMPOSITE,
        steps: [
          gnd({
            id: "step-create",
            type: GroundingType.CREATE_INSTANCE,
            targetClass: "ems__Project",
            targetFolder: "/vault/projects",
          }),
          gnd({
            id: "step-body",
            type: GroundingType.BODY_TEMPLATE,
            bodyTemplate: "## Plan\n- created $nowDate",
          }),
        ],
      });

      const res = await exec.execute(
        composite,
        "https://exocortex.my/assets/area-123",
        "/vault/areas/area-123.md",
      );
      expect(res.success).toBe(true);

      // The click-target (area) body is UNCHANGED — body_template wrote elsewhere.
      expect(files.get("/vault/areas/area-123.md")).toContain("Area body");

      // A NEW project file was created under /vault/projects with the template body.
      const created = [...files.entries()].find(
        ([p]) => p.startsWith("/vault/projects/") && p !== "/vault/areas/area-123.md",
      );
      expect(created).toBeDefined();
      const [, createdContent] = created as [string, string];
      expect(createdContent).toContain("## Plan\n- created 2026-06-20");
      // Frontmatter from create_instance is preserved above the templated body.
      expect(createdContent).toMatch(/^---\n[\s\S]*?\n---\n## Plan/);
    });
  });
});

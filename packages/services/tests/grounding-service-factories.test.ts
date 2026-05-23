import { describe, it, expect } from "@jest/globals";
import { FrontmatterService } from "../../exocortex/src/utilities/FrontmatterService";
import {
  createCreateAssetService,
  createCreateRelatedTaskService,
  createCreateRelatedProjectService,
  createArchiveAssetService,
  createCleanPropertiesService,
  createFixMissingLabelService,
  createRenameToUidService,
  createRepairFolderService,
  createPlanForEveningService,
  createUpdatePropertyService,
  createRemovePropertyService,
  createSetStatusService,
  type IPathResolver,
} from "../src/index";

/**
 * Smoke contract tests for the factories re-housed in
 * `@kitelev/exocortex-services`. The factories are pure adapters: they do not
 * read or write the filesystem themselves, they only call into the injected
 * `IVaultAdapter` and the injected domain service. Behavioural parity tests
 * (real fs, vault-shaped fixtures) continue to live in
 * `packages/cli/tests/unit/services/*.test.ts`, since the factories were
 * previously defined inline there. This suite exists to lock in the contract
 * of the new public API: each factory returns an `IGroundingService` whose
 * `execute` resolves a target file via `getAbstractFileByPath(`${IRI}.md`)`
 * and delegates to the injected domain service.
 */

interface StubFile {
  basename: string;
  parent: { path: string };
}

function stubFile(basename: string, parentPath = "Tasks"): StubFile {
  return { basename, parent: { path: parentPath } };
}

function stubVaultAdapter(file: StubFile, frontmatter: Record<string, unknown> = {}) {
  return {
    getAbstractFileByPath: (_path: string) => file as never,
    getFrontmatter: (_f: unknown) => frontmatter,
  } as never;
}

describe("@kitelev/exocortex-services — factory contract", () => {
  it("createCreateRelatedTaskService delegates to GenericAssetCreationService.createAsset with ems__Task", async () => {
    const calls: unknown[] = [];
    const generic = {
      createAsset: async (args: unknown) => {
        calls.push(args);
      },
    } as never;
    const file = stubFile("parent-uid", "Tasks/Inbox");
    const adapter = stubVaultAdapter(file, { exo__Asset_label: "Parent" });
    const service = createCreateRelatedTaskService(adapter, generic);

    await service.execute("parent-uid", { label: "Child Task" });

    expect(calls).toHaveLength(1);
    const arg = calls[0] as { className: string; label: string; folderPath: string };
    expect(arg.className).toBe("ems__Task");
    expect(arg.label).toBe("Child Task");
    expect(arg.folderPath).toBe("Tasks/Inbox");
  });

  it("createCreateRelatedTaskService throws when label is missing", async () => {
    const generic = { createAsset: async () => {} } as never;
    const adapter = stubVaultAdapter(stubFile("uid"));
    const service = createCreateRelatedTaskService(adapter, generic);

    await expect(service.execute("uid", {})).rejects.toThrow(
      /createRelatedTask requires userInput.label/,
    );
  });

  it("createCreateRelatedProjectService delegates with ems__Project class", async () => {
    const calls: unknown[] = [];
    const generic = {
      createAsset: async (args: unknown) => {
        calls.push(args);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("area-uid", "Areas"));
    const service = createCreateRelatedProjectService(adapter, generic);

    await service.execute("area-uid", { label: "New Project" });

    expect((calls[0] as { className: string }).className).toBe("ems__Project");
  });

  it("createArchiveAssetService delegates to ArchiveAssetService.archiveAsset", async () => {
    const seen: unknown[] = [];
    const archive = {
      archiveAsset: async (file: unknown) => {
        seen.push(file);
      },
    } as never;
    const file = stubFile("archive-me");
    const adapter = stubVaultAdapter(file);
    const service = createArchiveAssetService(adapter, archive);

    await service.execute("archive-me");

    expect(seen).toHaveLength(1);
  });

  it("createCleanPropertiesService delegates to PropertyCleanupService", async () => {
    const seen: unknown[] = [];
    const cleanup = {
      cleanEmptyProperties: async (file: unknown) => {
        seen.push(file);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid"));
    const service = createCleanPropertiesService(adapter, cleanup);

    await service.execute("uid");

    expect(seen).toHaveLength(1);
  });

  it("createFixMissingLabelService delegates to FixMissingLabelService", async () => {
    const seen: unknown[] = [];
    const fix = {
      fixMissingLabel: async (file: unknown) => {
        seen.push(file);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid"));
    const service = createFixMissingLabelService(adapter, fix);

    await service.execute("uid");

    expect(seen).toHaveLength(1);
  });

  it("createRenameToUidService passes resolved metadata to the domain service", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const rename = {
      renameToUid: async (file: unknown, meta: unknown) => {
        calls.push([file, meta]);
      },
    } as never;
    const meta = { exo__Asset_uid: "abc123" };
    const adapter = stubVaultAdapter(stubFile("name"), meta);
    const service = createRenameToUidService(adapter, rename);

    await service.execute("name");

    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(meta);
  });

  it("createRepairFolderService throws when expected folder cannot be derived", async () => {
    const folderRepair = {
      getExpectedFolder: async () => null,
      repairFolder: async () => {
        throw new Error("must not be called");
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid", "Wherever"));
    const service = createRepairFolderService(adapter, folderRepair);

    await expect(service.execute("uid")).rejects.toThrow(/cannot determine expected folder/);
  });

  it("createRepairFolderService no-ops when current folder matches expected", async () => {
    let repaired = false;
    const folderRepair = {
      getExpectedFolder: async () => "Tasks",
      repairFolder: async () => {
        repaired = true;
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid", "Tasks"));
    const service = createRepairFolderService(adapter, folderRepair);

    await service.execute("uid");

    expect(repaired).toBe(false);
  });

  it("createRepairFolderService delegates repair when folders differ", async () => {
    const calls: Array<[unknown, string]> = [];
    const folderRepair = {
      getExpectedFolder: async () => "Tasks",
      repairFolder: async (file: unknown, folder: string) => {
        calls.push([file, folder]);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid", "Misplaced"));
    const service = createRepairFolderService(adapter, folderRepair);

    await service.execute("uid");

    expect(calls).toEqual([[expect.anything(), "Tasks"]]);
  });

  it("createPlanForEveningService delegates to TaskStatusService.planForEvening", async () => {
    const seen: unknown[] = [];
    const taskStatus = {
      planForEvening: async (file: unknown) => {
        seen.push(file);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid"));
    const service = createPlanForEveningService(adapter, taskStatus);

    await service.execute("uid");

    expect(seen).toHaveLength(1);
  });

  it("factories throw when target file cannot be resolved", async () => {
    const generic = { createAsset: async () => {} } as never;
    const adapter = {
      getAbstractFileByPath: () => null,
      getFrontmatter: () => ({}),
    } as never;
    const service = createCreateRelatedTaskService(adapter, generic);

    await expect(service.execute("missing-uid", { label: "x" })).rejects.toThrow(
      /Cannot resolve target file/,
    );
  });

  describe("frontmatter-only factories (T1.4)", () => {
    function makeFsStub(initial: Record<string, string>): {
      reads: string[];
      writes: Array<{ path: string; content: string }>;
      adapter: never;
    } {
      const files = new Map(Object.entries(initial));
      const reads: string[] = [];
      const writes: Array<{ path: string; content: string }> = [];
      const adapter = {
        async readFile(path: string): Promise<string> {
          reads.push(path);
          const content = files.get(path);
          if (content === undefined) throw new Error(`not found: ${path}`);
          return content;
        },
        async updateFile(path: string, content: string): Promise<void> {
          if (!files.has(path)) throw new Error(`not found: ${path}`);
          files.set(path, content);
          writes.push({ path, content });
        },
      } as never;
      return { reads, writes, adapter };
    }

    function pathResolver(returns: string): IPathResolver {
      return {
        async resolveTargetPath(): Promise<string> {
          return returns;
        },
      };
    }

    const fmInput = `---\nfoo: bar\n---\nbody\n`;

    it("createUpdatePropertyService rewrites frontmatter property via FrontmatterService", async () => {
      const fs = makeFsStub({ "tasks/x.md": fmInput });
      const service = createUpdatePropertyService(
        fs.adapter,
        new FrontmatterService(),
        pathResolver("tasks/x.md"),
      );
      await service.execute("any-iri", { property: "foo", value: "baz" });
      expect(fs.writes).toHaveLength(1);
      expect(fs.writes[0].path).toBe("tasks/x.md");
      expect(fs.writes[0].content).toMatch(/foo: baz/);
    });

    it("createUpdatePropertyService throws on missing userInput.property", async () => {
      const fs = makeFsStub({});
      const service = createUpdatePropertyService(
        fs.adapter,
        new FrontmatterService(),
        pathResolver("tasks/x.md"),
      );
      await expect(service.execute("iri", { value: "v" })).rejects.toThrow(
        /requires userInput.property/,
      );
    });

    it("createUpdatePropertyService throws on missing userInput.value", async () => {
      const fs = makeFsStub({});
      const service = createUpdatePropertyService(
        fs.adapter,
        new FrontmatterService(),
        pathResolver("tasks/x.md"),
      );
      await expect(service.execute("iri", { property: "foo" })).rejects.toThrow(
        /requires userInput.value/,
      );
    });

    it("createRemovePropertyService removes a property via FrontmatterService", async () => {
      const fs = makeFsStub({ "tasks/x.md": fmInput });
      const service = createRemovePropertyService(
        fs.adapter,
        new FrontmatterService(),
        pathResolver("tasks/x.md"),
      );
      await service.execute("iri", { property: "foo" });
      expect(fs.writes[0].content).not.toMatch(/foo:/);
    });

    it("createRemovePropertyService throws on missing userInput.property", async () => {
      const fs = makeFsStub({});
      const service = createRemovePropertyService(
        fs.adapter,
        new FrontmatterService(),
        pathResolver("tasks/x.md"),
      );
      await expect(service.execute("iri", {})).rejects.toThrow(
        /requires userInput.property/,
      );
    });

    it("createSetStatusService writes ems__Effort_status as wikilink to statusUID", async () => {
      const fs = makeFsStub({ "tasks/x.md": `---\nlabel: x\n---\n` });
      const service = createSetStatusService(
        fs.adapter,
        new FrontmatterService(),
        pathResolver("tasks/x.md"),
      );
      await service.execute("iri", { statusUID: "ems__EffortStatusDone" });
      expect(fs.writes[0].content).toMatch(
        /ems__Effort_status:\s*"\[\[ems__EffortStatusDone\]\]"/,
      );
    });

    it("createSetStatusService throws on missing userInput.statusUID", async () => {
      const fs = makeFsStub({});
      const service = createSetStatusService(
        fs.adapter,
        new FrontmatterService(),
        pathResolver("tasks/x.md"),
      );
      await expect(service.execute("iri", {})).rejects.toThrow(
        /requires userInput.statusUID/,
      );
    });
  });

  describe("createCreateAssetService (Phase 3.5, #3164)", () => {
    /**
     * Parity tests for the shared `createAsset` factory. The plugin's inlined
     * handler (`ServiceRegistryPopulator.ts:126-275`) writes frontmatter as an
     * ordered string array; this factory mirrors that format one-for-one so
     * CLI invocations of `service_call createAsset` produce byte-identical
     * frontmatter to plugin invocations of the same grounding.
     *
     * Assertions hit each branch that previously diverged between CLI (no-op
     * stub) and plugin (inlined logic): label/prototype validation, folder
     * inference from parent path, prototype-suffix stripping, area-vs-parent
     * detection via classResolver, `exo__Asset_isDefinedBy` precedence chain
     * (explicit > inherited > ownerIdentity).
     */

    interface RecordedWrite {
      path: string;
      content: string;
    }

    function makeFsWriter(): {
      writes: RecordedWrite[];
      adapter: never;
    } {
      const writes: RecordedWrite[] = [];
      const adapter = {
        async createFile(path: string, content: string): Promise<string> {
          writes.push({ path, content });
          return path;
        },
        async updateFile(): Promise<void> {},
        async writeFile(): Promise<void> {},
        async deleteFile(): Promise<void> {},
        async renameFile(): Promise<void> {},
      } as never;
      return { writes, adapter };
    }

    interface ParentFixture {
      path: string;
      basename: string;
      frontmatter: Record<string, unknown>;
    }

    function makeVaultAdapter(
      parent: ParentFixture | null,
    ): { calls: { iri?: string }; adapter: never } {
      const calls: { iri?: string } = {};
      const adapter = {
        getAbstractFileByPath: (path: string) => {
          calls.iri = path;
          if (!parent) return null;
          // Mimic `IFile` shape — basename/path/parent fields are read by the
          // plugin-parity logic below.
          return {
            path: parent.path,
            basename: parent.basename,
            name: `${parent.basename}.md`,
            parent: { path: parent.path.includes("/") ? parent.path.substring(0, parent.path.lastIndexOf("/")) : "" },
          } as never;
        },
        getFrontmatter: () => (parent ? parent.frontmatter : null),
      } as never;
      return { calls, adapter };
    }

    function extractFrontmatter(content: string): Record<string, string> {
      // Naive parse — only used inside tests against output we control.
      const out: Record<string, string> = {};
      const fm = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) return out;
      for (const line of fm[1].split("\n")) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const key = line.substring(0, idx).trim();
        const val = line.substring(idx + 1).trim();
        if (key && val) out[key] = val;
      }
      return out;
    }

    it("rejects when prototypeUID is missing", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter(null);
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await expect(
        service.execute("any-iri", { label: "x" }),
      ).rejects.toThrow(/createAsset requires userInput.prototypeUID/);
    });

    it("rejects when label is missing", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter(null);
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await expect(
        service.execute("any-iri", { prototypeUID: "ems__TaskPrototype" }),
      ).rejects.toThrow(/createAsset requires userInput.label/);
    });

    it("strips `Prototype` suffix to derive exo__Instance_class", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter(null);
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("", {
        prototypeUID: "ems__TaskPrototype",
        label: "Strip Test",
        folder: "Inbox",
      });
      expect(fs.writes).toHaveLength(1);
      expect(fs.writes[0].content).toMatch(/exo__Instance_class:\n {2}- "\[\[ems__Task\]\]"/);
      expect(fs.writes[0].content).toMatch(/exo__Asset_prototype: "\[\[ems__TaskPrototype\]\]"/);
    });

    it("keeps prototypeUID verbatim when no Prototype suffix", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter(null);
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("", {
        prototypeUID: "ems__Task",
        label: "Verbatim",
        folder: "Inbox",
      });
      expect(fs.writes[0].content).toMatch(/exo__Asset_prototype: "\[\[ems__Task\]\]"/);
      expect(fs.writes[0].content).toMatch(/- "\[\[ems__Task\]\]"/);
    });

    it("accepts legacy `prototype` key as alias for prototypeUID", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter(null);
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("", {
        prototype: "ems__TaskPrototype",
        label: "Legacy alias",
        folder: "Inbox",
      });
      expect(fs.writes[0].content).toMatch(/exo__Asset_prototype: "\[\[ems__TaskPrototype\]\]"/);
    });

    it("inherits ems__Effort_area from ems__Area parent (symbolic refs)", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter({
        path: "Areas/Area1.md",
        basename: "Area1",
        frontmatter: {
          exo__Instance_class: ["[[ems__Area]]"],
        },
      });
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("Areas/Area1", {
        prototypeUID: "ems__TaskPrototype",
        label: "Task from Area",
      });
      expect(fs.writes).toHaveLength(1);
      const content = fs.writes[0].content;
      expect(content).toMatch(/ems__Effort_area: "\[\[Area1\]\]"/);
      expect(content).not.toMatch(/ems__Effort_parent:/);
      expect(content).toMatch(/ems__Effort_status: "\[\[ems__EffortStatusBacklog\]\]"/);
    });

    it("inherits ems__Effort_parent when parent is not ems__Area", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter({
        path: "Projects/Project1.md",
        basename: "Project1",
        frontmatter: {
          exo__Instance_class: ["[[ems__Project]]"],
        },
      });
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("Projects/Project1", {
        prototypeUID: "ems__TaskPrototype",
        label: "Subtask",
      });
      const content = fs.writes[0].content;
      expect(content).toMatch(/ems__Effort_parent: "\[\[Project1\]\]"/);
      expect(content).not.toMatch(/ems__Effort_area: "\[\[Project1\]\]"/);
    });

    it("forwards ems__Effort_area from non-Area parent (e.g. Project under Area)", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter({
        path: "Projects/Project1.md",
        basename: "Project1",
        frontmatter: {
          exo__Instance_class: ["[[ems__Project]]"],
          ems__Effort_area: "[[Area1]]",
        },
      });
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("Projects/Project1", {
        prototypeUID: "ems__TaskPrototype",
        label: "Sub",
      });
      const content = fs.writes[0].content;
      expect(content).toMatch(/ems__Effort_parent: "\[\[Project1\]\]"/);
      expect(content).toMatch(/ems__Effort_area: "\[\[Area1\]\]"/);
    });

    it("defaults folder from parent path when userInput.folder absent", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter({
        path: "Areas/Sub/Area1.md",
        basename: "Area1",
        frontmatter: { exo__Instance_class: ["[[ems__Area]]"] },
      });
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("Areas/Sub/Area1", {
        prototypeUID: "ems__TaskPrototype",
        label: "Inherits folder",
      });
      expect(fs.writes[0].path.startsWith("Areas/Sub/")).toBe(true);
      expect(fs.writes[0].path.endsWith(".md")).toBe(true);
    });

    it("respects explicit userInput.folder over inferred folder", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter({
        path: "Areas/Area1.md",
        basename: "Area1",
        frontmatter: { exo__Instance_class: ["[[ems__Area]]"] },
      });
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("Areas/Area1", {
        prototypeUID: "ems__TaskPrototype",
        label: "Override",
        folder: "CustomFolder",
      });
      expect(fs.writes[0].path.startsWith("CustomFolder/")).toBe(true);
    });

    it("isDefinedBy precedence: explicit > inherited > ownerIdentity", async () => {
      // Case 1: explicit wins (parent inherited + ownerIdentity present)
      {
        const fs = makeFsWriter();
        const vault = makeVaultAdapter({
          path: "Areas/A.md",
          basename: "A",
          frontmatter: {
            exo__Instance_class: ["[[ems__Area]]"],
            exo__Asset_isDefinedBy: "[[InheritedOwner]]",
          },
        });
        const service = createCreateAssetService(vault.adapter, fs.adapter);
        await service.execute("Areas/A", {
          prototypeUID: "ems__TaskPrototype",
          label: "Case1",
          isDefinedBy: "[[ExplicitOwner]]",
          ownerIdentity: "[[FallbackOwner]]",
        });
        const fm = extractFrontmatter(fs.writes[0].content);
        expect(fm.exo__Asset_isDefinedBy).toBe('"[[ExplicitOwner]]"');
      }

      // Case 2: parent-inherited wins over ownerIdentity (no explicit)
      {
        const fs = makeFsWriter();
        const vault = makeVaultAdapter({
          path: "Areas/A.md",
          basename: "A",
          frontmatter: {
            exo__Instance_class: ["[[ems__Area]]"],
            exo__Asset_isDefinedBy: "[[InheritedOwner]]",
          },
        });
        const service = createCreateAssetService(vault.adapter, fs.adapter);
        await service.execute("Areas/A", {
          prototypeUID: "ems__TaskPrototype",
          label: "Case2",
          ownerIdentity: "[[FallbackOwner]]",
        });
        const fm = extractFrontmatter(fs.writes[0].content);
        expect(fm.exo__Asset_isDefinedBy).toBe('"[[InheritedOwner]]"');
      }

      // Case 3: ownerIdentity wins when no explicit and no parent-inherited
      {
        const fs = makeFsWriter();
        const vault = makeVaultAdapter(null);
        const service = createCreateAssetService(vault.adapter, fs.adapter);
        await service.execute("", {
          prototypeUID: "ems__TaskPrototype",
          label: "Case3",
          folder: "Inbox",
          ownerIdentity: "[[FallbackOwner]]",
        });
        const fm = extractFrontmatter(fs.writes[0].content);
        expect(fm.exo__Asset_isDefinedBy).toBe('"[[FallbackOwner]]"');
      }
    });

    it("writes exo__Asset_uid, createdAt, label, prototype, instance_class always", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter(null);
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("", {
        prototypeUID: "ems__TaskPrototype",
        label: "Required Fields",
        folder: "Inbox",
      });
      const content = fs.writes[0].content;
      expect(content).toMatch(
        /^---\nexo__Asset_uid: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n/,
      );
      expect(content).toMatch(/exo__Asset_createdAt: \d{4}-\d{2}-\d{2}T/);
      expect(content).toMatch(/exo__Asset_label: Required Fields/);
    });

    it("filename uses generated UUID with .md suffix", async () => {
      const fs = makeFsWriter();
      const vault = makeVaultAdapter(null);
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("", {
        prototypeUID: "ems__TaskPrototype",
        label: "Filename Test",
        folder: "Inbox",
      });
      expect(fs.writes[0].path).toMatch(
        /^Inbox\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/,
      );
    });

    it("Area detection works through UID-canon refs via classResolver", async () => {
      // Vault state post UID-canon: `exo__Instance_class: ["[[<uuid>]]"]`. The
      // resolver maps that UUID to symbolic label `ems__Area`, allowing the
      // factory to detect the Area parent even though the literal frontmatter
      // value is a UUID. Mirrors plugin's `createMetadataClassResolver`
      // (Obsidian metadataCache).
      const fs = makeFsWriter();
      const vault = makeVaultAdapter({
        path: "Areas/Area1.md",
        basename: "Area1",
        frontmatter: {
          exo__Instance_class: ["[[82c74542-1b14-4217-b852-d84730484b25]]"],
        },
      });
      const resolver = (uuid: string) =>
        uuid === "82c74542-1b14-4217-b852-d84730484b25"
          ? "ems__Area"
          : null;
      const service = createCreateAssetService(
        vault.adapter,
        fs.adapter,
        resolver,
      );
      await service.execute("Areas/Area1", {
        prototypeUID: "ems__TaskPrototype",
        label: "UID-canon Task",
      });
      const content = fs.writes[0].content;
      expect(content).toMatch(/ems__Effort_area: "\[\[Area1\]\]"/);
    });

    it("falls back to ems__Effort_parent when classResolver returns null", async () => {
      // Same shape as the UID-canon test above, but the resolver returns null
      // (resource not in cache). The factory should NOT detect Area, falling
      // back to the generic parent-relation property.
      const fs = makeFsWriter();
      const vault = makeVaultAdapter({
        path: "Anywhere/Foo.md",
        basename: "Foo",
        frontmatter: {
          exo__Instance_class: ["[[unknown-uuid-1234-5678-90ab-cdef12345678]]"],
        },
      });
      const service = createCreateAssetService(vault.adapter, fs.adapter);
      await service.execute("Anywhere/Foo", {
        prototypeUID: "ems__TaskPrototype",
        label: "Unknown parent class",
      });
      const content = fs.writes[0].content;
      expect(content).toMatch(/ems__Effort_parent: "\[\[Foo\]\]"/);
      expect(content).not.toMatch(/ems__Effort_area: "\[\[Foo\]\]"/);
    });
  });
});

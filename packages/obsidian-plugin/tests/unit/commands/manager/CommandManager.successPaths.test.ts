import {
  setupCommandManagerTest,
  CommandManagerTestContext,
  TFile,
  Notice,
  flushPromises,
} from "./CommandManager.fixtures";

describe("CommandManager - success paths", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
  });

  describe("Command Execution - Repair Folder Special Cases", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should handle repair folder when no expected folder found", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_isDefinedBy: "[[ems__NonExistent]]",
        },
      });

      ctx.mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(null);

      const command = ctx.registeredCommands.get("repair-folder");
      await command.checkCallback(false);

      await flushPromises();

      expect(Notice).toHaveBeenCalledWith("No expected folder found");
    });

    it("should handle repair folder when already in correct folder", async () => {
      ctx.mockFile = {
        basename: "test-file",
        path: "correct-folder/test-file.md",
        parent: { path: "correct-folder" },
      } as unknown as TFile;
      ctx.mockApp.workspace.getActiveFile.mockReturnValue(ctx.mockFile);

      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_isDefinedBy: "[[test-area]]",
        },
      });

      const mockArea = {
        path: "correct-folder/test-area.md",
        parent: { path: "correct-folder" },
      };
      ctx.mockApp.metadataCache.getFirstLinkpathDest = jest
        .fn()
        .mockReturnValue(mockArea);

      const command = ctx.registeredCommands.get("repair-folder");
      await command.checkCallback(false);

      await flushPromises();

      expect(Notice).toHaveBeenCalledWith("Asset is already in correct folder");
    });
  });

  describe("Command Execution - Success Paths", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
      jest.clearAllMocks();
    });

    it("should execute set draft status successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("set-draft-status");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Draft status"),
      );
    });

    it("should execute move to backlog successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "ems__EffortStatusDraft",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("move-to-backlog");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Backlog"));
    });

    it("should execute move to analysis successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "ems__EffortStatusBacklog",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("move-to-analysis");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Analysis"));
    });

    it("should execute move to todo successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "ems__EffortStatusAnalysis",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("move-to-todo");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("ToDo"));
    });

    it("should execute start effort successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "ems__EffortStatusBacklog",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("start-effort");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Started effort"),
      );
    });

    it("should execute plan on today successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "ems__EffortStatusToDo",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("plan-on-today");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Planned on today"),
      );
    });

    it("should execute plan for evening successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "ems__EffortStatusBacklog",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("plan-for-evening");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Planned for evening"),
      );
    });

    it("should execute shift day backward successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_plannedStartTimestamp: "2025-01-20T00:00:00",
        },
      });

      ctx.mockApp.vault.read.mockResolvedValue(
        "---\nems__Effort_plannedStartTimestamp: 2025-01-20T00:00:00\n---",
      );
      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("shift-day-backward");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Day shifted backward"),
      );
    });

    it("should execute shift day forward successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_plannedStartTimestamp: "2025-01-20T00:00:00",
        },
      });

      ctx.mockApp.vault.read.mockResolvedValue(
        "---\nems__Effort_plannedStartTimestamp: 2025-01-20T00:00:00\n---",
      );
      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("shift-day-forward");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Day shifted forward"),
      );
    });

    it("should execute mark done successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "ems__EffortStatusDoing",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("mark-done");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Marked as done"),
      );
    });

    // Skip: TrashEffortCommand requires modal which uses path alias (@plugin/...)
    // that Jest's moduleNameMapper doesn't resolve correctly for mock paths.
    // The command is fully tested in TrashEffortCommand.test.ts
    it.skip("should execute trash effort successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("trash-effort");
      await command.checkCallback(false);

      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Trashed"));
    });

    it("should execute archive task successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "ems__EffortStatusDone",
        },
      });

      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("archive-task");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Archived"));
    });

    it("should execute clean properties successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          empty_prop: "",
        },
      });

      ctx.mockApp.vault.read.mockResolvedValue('---\nempty_prop: ""\n---');
      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("clean-properties");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Cleaned empty properties"),
      );
    });

    it("should execute vote on effort successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_votes: 5,
        },
      });

      ctx.mockApp.vault.read.mockResolvedValue("---\nems__Effort_votes: 5\n---");
      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("vote-on-effort");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Voted"));
    });

    it("should execute copy label to aliases successfully", async () => {
      ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
        },
      });

      ctx.mockApp.vault.read.mockResolvedValue(
        "---\nexo__Asset_label: Test Label\n---",
      );
      ctx.mockApp.vault.modify.mockResolvedValue(undefined);

      const command = ctx.registeredCommands.get("copy-label-to-aliases");
      await command.checkCallback(false);

      await flushPromises();

      expect(ctx.mockApp.vault.modify).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Label copied to aliases"),
      );
    });
  });
});

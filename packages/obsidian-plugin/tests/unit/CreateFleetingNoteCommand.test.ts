import { CreateFleetingNoteCommand } from "../../src/application/commands/CreateFleetingNoteCommand";
import { App, Notice, TFile } from "obsidian";
import {
  FleetingNoteCreationService,
  LoggingService,
} from "exocortex";
import { FleetingNoteModal } from "../../src/presentation/modals/FleetingNoteModal";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { CommandHelpers } from "../../src/application/commands/helpers/CommandHelpers";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));

jest.mock("../../src/presentation/modals/FleetingNoteModal");

jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("CreateFleetingNoteCommand", () => {
  let command: CreateFleetingNoteCommand;
  let mockApp: jest.Mocked<App>;
  let mockFleetingNoteCreationService: jest.Mocked<FleetingNoteCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockTFile: jest.Mocked<TFile>;
  let openFileSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      workspace: {},
    } as unknown as jest.Mocked<App>;

    mockTFile = {
      path: "01 Inbox/test.md",
      basename: "test",
    } as jest.Mocked<TFile>;

    mockFleetingNoteCreationService = {
      createFleetingNote: jest.fn(),
    } as unknown as jest.Mocked<FleetingNoteCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn().mockReturnValue(mockTFile),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    openFileSpy = jest
      .spyOn(CommandHelpers, "openFileInNewTab")
      .mockResolvedValue(undefined);

    command = new CreateFleetingNoteCommand(
      mockApp,
      mockFleetingNoteCreationService,
      mockVaultAdapter,
    );
  });

  afterEach(() => {
    openFileSpy.mockRestore();
  });

  it("should have correct id and name", () => {
    expect(command.id).toBe("create-fleeting-note");
    expect(command.name).toBe("Create fleeting note");
  });

  it("creates fleeting note when modal provides label", async () => {
    const createdFile = {
      basename: "test",
      path: "01 Inbox/test.md",
    };
    mockFleetingNoteCreationService.createFleetingNote.mockResolvedValue(
      createdFile as any,
    );

    (FleetingNoteModal as jest.Mock).mockImplementation((app, callback) => ({
      open: jest.fn(() => {
        callback({ label: "Test note" });
      }),
    }));

    await command.callback();

    expect(FleetingNoteModal).toHaveBeenCalledWith(mockApp, expect.any(Function));
    expect(mockFleetingNoteCreationService.createFleetingNote).toHaveBeenCalledWith("Test note");
    expect(mockVaultAdapter.toTFile).toHaveBeenCalledWith(createdFile);
    expect(openFileSpy).toHaveBeenCalledWith(mockApp, mockTFile);
    expect(Notice).toHaveBeenCalledWith("Fleeting note created: test");
  });

  it("does nothing when modal is cancelled", async () => {
    (FleetingNoteModal as jest.Mock).mockImplementation((app, callback) => ({
      open: jest.fn(() => {
        callback({ label: null });
      }),
    }));

    await command.callback();

    expect(mockFleetingNoteCreationService.createFleetingNote).not.toHaveBeenCalled();
    expect(openFileSpy).not.toHaveBeenCalled();
    expect(Notice).not.toHaveBeenCalled();
  });

  it("handles service errors gracefully", async () => {
    const error = new Error("Vault failure");
    mockFleetingNoteCreationService.createFleetingNote.mockRejectedValue(error);

    (FleetingNoteModal as jest.Mock).mockImplementation((app, callback) => ({
      open: jest.fn(() => {
        callback({ label: "Test note" });
      }),
    }));

    await command.callback();

    expect(LoggingService.error).toHaveBeenCalledWith("Create fleeting note error", error);
    expect(Notice).toHaveBeenCalledWith("Failed to create fleeting note: Vault failure");
  });
});

import { CreateFleetingNoteCommand } from "../../src/application/commands/CreateFleetingNoteCommand";
import { App, Notice, TFile } from "obsidian";
import {
  FleetingNoteCreationService,
  LoggingService,
} from "exocortex";
import { showFleetingNoteModal } from "../../src/presentation/modals/modalSchemas";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { CommandHelpers } from "../../src/application/commands/helpers/CommandHelpers";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));

jest.mock("../../src/presentation/modals/modalSchemas");

jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  LoggingService: {
    error: jest.fn(),
  },
}));

const mockShowFleetingNoteModal = showFleetingNoteModal as jest.MockedFunction<typeof showFleetingNoteModal>;

describe("CreateFleetingNoteCommand", () => {
  let command: CreateFleetingNoteCommand;
  let mockNotifier: any;
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

    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new CreateFleetingNoteCommand(
      mockApp,
      mockFleetingNoteCreationService,
      mockVaultAdapter,
      mockNotifier,
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

    mockShowFleetingNoteModal.mockResolvedValue({ label: "Test note" });

    await command.callback();

    expect(mockShowFleetingNoteModal).toHaveBeenCalledWith(mockApp);
    expect(mockFleetingNoteCreationService.createFleetingNote).toHaveBeenCalledWith("Test note");
    expect(mockVaultAdapter.toTFile).toHaveBeenCalledWith(createdFile);
    expect(openFileSpy).toHaveBeenCalledWith(mockApp, mockTFile);
    expect(mockNotifier.success).toHaveBeenCalledWith("Fleeting note created: test");
  });

  it("does nothing when modal is cancelled", async () => {
    mockShowFleetingNoteModal.mockResolvedValue({ label: null });

    await command.callback();

    expect(mockFleetingNoteCreationService.createFleetingNote).not.toHaveBeenCalled();
    expect(openFileSpy).not.toHaveBeenCalled();
    expect(mockNotifier.success).not.toHaveBeenCalled();
  });

  it("handles service errors gracefully", async () => {
    const error = new Error("Vault failure");
    mockFleetingNoteCreationService.createFleetingNote.mockRejectedValue(error);

    mockShowFleetingNoteModal.mockResolvedValue({ label: "Test note" });

    await command.callback();

    expect(LoggingService.error).toHaveBeenCalledWith("Create fleeting note error", error);
    expect(mockNotifier.error).toHaveBeenCalledWith("Failed to create fleeting note: Vault failure");
  });
});

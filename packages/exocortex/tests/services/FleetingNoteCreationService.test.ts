import "reflect-metadata";
import { FleetingNoteCreationService } from "../../src/services/FleetingNoteCreationService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";
import type { IVaultSettings } from "../../src/interfaces/IVaultSettings";
import { DateFormatter } from "../../src/utilities/DateFormatter";
import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";

jest.mock("../../src/utilities/DateFormatter");
jest.mock("../../src/utilities/MetadataHelpers");
jest.mock("uuid", () => ({ v4: () => "test-uuid-123" }));

function createMockVaultSettings(overrides?: Partial<IVaultSettings>): IVaultSettings {
  return {
    getOwnerIdentity: jest.fn().mockReturnValue('"[[!kitelev]]"'),
    getDefaultInboxFolder: jest.fn().mockReturnValue("01 Inbox"),
    getFleetingNoteClassUID: jest.fn().mockReturnValue("fca0a931-a01f-48e4-b72a-4af206c94bc7"),
    ...overrides,
  };
}

describe("FleetingNoteCreationService", () => {
  let service: FleetingNoteCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockVaultSettings: IVaultSettings;
  const mockTimestamp = "2025-01-15T10:30:00";

  beforeEach(() => {
    mockVault = {
      create: jest.fn(),
      exists: jest.fn().mockResolvedValue(true),
      createFolder: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockVaultSettings = createMockVaultSettings();

    (DateFormatter.toLocalTimestamp as jest.Mock).mockReturnValue(mockTimestamp);
    (MetadataHelpers.buildFileContent as jest.Mock).mockReturnValue("---\nfrontmatter\n---\n");

    service = new FleetingNoteCreationService(mockVault, mockVaultSettings);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("creates fleeting note with trimmed label and expected frontmatter", async () => {
    const createdFile = {
      path: "01 Inbox/test-uuid-123.md",
      basename: "test-uuid-123",
      name: "test-uuid-123.md",
    } as IFile;
    mockVault.create.mockResolvedValue(createdFile);

    const result = await service.createFleetingNote("  My note label  ");

    expect(MetadataHelpers.buildFileContent).toHaveBeenCalledWith({
      exo__Asset_isDefinedBy: '"[[!kitelev]]"',
      exo__Asset_uid: "test-uuid-123",
      exo__Asset_createdAt: mockTimestamp,
      exo__Instance_class: ['"[[fca0a931-a01f-48e4-b72a-4af206c94bc7]]"'],
      exo__Asset_label: "My note label",
      aliases: ["My note label"],
    });
    expect(mockVault.create).toHaveBeenCalledWith(
      "01 Inbox/test-uuid-123.md",
      "---\nfrontmatter\n---\n",
    );
    expect(result).toBe(createdFile);
  });

  it("uses configured owner identity from VaultSettings", async () => {
    const customSettings = createMockVaultSettings({
      getOwnerIdentity: jest.fn().mockReturnValue('"[[!custom-user]]"'),
    });
    const customService = new FleetingNoteCreationService(mockVault, customSettings);

    const createdFile = { path: "01 Inbox/test-uuid-123.md", basename: "test-uuid-123", name: "test-uuid-123.md" } as IFile;
    mockVault.create.mockResolvedValue(createdFile);

    await customService.createFleetingNote("Label");

    expect(MetadataHelpers.buildFileContent).toHaveBeenCalledWith(
      expect.objectContaining({ exo__Asset_isDefinedBy: '"[[!custom-user]]"' }),
    );
  });

  it("uses configured fleeting note class UID from VaultSettings", async () => {
    const customUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const customSettings = createMockVaultSettings({
      getFleetingNoteClassUID: jest.fn().mockReturnValue(customUID),
    });
    const customService = new FleetingNoteCreationService(mockVault, customSettings);

    const createdFile = { path: "01 Inbox/test-uuid-123.md", basename: "test-uuid-123", name: "test-uuid-123.md" } as IFile;
    mockVault.create.mockResolvedValue(createdFile);

    await customService.createFleetingNote("Label");

    expect(MetadataHelpers.buildFileContent).toHaveBeenCalledWith(
      expect.objectContaining({ exo__Instance_class: [`"[[${customUID}]]"`] }),
    );
  });

  it("uses configured inbox folder from VaultSettings", async () => {
    const customSettings = createMockVaultSettings({
      getDefaultInboxFolder: jest.fn().mockReturnValue("02 Custom Inbox"),
    });
    const customService = new FleetingNoteCreationService(mockVault, customSettings);

    const createdFile = { path: "02 Custom Inbox/test-uuid-123.md", basename: "test-uuid-123", name: "test-uuid-123.md" } as IFile;
    mockVault.create.mockResolvedValue(createdFile);

    await customService.createFleetingNote("Label");

    expect(mockVault.create).toHaveBeenCalledWith(
      "02 Custom Inbox/test-uuid-123.md",
      expect.any(String),
    );
  });

  it("propagates vault errors", async () => {
    const error = new Error("Vault create failed");
    mockVault.create.mockRejectedValue(error);

    await expect(service.createFleetingNote("Label")).rejects.toThrow(error);
  });

  it("skips folder creation when inbox folder already exists", async () => {
    (mockVault.exists as jest.Mock).mockResolvedValue(true);
    mockVault.create.mockResolvedValue({ path: "01 Inbox/test-uuid-123.md" } as IFile);

    await service.createFleetingNote("Label");

    expect(mockVault.exists).toHaveBeenCalledWith("01 Inbox");
    expect(mockVault.createFolder).not.toHaveBeenCalled();
    expect(mockVault.create).toHaveBeenCalled();
  });

  it("auto-creates inbox folder when missing before writing the note", async () => {
    (mockVault.exists as jest.Mock).mockResolvedValue(false);
    mockVault.create.mockResolvedValue({ path: "01 Inbox/test-uuid-123.md" } as IFile);

    await service.createFleetingNote("Label");

    expect(mockVault.exists).toHaveBeenCalledWith("01 Inbox");
    expect(mockVault.createFolder).toHaveBeenCalledWith("01 Inbox");
    expect(mockVault.create).toHaveBeenCalledWith(
      "01 Inbox/test-uuid-123.md",
      expect.any(String),
    );

    const existsOrder = (mockVault.exists as jest.Mock).mock.invocationCallOrder[0];
    const createFolderOrder = (mockVault.createFolder as jest.Mock).mock.invocationCallOrder[0];
    const createOrder = (mockVault.create as jest.Mock).mock.invocationCallOrder[0];
    expect(existsOrder).toBeLessThan(createFolderOrder);
    expect(createFolderOrder).toBeLessThan(createOrder);
  });

  it("propagates createFolder errors and does not attempt to write the note", async () => {
    (mockVault.exists as jest.Mock).mockResolvedValue(false);
    const error = new Error("createFolder failed");
    (mockVault.createFolder as jest.Mock).mockRejectedValue(error);

    await expect(service.createFleetingNote("Label")).rejects.toThrow(error);
    expect(mockVault.create).not.toHaveBeenCalled();
  });
});

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
});

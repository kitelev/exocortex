import { FleetingNoteCreationService } from "../../src/services/FleetingNoteCreationService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";
import { DateFormatter } from "../../src/utilities/DateFormatter";
import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";

jest.mock("../../src/utilities/DateFormatter");
jest.mock("../../src/utilities/MetadataHelpers");
jest.mock("uuid", () => ({ v4: () => "test-uuid-123" }));

describe("FleetingNoteCreationService", () => {
  let service: FleetingNoteCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  const mockTimestamp = "2025-01-15T10:30:00";

  beforeEach(() => {
    mockVault = {
      create: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    (DateFormatter.toLocalTimestamp as jest.Mock).mockReturnValue(mockTimestamp);
    (MetadataHelpers.buildFileContent as jest.Mock).mockReturnValue("---\nfrontmatter\n---\n");

    service = new FleetingNoteCreationService(mockVault);
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
      exo__Instance_class: ['"[[ztlk__FleetingNote]]"'],
      exo__Asset_label: "My note label",
      aliases: ["My note label"],
    });
    expect(mockVault.create).toHaveBeenCalledWith(
      "01 Inbox/test-uuid-123.md",
      "---\nfrontmatter\n---\n",
    );
    expect(result).toBe(createdFile);
  });

  it("propagates vault errors", async () => {
    const error = new Error("Vault create failed");
    mockVault.create.mockRejectedValue(error);

    await expect(service.createFleetingNote("Label")).rejects.toThrow(error);
  });
});

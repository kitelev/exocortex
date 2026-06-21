import { ArchiveAssetService } from "../../src/services/ArchiveAssetService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";

describe("ArchiveAssetService", () => {
  let service: ArchiveAssetService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockFile = {
      path: "03 Knowledge/kitelev/05dc6377.md",
      name: "05dc6377.md",
      basename: "05dc6377",
    } as IFile;

    service = new ArchiveAssetService(mockVault);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("sets archived: true on a Done task without prior archived property", async () => {
    const original = `---
exo__Asset_uid: 05dc6377
exo__Asset_label: Done Task
ems__Effort_status: "[[ems__EffortStatusDone]]"
---

Body.
`;
    mockVault.read.mockResolvedValue(original);

    await service.archiveAsset(mockFile);

    expect(mockVault.modify).toHaveBeenCalledTimes(1);
    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/\narchived: true\n/);
  });

  it("removes aliases property when archiving", async () => {
    const original = `---
exo__Asset_uid: 05dc6377
exo__Asset_label: Done Task
ems__Effort_status: "[[ems__EffortStatusDone]]"
aliases:
  - "Done Task"
  - "Another alias"
---

Body.
`;
    mockVault.read.mockResolvedValue(original);

    await service.archiveAsset(mockFile);

    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/\narchived: true\n/);
    expect(written).not.toMatch(/\naliases:/);
    expect(written).not.toMatch(/- "Done Task"/);
  });

  it("is a no-op when asset is already archived with no aliases (idempotent)", async () => {
    const original = `---
exo__Asset_uid: 05dc6377
exo__Asset_label: Done Task
archived: true
---

Body.
`;
    mockVault.read.mockResolvedValue(original);

    await service.archiveAsset(mockFile);

    expect(mockVault.modify).not.toHaveBeenCalled();
  });

  it("still removes aliases when archived is already true (partial state)", async () => {
    const original = `---
exo__Asset_uid: 05dc6377
exo__Asset_label: Done Task
archived: true
aliases:
  - "Stale alias"
---

Body.
`;
    mockVault.read.mockResolvedValue(original);

    await service.archiveAsset(mockFile);

    expect(mockVault.modify).toHaveBeenCalledTimes(1);
    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/\narchived: true\n/);
    expect(written).not.toMatch(/\naliases:/);
  });

  it("preserves body content unchanged", async () => {
    const original = `---
exo__Asset_uid: 05dc6377
exo__Asset_label: Done Task
---

## Algorithm
- [x] step one
- [x] step two
`;
    mockVault.read.mockResolvedValue(original);

    await service.archiveAsset(mockFile);

    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/## Algorithm\n- \[x\] step one\n- \[x\] step two\n/);
  });

  it("propagates read errors", async () => {
    mockVault.read.mockRejectedValue(new Error("File not found"));

    await expect(service.archiveAsset(mockFile)).rejects.toThrow("File not found");
    expect(mockVault.modify).not.toHaveBeenCalled();
  });
});

import { FixMissingLabelService } from "../../src/services/FixMissingLabelService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";

describe("FixMissingLabelService", () => {
  let service: FixMissingLabelService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockFile = {
      path: "03 Knowledge/kitelev/05dc6377-abc.md",
      name: "05dc6377-abc.md",
      basename: "05dc6377-abc",
    } as IFile;

    service = new FixMissingLabelService(mockVault);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("adds exo__Asset_label = basename when property is absent", async () => {
    const original = `---
exo__Asset_uid: 05dc6377-abc
---

Body.
`;
    mockVault.read.mockResolvedValue(original);

    await service.fixMissingLabel(mockFile);

    expect(mockVault.modify).toHaveBeenCalledTimes(1);
    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/\nexo__Asset_label: 05dc6377-abc\n/);
    expect(written).toContain("exo__Asset_uid: 05dc6377-abc");
  });

  it("sets exo__Asset_label to basename when value is empty string", async () => {
    const original = `---
exo__Asset_uid: 05dc6377-abc
exo__Asset_label: ""
---

Body.
`;
    mockVault.read.mockResolvedValue(original);

    await service.fixMissingLabel(mockFile);

    expect(mockVault.modify).toHaveBeenCalledTimes(1);
    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/\nexo__Asset_label: 05dc6377-abc\n/);
    expect(written).not.toMatch(/exo__Asset_label:\s*""/);
  });

  it("sets exo__Asset_label to basename when value is whitespace-only", async () => {
    const original = `---
exo__Asset_uid: 05dc6377-abc
exo__Asset_label:
---

Body.
`;
    mockVault.read.mockResolvedValue(original);

    await service.fixMissingLabel(mockFile);

    expect(mockVault.modify).toHaveBeenCalledTimes(1);
    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/\nexo__Asset_label: 05dc6377-abc\n/);
  });

  it("is a no-op when exo__Asset_label is already set to a non-empty value", async () => {
    const original = `---
exo__Asset_uid: 05dc6377-abc
exo__Asset_label: "Existing Label"
---

Body.
`;
    mockVault.read.mockResolvedValue(original);

    await service.fixMissingLabel(mockFile);

    expect(mockVault.modify).not.toHaveBeenCalled();
  });

  it("preserves body content unchanged", async () => {
    const original = `---
exo__Asset_uid: 05dc6377-abc
---

## Notes
- point one
- point two
`;
    mockVault.read.mockResolvedValue(original);

    await service.fixMissingLabel(mockFile);

    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/## Notes\n- point one\n- point two\n/);
  });

  it("propagates read errors", async () => {
    mockVault.read.mockRejectedValue(new Error("File not found"));

    await expect(service.fixMissingLabel(mockFile)).rejects.toThrow(
      "File not found",
    );
    expect(mockVault.modify).not.toHaveBeenCalled();
  });

  it("uses file.basename verbatim (no .md stripping — Obsidian TFile contract)", async () => {
    const original = `---
exo__Asset_uid: some-uid
---
`;
    mockVault.read.mockResolvedValue(original);
    const fileNoExt: IFile = {
      path: "folder/Human Readable Name.md",
      name: "Human Readable Name.md",
      basename: "Human Readable Name",
    } as IFile;

    await service.fixMissingLabel(fileNoExt);

    const [, written] = mockVault.modify.mock.calls[0];
    expect(written).toMatch(/exo__Asset_label: Human Readable Name\n/);
  });
});

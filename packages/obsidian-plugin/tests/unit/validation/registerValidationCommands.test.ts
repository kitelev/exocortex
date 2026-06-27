/**
 * registerValidationCommands contract tests (RFC f402002b, M1.5 plugin half).
 * Command ids MUST stay byte-exact (Obsidian persists hotkeys by id) and the
 * callbacks MUST drive the injected thunks. Both commands register
 * UNCONDITIONALLY — there is no Platform.isMobile gate (Desktop↔Mobile parity).
 */
import {
  registerValidateVaultCommand,
  registerScaffoldValidationCommand,
  formatVaultCheckReport,
  formatScaffoldResult,
} from "../../../src/infrastructure/adapters/registerValidationCommands";
import type { OntologyChoice } from "../../../src/infrastructure/adapters/PluginVaultCheckReader";
import type { VaultCheckReport } from "@kitelev/exocortex-core";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Registered {
  id: string;
  name: string;
  callback: () => void;
}
function fakeRegistrar(): { plugin: { addCommand: (c: Registered) => void }; registered: Registered[] } {
  const registered: Registered[] = [];
  return {
    plugin: { addCommand: (c: Registered) => registered.push(c) },
    registered,
  };
}

const PASS_REPORT: VaultCheckReport = {
  totalAssets: 3,
  ok: true,
  results: [{ checkId: "k", label: "uid-uniqueness", status: "pass", findings: [] }],
};

describe("registerValidateVaultCommand", () => {
  it("registers «Validate vault» with the stable id and renders the report — @req:807a8a6d-95d4-49a3-90b0-5e2b8d330d32", async () => {
    const { plugin, registered } = fakeRegistrar();
    const runValidation = jest.fn().mockResolvedValue(PASS_REPORT);
    const notify = jest.fn();

    registerValidateVaultCommand(plugin, { runValidation, notify });

    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe("validate-vault");
    expect(registered[0].name).toBe("Validate vault");

    registered[0].callback();
    await flush();
    expect(runValidation).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("uid-uniqueness");
  });

  it("notifies fail-loud when runValidation throws (never swallows) — @req:807a8a6d-95d4-49a3-90b0-5e2b8d330d32", async () => {
    const { plugin, registered } = fakeRegistrar();
    const notify = jest.fn();
    registerValidateVaultCommand(plugin, {
      runValidation: jest.fn().mockRejectedValue(new Error("store not ready")),
      notify,
    });
    registered[0].callback();
    await flush();
    expect(notify.mock.calls[0][0]).toContain("store not ready");
  });
});

describe("registerScaffoldValidationCommand", () => {
  const ONTOLOGY: OntologyChoice = { uid: "onto-uid", label: "$exo", folder: "assetspaces/exo/exo" };

  it("registers «Scaffold validation settings» with the stable id and scaffolds the picked ontology — @req:0b7ce59c-0486-45b7-94a4-66f266484b1f", async () => {
    const { plugin, registered } = fakeRegistrar();
    const pickOntology = jest.fn().mockResolvedValue(ONTOLOGY);
    const scaffold = jest
      .fn()
      .mockResolvedValue([{ path: "p/u.md", checkId: "k", value: true }]);
    const notify = jest.fn();

    registerScaffoldValidationCommand(plugin, { pickOntology, scaffold, notify });

    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe("scaffold-validation-settings");
    expect(registered[0].name).toBe("Scaffold validation settings");

    registered[0].callback();
    await flush();
    expect(pickOntology).toHaveBeenCalledTimes(1);
    expect(scaffold).toHaveBeenCalledWith(ONTOLOGY);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("writes NOTHING when the picker is cancelled (null) — @req:0b7ce59c-0486-45b7-94a4-66f266484b1f", async () => {
    const { plugin, registered } = fakeRegistrar();
    const scaffold = jest.fn();
    const notify = jest.fn();
    registerScaffoldValidationCommand(plugin, {
      pickOntology: jest.fn().mockResolvedValue(null),
      scaffold,
      notify,
    });
    registered[0].callback();
    await flush();
    expect(scaffold).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("format helpers", () => {
  it("summarises a passing report", () => {
    expect(formatVaultCheckReport(PASS_REPORT)).toContain("all 1 check(s) passed");
  });
  it("flags an enabled-but-empty run", () => {
    expect(
      formatVaultCheckReport({ totalAssets: 0, ok: true, results: [] }),
    ).toContain("no checks enabled");
  });
  it("reports a fail-loud error result", () => {
    const msg = formatVaultCheckReport({
      totalAssets: 1,
      ok: false,
      results: [
        {
          checkId: "k",
          label: "dag-ontology-imports",
          status: "error",
          findings: [],
          errorMessage: "no runner",
        },
      ],
    });
    expect(msg).toContain("FAILED");
    expect(msg).toContain("dag-ontology-imports");
    expect(msg).toContain("no runner");
  });
  it("summarises a scaffold result", () => {
    const msg = formatScaffoldResult(
      { uid: "u", label: "$exo", folder: "f" },
      [
        { path: "a", checkId: "k1", value: true },
        { path: "b", checkId: "k2", value: false },
      ],
    );
    expect(msg).toContain("wrote 2");
    expect(msg).toContain("1 enabled");
  });
});

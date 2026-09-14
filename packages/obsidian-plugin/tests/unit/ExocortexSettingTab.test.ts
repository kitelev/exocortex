import { ExocortexSettingTab } from "../../src/presentation/settings/ExocortexSettingTab";
import { Setting } from "obsidian";
import { createMockApp, createMockPlugin } from "./helpers/testHelpers";

// RFC 0002 §3.6 — the tab is now sectioned (Onboarding & sync / Display /
// Advanced) and the toggles are no longer in a fixed positional order, so
// these tests look up a Setting by NAME (via the capture harness below) rather
// than by array index. The structural section assertions live in
// ExocortexSettingTab.informationArchitecture.test.ts.

interface CapturedToggle {
  setValueArg?: boolean;
  onChangeCb?: (value: boolean) => void | Promise<void>;
}
interface CapturedText {
  onChangeCb?: (value: string) => void;
}
interface CapturedSetting {
  name?: string;
  heading: boolean;
  toggles: CapturedToggle[];
  texts: CapturedText[];
}

interface CapturedButton {
  text?: string;
  onClick?: () => void | Promise<void>;
}

const capture: { settings: CapturedSetting[]; buttons: CapturedButton[] } = {
  settings: [],
  buttons: [],
};

jest.mock("obsidian", () => ({
  App: jest.fn(),
  PluginSettingTab: class MockPluginSettingTab {
    containerEl: any;
    app: any;
    plugin: any;
    constructor(app: any, plugin: any) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = { empty: jest.fn() };
    }
  },
  Setting: jest.fn(),
}));

// DEFECT-5 (al-ux-findings 2026-06-21) — drive the Settings "Test connection"
// persistent inline status. Controllable so the test exercises both the
// no-PAT-stored and the valid-token paths through the real callback.
let mockStoredPat: string | null = "ghp_settings_default";
jest.mock("../../src/infrastructure/adapters/LocalSecretsStore", () => ({
  // Class form (not jest.fn().mockImplementation): under ts-jest a jest.fn used
  // as a constructor does not reliably return the object literal, so the real
  // class shape is mirrored here (test-fixture-realism).
  LocalSecretsStore: class {
    async getSecret(): Promise<string | null> {
      return mockStoredPat;
    }
    async setSecret(): Promise<void> {
      return undefined;
    }
  },
}));
let mockRateLimitThrows = false;
// #4231 — the rejection message is injectable so an axis can distinguish an
// auth-shaped failure (401, the default) from a network/timeout failure.
const DEFAULT_RATE_LIMIT_ERROR =
  "GitHub request GET /rate_limit → HTTP 401: bad credentials";
let mockRateLimitError: string | null = null;
// #4231 — record the PAT each client was constructed with, so a test can
// assert WHICH token the Test-connection handler actually exercised (entered
// vs stored). Mirrors the real ctor contract (`{ pat, app }`).
const constructedClientPats: string[] = [];
jest.mock("../../src/infrastructure/adapters/GitHubRestClient", () => ({
  GitHubRestClient: class {
    constructor(opts: { pat: string }) {
      constructedClientPats.push(opts.pat);
    }
    async checkRateLimit(): Promise<{ remaining: number; resetAt: Date }> {
      if (mockRateLimitThrows) {
        throw new Error(mockRateLimitError ?? DEFAULT_RATE_LIMIT_ERROR);
      }
      return { remaining: 4321, resetAt: new Date("2026-06-21T23:00:00.000Z") };
    }
    async listRepos(): Promise<string[]> {
      return ["kitelev/exoas-temp"];
    }
  },
}));

describe("ExocortexSettingTab", () => {
  let settingTab: ExocortexSettingTab;
  let mockApp: any;
  let mockPlugin: any;
  let mockContainerEl: any;
  let MockSetting: any;

  const findSetting = (name: string): CapturedSetting | undefined =>
    capture.settings.find((s) => s.name === name);

  beforeEach(() => {
    capture.settings = [];
    capture.buttons = [];
    mockStoredPat = "ghp_settings_default";
    mockRateLimitThrows = false;
    mockRateLimitError = null;
    constructedClientPats.length = 0;

    // A recursive mock element that supports the Obsidian DOM helpers the
    // settings tab uses (createEl/createDiv/createSpan/appendText/empty).
    const createMockElement: () => any = () => {
      const el = document.createElement("div");
      (el as any).empty = jest.fn();
      (el as any).createEl = jest
        .fn()
        .mockImplementation(() => createMockElement());
      (el as any).createDiv = jest
        .fn()
        .mockImplementation(() => createMockElement());
      (el as any).createSpan = jest
        .fn()
        .mockImplementation(() => createMockElement());
      (el as any).appendText = jest.fn();
      return el;
    };
    mockContainerEl = {
      empty: jest.fn(),
      createEl: jest.fn().mockImplementation(() => createMockElement()),
      createDiv: jest.fn().mockImplementation(() => createMockElement()),
      createSpan: jest.fn().mockImplementation(() => createMockElement()),
      appendText: jest.fn(),
    };

    mockPlugin = createMockPlugin({
      settings: {
        layoutVisible: true,
        showArchivedAssets: false,
        autoAdjustPlannedEndTimestamp: true,
        showLabelsInTabTitles: true,
        showLabelsInProperties: true,
        enablePropertiesLabelPatch: true,
        enableExoLayoutRenderer: true,
        showIconsInFileExplorer: false,
        autoReadingModeForExocortexAssets: true,
        showLabelsInBody: true,
        showLabelsInGraphView: true,
        showLabelsInLivePreview: true,
        settingsHomoiconizationEnabled: false,
        enableShaclValidation: false,
        lazyBootstrapFolders: [],
        excludedFolders: [],
        exosyncQuarantineRepoUrl: "",
        exosyncStepNotices: false,
        verboseSyncLogging: false,
        displayNameTemplate: "{{exo__Asset_label}}",
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {
            "ems__Task": "{{exo__Asset_label}}",
            "ems__TaskPrototype": "{{exo__Asset_label}} (TaskPrototype)",
          },
        },
        logChannels: {
          debug: { notice: false, console: true, file: false },
          info: { notice: false, console: true, file: false },
          warn: { notice: true, console: true, file: false },
          error: { notice: true, console: true, file: false },
        },
      },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      refreshLayout: jest.fn(),
      toggleTabTitleLabels: jest.fn(),
      togglePropertiesLabels: jest.fn(),
      togglePropertiesLabelPatch: jest.fn(),
      toggleFileExplorerIcons: jest.fn(),
      toggleBodyLabels: jest.fn(),
      toggleGraphViewLabels: jest.fn(),
      applyDisplayNameTemplate: jest.fn(),
      configureLogChannels: jest.fn(),
      listProfileChoices: jest.fn().mockResolvedValue([]),
      localDataStore: { getActiveProfileUid: jest.fn().mockReturnValue(null) },
      notifier: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    mockApp = createMockApp();
    mockPlugin.app = mockApp;

    MockSetting = Setting as jest.Mock;
    MockSetting.mockImplementation((containerEl: any) => {
      const record: CapturedSetting = { heading: false, toggles: [], texts: [] };
      capture.settings.push(record);
      const setting: any = {
        containerEl,
        setName: jest.fn((n: string) => {
          record.name = n;
          return setting;
        }),
        setDesc: jest.fn().mockReturnThis(),
        setHeading: jest.fn(() => {
          record.heading = true;
          return setting;
        }),
        addDropdown: jest.fn().mockImplementation((cb: any) => {
          cb({
            addOption: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
          });
          return setting;
        }),
        addToggle: jest.fn().mockImplementation((cb: any) => {
          const captured: CapturedToggle = {};
          const toggle: any = {
            setValue: jest.fn((v: boolean) => {
              captured.setValueArg = v;
              return toggle;
            }),
            onChange: jest.fn((fn: any) => {
              captured.onChangeCb = fn;
              return toggle;
            }),
            toggleEl: document.createElement("input"),
          };
          record.toggles.push(captured);
          cb(toggle);
          return setting;
        }),
        addText: jest.fn().mockImplementation((cb: any) => {
          const captured: CapturedText = {};
          const text: any = {
            setPlaceholder: jest.fn(() => text),
            setValue: jest.fn(() => text),
            onChange: jest.fn((fn: any) => {
              captured.onChangeCb = fn;
              return text;
            }),
            inputEl: { type: "" } as Record<string, unknown>,
          };
          record.texts.push(captured);
          cb(text);
          return setting;
        }),
        addTextArea: jest.fn().mockImplementation((cb: any) => {
          const textarea: any = {
            setPlaceholder: jest.fn(() => textarea),
            setValue: jest.fn(() => textarea),
            onChange: jest.fn(() => textarea),
            inputEl: { rows: 0, cols: 0 } as Record<string, unknown>,
          };
          cb(textarea);
          return setting;
        }),
        addButton: jest.fn().mockImplementation((cb: any) => {
          const captured: CapturedButton = {};
          capture.buttons.push(captured);
          const button: any = {
            setButtonText: jest.fn((t: string) => {
              captured.text = t;
              return button;
            }),
            onClick: jest.fn((fn: any) => {
              captured.onClick = fn;
              return button;
            }),
            setCta: jest.fn(() => button),
            setTooltip: jest.fn(() => button),
            // DEFECT-5 — the Test-connection handler disables the button while
            // the request is in flight; the mock must expose setDisabled.
            setDisabled: jest.fn(() => button),
          };
          cb(button);
          return setting;
        }),
      };
      return setting;
    });

    settingTab = new ExocortexSettingTab(mockApp, mockPlugin);
    settingTab.containerEl = mockContainerEl;
  });

  describe("display", () => {
    it("should render all settings", () => {
      settingTab.display();

      expect(mockContainerEl.empty).toHaveBeenCalled();
      // RFC 0002 §3.6 — count = 45 (pre-§3.6) + 3 section headings
      // («Onboarding & sync» / «Display» / «Advanced») = 48, minus the
      // removed "Auto-execute SPARQL code blocks" toggle = 47, minus the
      // removed dead «Switch cache» section (its heading + the «Cache stats»
      // row = 2 Settings) = 45, minus the removed «Quarantine repo URL» row
      // (synced quarantine store retired — offline-resolution program) = 44.
      expect(MockSetting).toHaveBeenCalledTimes(44);
    });

    it("renders the settings-homoiconization toggle", () => {
      settingTab.display();
      expect(findSetting("Settings homoiconization")).toBeDefined();
    });

    it("renders the layout-visibility toggle wired to layoutVisible", async () => {
      settingTab.display();

      const layout = findSetting("Show layout");
      expect(layout).toBeDefined();
      const toggle = layout!.toggles[0];
      expect(toggle.setValueArg).toBe(true);

      await toggle.onChangeCb?.(false);

      expect(mockPlugin.settings.layoutVisible).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("renders the archived-assets toggle wired to showArchivedAssets", async () => {
      settingTab.display();

      const archived = findSetting("Show archived assets");
      expect(archived).toBeDefined();
      const toggle = archived!.toggles[0];
      expect(toggle.setValueArg).toBe(false);

      await toggle.onChangeCb?.(true);

      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });
  });

  // DEFECT-5 (al-ux-findings 2026-06-21) — the Settings "Test connection" result
  // must land in a PERSISTENT inline status (mirroring the onboarding panel),
  // not only a transient toast that fades before the user can read it.
  describe("PAT Test connection — persistent inline status (DEFECT-5)", () => {
    const findPatStatusEl = (): HTMLElement | undefined => {
      const calls = (mockContainerEl.createEl as jest.Mock).mock.calls;
      const results = (mockContainerEl.createEl as jest.Mock).mock.results;
      for (let i = 0; i < calls.length; i++) {
        const [tag, opts] = calls[i];
        if (tag === "p" && opts?.cls === "exocortex-settings-pat-status") {
          return results[i].value as HTMLElement;
        }
      }
      return undefined;
    };
    const findButton = (text: string): CapturedButton | undefined =>
      capture.buttons.find((b) => b.text === text);

    it("renders a persistent role=status / aria-live status element", () => {
      settingTab.display();
      const statusEl = findPatStatusEl();
      // Revert-verify anchor: pre-fix this element does not exist (toast-only).
      expect(statusEl).toBeDefined();
      expect(statusEl!.getAttribute("role")).toBe("status");
      expect(statusEl!.getAttribute("aria-live")).toBe("polite");
    });

    it("no PAT stored → inline status shows the prompt as invalid (not a toast)", async () => {
      mockStoredPat = null;
      settingTab.display();
      const statusEl = findPatStatusEl();
      await findButton("Test connection")!.onClick!();
      expect(statusEl!.textContent ?? "").toMatch(/No PAT stored/i);
      expect(statusEl!.classList.contains("is-invalid")).toBe(true);
    });

    it("valid token → inline status shows GitHub OK as valid", async () => {
      mockStoredPat = "ghp_valid_settings_token";
      mockRateLimitThrows = false;
      settingTab.display();
      const statusEl = findPatStatusEl();
      await findButton("Test connection")!.onClick!();
      expect(statusEl!.textContent ?? "").toMatch(/GitHub OK/);
      expect(statusEl!.classList.contains("is-valid")).toBe(true);
    });

    it("rejected token → inline status shows the failure as invalid", async () => {
      mockStoredPat = "ghp_bad_settings_token";
      mockRateLimitThrows = true;
      settingTab.display();
      const statusEl = findPatStatusEl();
      await findButton("Test connection")!.onClick!();
      expect(statusEl!.textContent ?? "").toMatch(/Test connection failed/i);
      expect(statusEl!.classList.contains("is-invalid")).toBe(true);
    });
  });
  // #4231 — pasting a NEW token and clicking «Test connection» before «Save
  // PAT» used to test the STALE stored token (→ «401 Bad credentials» on a
  // perfectly valid fresh token, while BRAT validated the same token fine).
  // The handler must test the ENTERED token when the field is non-empty and
  // must say WHICH token it exercised.
  describe("PAT Test connection — entered token beats stored (#4231)", () => {
    const findPatStatusEl = (): HTMLElement | undefined => {
      const calls = (mockContainerEl.createEl as jest.Mock).mock.calls;
      const results = (mockContainerEl.createEl as jest.Mock).mock.results;
      for (let i = 0; i < calls.length; i++) {
        const [tag, opts] = calls[i];
        if (tag === "p" && opts?.cls === "exocortex-settings-pat-status") {
          return results[i].value as HTMLElement;
        }
      }
      return undefined;
    };
    const findButton = (text: string): CapturedButton | undefined =>
      capture.buttons.find((b) => b.text === text);
    // Simulate the user typing/pasting into the PAT field through the real
    // `onChange` wiring (the same path the Paste button and keyboard use).
    const typePat = (value: string): void => {
      const patSetting = findSetting("Personal Access Token");
      expect(patSetting).toBeDefined();
      const cb = patSetting!.texts[0]?.onChangeCb;
      expect(cb).toBeDefined();
      cb!(value);
    };

    it("field non-empty → tests the ENTERED token, not the stale stored one", async () => {
      mockStoredPat = "ghp_stale_stored_token_expired";
      mockRateLimitThrows = false;
      settingTab.display();
      typePat("  ghp_fresh_entered_token_ok  ");
      await findButton("Test connection")!.onClick!();
      // Revert-verify anchor: pre-fix the client is built with the STORED token.
      expect(constructedClientPats).toEqual(["ghp_fresh_entered_token_ok"]);
      const text = findPatStatusEl()!.textContent ?? "";
      expect(text).toMatch(/GitHub OK/);
      expect(text).toMatch(/tested the entered token \(…n_ok\)/);
      // The tested token is NOT the stored one → remind to save it.
      expect(text).toMatch(/Not saved yet — click Save PAT/);
      expect(findPatStatusEl()!.classList.contains("is-valid")).toBe(true);
    });

    it("field non-empty and equal to the stored token → no «not saved» reminder", async () => {
      mockStoredPat = "ghp_already_saved_token_same";
      settingTab.display();
      typePat("ghp_already_saved_token_same");
      await findButton("Test connection")!.onClick!();
      expect(constructedClientPats).toEqual(["ghp_already_saved_token_same"]);
      const text = findPatStatusEl()!.textContent ?? "";
      expect(text).toMatch(/tested the entered token \(…same\)/);
      expect(text).not.toMatch(/Not saved yet/);
    });

    it("whitespace-only field → treated as empty: STORED token is tested", async () => {
      mockStoredPat = "ghp_stored_only_token_wsp1";
      settingTab.display();
      typePat("   ");
      await findButton("Test connection")!.onClick!();
      // Revert-verify anchor: dropping the handler's trim classifies "   " as
      // an entered token and testPatConnection then reports "No token entered".
      expect(constructedClientPats).toEqual(["ghp_stored_only_token_wsp1"]);
      expect(findPatStatusEl()!.textContent ?? "").toMatch(/tested the stored token \(…wsp1\)/);
    });

    it("stored token fails on a NETWORK error → no «paste a new token» hint (token not at fault)", async () => {
      mockStoredPat = "ghp_stored_token_network_net1";
      mockRateLimitThrows = true;
      mockRateLimitError =
        "GitHub request GET /rate_limit timed out after 120000ms (no response — stalled connection?)";
      settingTab.display();
      await findButton("Test connection")!.onClick!();
      const text = findPatStatusEl()!.textContent ?? "";
      expect(text).toMatch(/Test connection failed/i);
      expect(text).toMatch(/tested the stored token \(…net1\)/);
      expect(text).not.toMatch(/Paste a new token/);
    });

    it("field empty → falls back to the STORED token and names it", async () => {
      mockStoredPat = "ghp_stored_only_token_abcd";
      settingTab.display();
      await findButton("Test connection")!.onClick!();
      expect(constructedClientPats).toEqual(["ghp_stored_only_token_abcd"]);
      const text = findPatStatusEl()!.textContent ?? "";
      expect(text).toMatch(/GitHub OK/);
      expect(text).toMatch(/tested the stored token \(…abcd\)/);
      expect(text).not.toMatch(/Not saved yet/);
    });

    it("stored token rejected → failure names the stored token and hints to paste a new one", async () => {
      mockStoredPat = "ghp_stored_expired_token_dead";
      mockRateLimitThrows = true;
      settingTab.display();
      await findButton("Test connection")!.onClick!();
      const text = findPatStatusEl()!.textContent ?? "";
      expect(text).toMatch(/Test connection failed/i);
      expect(text).toMatch(/tested the stored token \(…dead\)/);
      expect(text).toMatch(/Paste a new token into the field/);
      expect(findPatStatusEl()!.classList.contains("is-invalid")).toBe(true);
    });

    it("field empty and nothing stored → prompt says a token can be tested before saving", async () => {
      mockStoredPat = null;
      settingTab.display();
      await findButton("Test connection")!.onClick!();
      expect(constructedClientPats).toEqual([]);
      const text = findPatStatusEl()!.textContent ?? "";
      expect(text).toMatch(/No PAT stored/i);
      expect(text).toMatch(/test it before saving/i);
    });

    it("PAT row description shows the stored token's tail (never the token)", async () => {
      mockStoredPat = "ghp_stored_token_for_hint_wxyz";
      settingTab.display();
      // The hint is appended asynchronously (getSecret) right after render.
      await new Promise((r) => setTimeout(r, 0));
      const patSetting = findSetting("Personal Access Token");
      const settingObj = MockSetting.mock.results.find(
        (r: any) => r.value?.setName?.mock?.calls?.[0]?.[0] === "Personal Access Token",
      )?.value;
      expect(patSetting).toBeDefined();
      expect(settingObj).toBeDefined();
      const descCalls = (settingObj.setDesc as jest.Mock).mock.calls.map((c: any[]) => c[0]);
      const last = descCalls[descCalls.length - 1] as string;
      expect(last).toMatch(/Stored: …wxyz\./);
      expect(last).not.toContain("ghp_stored_token_for_hint_wxyz");
    });
  });
});

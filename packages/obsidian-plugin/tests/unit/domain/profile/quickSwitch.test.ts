/**
 * req 38e2fdd5 — one-tap profile CONTEXT switching.
 *
 * Two axes, revert-verified independently:
 *   1. the switcher offers the context you came FROM first
 *      (`orderProfilesForQuickSwitch`);
 *   2. the indicator names the active context on both surfaces
 *      (`formatActiveProfileIndicator` / `formatActiveProfileTooltip` driven
 *      through the real {@link ProfileIndicator}).
 *
 * The zero-regression controls (no previous profile ⇒ untouched order; the
 * «Show all profiles…» sentinel never promoted) stay GREEN under either
 * revert, which is what proves each axis is non-vacuous.
 */

import {
  formatActiveProfileIndicator,
  formatActiveProfileTooltip,
  orderProfilesForQuickSwitch,
  INDICATOR_GLYPH,
  NO_ACTIVE_PROFILE_TEXT,
  UNRESOLVED_PROFILE_TEXT,
} from "../../../../src/domain/profile/quickSwitch";
import {
  ProfileIndicator,
  PROFILE_RIBBON_ICON,
  PROFILE_STATUS_BAR_CLASS,
  type IndicatorProfile,
} from "../../../../src/infrastructure/adapters/ProfileIndicator";

const PERSONAL = { uid: "uid-personal", label: "Personal" };
const WORK = { uid: "uid-work", label: "Work" };
const READING = { uid: "uid-reading", label: "Reading" };
/** Mirrors `SHOW_ALL_PROFILES_UID` — the synthetic expander row. */
const SHOW_ALL = { uid: "__exocortex_show_all_profiles__", label: "Show all…" };

describe("quickSwitch — switcher ordering", () => {
  it("@req:38e2fdd5-8768-4354-8cb8-f1c77856ddb8 AC2: offers the context you came FROM first, keeping every other row's relative order", () => {
    // Alphabetical, as the caller sorts them: Personal, Reading, Work.
    const ordered = orderProfilesForQuickSwitch(
      [PERSONAL, READING, WORK],
      WORK.uid,
    );

    // "Work" was active before "Personal" → it is the switch-back target.
    expect(ordered.map((p) => p.label)).toEqual([
      "Work",
      "Personal",
      "Reading",
    ]);
  });

  it("promotes a profile that is already first without duplicating or dropping it", () => {
    const ordered = orderProfilesForQuickSwitch(
      [PERSONAL, READING, WORK],
      PERSONAL.uid,
    );
    expect(ordered.map((p) => p.label)).toEqual([
      "Personal",
      "Reading",
      "Work",
    ]);
    expect(ordered).toHaveLength(3);
  });

  it("zero-regression: with no previous profile the order is returned untouched", () => {
    const input = [PERSONAL, READING, WORK];
    expect(orderProfilesForQuickSwitch(input, null).map((p) => p.uid)).toEqual(
      input.map((p) => p.uid),
    );
    expect(orderProfilesForQuickSwitch(input, "").map((p) => p.uid)).toEqual(
      input.map((p) => p.uid),
    );
  });

  it("zero-regression: an unmatched previous profile (deleted / unmounted) leaves the order untouched", () => {
    const input = [PERSONAL, READING, WORK];
    expect(
      orderProfilesForQuickSwitch(input, "uid-that-no-longer-exists").map(
        (p) => p.uid,
      ),
    ).toEqual(input.map((p) => p.uid));
  });

  it("never promotes the «Show all profiles…» sentinel", () => {
    const ordered = orderProfilesForQuickSwitch(
      [PERSONAL, WORK, SHOW_ALL],
      WORK.uid,
    );
    expect(ordered[0]?.uid).toBe(WORK.uid);
    // The sentinel stays last, where the caller appended it.
    expect(ordered[ordered.length - 1]?.uid).toBe(SHOW_ALL.uid);
  });

  it("does not mutate the caller's array", () => {
    const input = [PERSONAL, READING, WORK];
    orderProfilesForQuickSwitch(input, WORK.uid);
    expect(input.map((p) => p.label)).toEqual(["Personal", "Reading", "Work"]);
  });
});

describe("quickSwitch — indicator text", () => {
  it("names the active profile by its human label, never its UID", () => {
    expect(formatActiveProfileIndicator("Personal")).toBe(
      `${INDICATOR_GLYPH} Personal`,
    );
    expect(formatActiveProfileTooltip("Personal")).toContain("Personal");
    expect(formatActiveProfileTooltip("Personal")).toContain("context");
  });

  it("states explicitly when nothing has been applied — never blank", () => {
    expect(formatActiveProfileIndicator(null)).toContain(
      NO_ACTIVE_PROFILE_TEXT,
    );
    expect(formatActiveProfileIndicator("")).toContain(NO_ACTIVE_PROFILE_TEXT);
    expect(formatActiveProfileTooltip(null).length).toBeGreaterThan(0);
  });
});

/** Records what the fake surfaces were asked to register. */
function makeSurfaces() {
  const ribbonEl = document.createElement("div");
  const statusEl = document.createElement("div");
  const ribbonCalls: Array<{ icon: string; title: string }> = [];
  let ribbonCb: (() => void) | null = null;
  let statusBarRegistered = 0;

  return {
    ribbonEl,
    statusEl,
    ribbonCalls,
    get ribbonCb() {
      return ribbonCb;
    },
    get statusBarRegistered() {
      return statusBarRegistered;
    },
    addRibbonIcon: (icon: string, title: string, cb: () => void) => {
      ribbonCalls.push({ icon, title });
      ribbonCb = cb;
      return ribbonEl;
    },
    addStatusBarItem: () => {
      statusBarRegistered += 1;
      return statusEl;
    },
  };
}

describe("ProfileIndicator — the two surfaces", () => {
  const profiles: IndicatorProfile[] = [PERSONAL, WORK];

  it("@req:38e2fdd5-8768-4354-8cb8-f1c77856ddb8 AC1+AC2b: the desktop status bar names the active profile and opens the switcher on click", async () => {
    const s = makeSurfaces();
    let opened = 0;
    const indicator = new ProfileIndicator({
      getActiveProfileUid: () => PERSONAL.uid,
      listProfiles: async () => profiles,
      openSwitcher: () => {
        opened += 1;
      },
      addRibbonIcon: s.addRibbonIcon,
      addStatusBarItem: s.addStatusBarItem,
    });

    indicator.mount();
    await indicator.refresh();

    expect(s.statusBarRegistered).toBe(1);
    expect(s.statusEl.textContent).toBe(`${INDICATOR_GLYPH} Personal`);
    expect(s.statusEl.classList.contains(PROFILE_STATUS_BAR_CLASS)).toBe(true);

    // One tap on the indicator = the switcher opens (the second tap is the row).
    s.statusEl.dispatchEvent(new MouseEvent("click"));
    expect(opened).toBe(1);
  });

  it("@req:38e2fdd5-8768-4354-8cb8-f1c77856ddb8 AC3: on mobile — no status bar — the ribbon entry still names the profile and opens the switcher", async () => {
    const s = makeSurfaces();
    let opened = 0;
    const indicator = new ProfileIndicator({
      getActiveProfileUid: () => WORK.uid,
      listProfiles: async () => profiles,
      openSwitcher: () => {
        opened += 1;
      },
      addRibbonIcon: s.addRibbonIcon,
      // Mobile: `addStatusBarItem` is not available, so it is not passed.
      addStatusBarItem: undefined,
    });

    indicator.mount();
    await indicator.refresh();

    expect(s.statusBarRegistered).toBe(0);
    expect(s.ribbonCalls).toHaveLength(1);
    expect(s.ribbonCalls[0]?.icon).toBe(PROFILE_RIBBON_ICON);
    // The accessible label is how the active profile is announced on mobile.
    expect(s.ribbonEl.getAttribute("aria-label")).toContain("Work");
    expect(s.ribbonEl.title).toContain("Work");

    s.ribbonCb?.();
    expect(opened).toBe(1);
  });

  it("follows the active profile across a switch, without remounting", async () => {
    const s = makeSurfaces();
    let active: string | null = PERSONAL.uid;
    const indicator = new ProfileIndicator({
      getActiveProfileUid: () => active,
      listProfiles: async () => profiles,
      openSwitcher: () => undefined,
      addRibbonIcon: s.addRibbonIcon,
      addStatusBarItem: s.addStatusBarItem,
    });

    indicator.mount();
    await indicator.refresh();
    expect(s.statusEl.textContent).toContain("Personal");

    active = WORK.uid; // an apply completed
    await indicator.refresh();
    expect(s.statusEl.textContent).toContain("Work");
    expect(s.statusBarRegistered).toBe(1); // no duplicate surface
  });

  it("a recorded-but-unresolvable profile reads as unknown, not as «no profile» and not as a raw UID", async () => {
    const s = makeSurfaces();
    const indicator = new ProfileIndicator({
      getActiveProfileUid: () => "uid-deleted-profile",
      listProfiles: async () => profiles,
      openSwitcher: () => undefined,
      addRibbonIcon: s.addRibbonIcon,
      addStatusBarItem: s.addStatusBarItem,
    });

    indicator.mount();
    await indicator.refresh();

    expect(s.statusEl.textContent).toContain(UNRESOLVED_PROFILE_TEXT);
    expect(s.statusEl.textContent).not.toContain("uid-deleted-profile");
  });

  it("a failing lister degrades instead of throwing into the caller", async () => {
    const s = makeSurfaces();
    const indicator = new ProfileIndicator({
      getActiveProfileUid: () => PERSONAL.uid,
      listProfiles: async () => {
        throw new Error("vault scan failed");
      },
      openSwitcher: () => undefined,
      addRibbonIcon: s.addRibbonIcon,
      addStatusBarItem: s.addStatusBarItem,
    });

    indicator.mount();
    await expect(indicator.refresh()).resolves.toBeUndefined();
    expect(s.statusEl.textContent).toContain(UNRESOLVED_PROFILE_TEXT);
  });

  it("mount is idempotent — a second call cannot stack duplicate surfaces", () => {
    const s = makeSurfaces();
    const indicator = new ProfileIndicator({
      getActiveProfileUid: () => null,
      listProfiles: async () => profiles,
      openSwitcher: () => undefined,
      addRibbonIcon: s.addRibbonIcon,
      addStatusBarItem: s.addStatusBarItem,
    });

    indicator.mount();
    indicator.mount();

    expect(s.ribbonCalls).toHaveLength(1);
    expect(s.statusBarRegistered).toBe(1);
  });
});

/**
 * Bug 2 regression guard — the «Open activity log» modal text must be
 * selectable + copyable with the mouse (#3540 follow-up).
 *
 * Root cause: `.exocortex-activity-log-list` shipped without an explicit
 * `user-select`, so Obsidian/Electron app-chrome's default `user-select: none`
 * prevented selecting the log lines (only the "Copy all" button worked).
 *
 * This locks the fix in styles.css so a future edit cannot silently regress it.
 * Revert-verify: removing `user-select: text` from the list block fails this.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { resolve } from "path";

const STYLES_CSS_PATH = resolve(__dirname, "../../../styles.css");
const css = readFileSync(STYLES_CSS_PATH, "utf-8");

/**
 * Extract the declaration block (between the first `{` and its `}`) for a
 * selector, with CSS comments stripped so prose inside `/* … *\/` can't satisfy
 * or trip the assertions below.
 */
function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) return "";
  return m[1].replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Bug 2 — activity log modal text is selectable", () => {
  const block = ruleBlock(".exocortex-activity-log-list");

  it("declares a .exocortex-activity-log-list rule", () => {
    expect(block).not.toBe("");
  });

  it("opts the list back into text selection (user-select: text)", () => {
    expect(block).toMatch(/(?<!-)user-select:\s*text/);
  });

  it("includes the -webkit-user-select prefix for the Electron/WKWebView runtime", () => {
    expect(block).toMatch(/-webkit-user-select:\s*text/);
  });

  it("does NOT set user-select: none on the list (would re-break selection)", () => {
    expect(block).not.toMatch(/user-select:\s*none/);
  });
});

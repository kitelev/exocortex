import { readFileSync } from "fs";
import * as path from "path";

/**
 * Issue #3479 — config-level regression gate for the Logger console channel.
 *
 * The release build used to strip every console.* call via esbuild
 * `drop: ["console"]` plus `pure: ["console.log", "console.debug",
 * "console.info"]`, which silently turned the settings-facing
 * logChannels.<level>.console toggles into a no-op (v16.81.1 main.js:
 * 0 occurrences of console.warn).
 *
 * esbuild.config.mjs is a build SCRIPT (it invokes esbuild at module-eval
 * time), so it cannot be imported here — assertions run on the file text,
 * with comments stripped first so documentation cannot satisfy or trip them.
 * The bundle-level twin gate is scripts/assert-console-channel.mjs, wired
 * into the root `npm run build` (gates the Auto Release artifact).
 */
describe("esbuild production config — Logger console channel (Issue #3479)", () => {
  const configPath = path.resolve(__dirname, "../../../esbuild.config.mjs");
  const configText = readFileSync(configPath, "utf8");

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const code = stripComments(configText);
  const dropArrays = [...code.matchAll(/drop:\s*\[([^\]]*)\]/g)];
  const pureArrays = [...code.matchAll(/pure:\s*\[([^\]]*)\]/g)];

  it("does not drop console.* calls (no 'console' entry in any drop list)", () => {
    expect(dropArrays.length).toBeGreaterThan(0);
    for (const match of dropArrays) {
      expect(match[1]).not.toMatch(/["']console["']/);
    }
  });

  it("keeps dropping debugger statements", () => {
    expect(
      dropArrays.some((match) => /["']debugger["']/.test(match[1])),
    ).toBe(true);
  });

  it("does not mark console methods as pure (pure-list tree-shakes them under minify)", () => {
    for (const match of pureArrays) {
      expect(match[1]).not.toMatch(/console\s*\./);
    }
  });
});

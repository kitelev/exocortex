import { describe, it, expect } from "@jest/globals";

import { resolveAddAssetSpacePath } from "../../../src/commands/assetspace-add.js";

/**
 * Issue #3538 — `assetspace-add` must mount at the canonical Maven path
 * `assetspaces/<owner>/<repo>` (parity with `bootstrap` + `apply-profile`,
 * which derive via `derivePath`), NOT the old flat `assetspaces/<name>`
 * (`deriveFolderName`, prefix-stripped). A flat folder is not recognised as
 * materialised by `apply-profile` (it checks the canonical `derivePath`) → the
 * same AssetSpace UID re-mounts at the Maven path → double mount.
 *
 * These assert the pure path-derivation helper directly — deterministic, no
 * network / no `process.exit`.
 *
 * Revert-verify: restoring the old
 * `options.folder ?? BootstrapAssetSpaceService.deriveFolderName(options.url)`
 * (flat) default makes the canonical assertions below FAIL.
 */
describe("assetspace-add — resolveAddAssetSpacePath (#3538)", () => {
  it("defaults to the canonical Maven path assetspaces/<owner>/<repo> (keeps full repo name)", () => {
    expect(
      resolveAddAssetSpacePath("https://github.com/kitelev/exoas-pmbok-ontology"),
    ).toBe("assetspaces/kitelev/exoas-pmbok-ontology");
  });

  it("a generic owner/repo (no exoas- prefix) lands at assetspaces/<owner>/<repo> — proves derivePath, not the prefix-stripped flat name", () => {
    // Flat `deriveFolderName` would yield `assetspaces/widgets`; canonical keeps
    // both segments → `assetspaces/acme/widgets`.
    expect(resolveAddAssetSpacePath("https://github.com/acme/widgets")).toBe(
      "assetspaces/acme/widgets",
    );
  });

  it("matches what bootstrap derives for the same URL (derivePath single source of truth)", () => {
    // `assetspaces/kitelev/exoas-exo` is exactly the floor path bootstrap mounts.
    expect(resolveAddAssetSpacePath("https://github.com/kitelev/exoas-exo")).toBe(
      "assetspaces/kitelev/exoas-exo",
    );
  });

  it("normalises a .git suffix and trailing slash (derivePath normalisation)", () => {
    expect(
      resolveAddAssetSpacePath("https://github.com/acme/widgets.git/"),
    ).toBe("assetspaces/acme/widgets");
  });

  it("an explicit --folder override still maps to the flat assetspaces/<folder> escape hatch", () => {
    expect(
      resolveAddAssetSpacePath(
        "https://github.com/kitelev/exoas-pmbok-ontology",
        "legacy-flat",
      ),
    ).toBe("assetspaces/legacy-flat");
  });

  it("an empty --folder string is ignored (falls through to the canonical default)", () => {
    expect(
      resolveAddAssetSpacePath("https://github.com/kitelev/exoas-pmbok-ontology", ""),
    ).toBe("assetspaces/kitelev/exoas-pmbok-ontology");
  });
});

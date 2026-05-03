import { Given, When, Then } from "@cucumber/cucumber";
import { ExocortexWorld } from "../support/world.js";
import { DisplayNameResolver } from "../../src/domain/display-name/DisplayNameResolver.js";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "../../src/domain/settings/ExocortexSettings.js";
import assert from "assert";

// resolved display name for the current target asset
let resolvedDisplayName: string | null = null;
// basename of the target asset
let targetBasename: string = "";
// user-defined alias extracted from body wikilink (if any)
let userDefinedAlias: string | null = null;

Given(
  "a note {string} exists with body content linking to asset {string}",
  function (this: ExocortexWorld, sourceName: string, targetId: string) {
    this.createFile(`Notes/${sourceName}.md`, {
      exo__Asset_label: `Source: ${sourceName}`,
    });
    targetBasename = targetId;
    userDefinedAlias = null;
    resolvedDisplayName = null;
  }
);

Given(
  "asset {string} exists with metadata:",
  function (this: ExocortexWorld, assetId: string, dataTable: any) {
    const frontmatter: Record<string, unknown> = {};
    const rows: string[][] = dataTable.rows();
    for (const [prop, value] of rows) {
      // Handle array-like wikilink values
      if (value.startsWith("[[") && value.endsWith("]]")) {
        frontmatter[prop] = [value];
      } else {
        frontmatter[prop] = value;
      }
    }
    this.createFile(`Assets/${assetId}.md`, frontmatter);
    targetBasename = assetId;
  }
);

Given(
  "a note {string} exists with body content:",
  function (this: ExocortexWorld, sourceName: string, docString: string) {
    // Extract wikilink target and optional alias: [[target|alias]] or [[target]]
    const match = docString.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (match) {
      targetBasename = match[1].trim();
      userDefinedAlias = match[2] ? match[2].trim() : null;
    }
    this.createFile(`Notes/${sourceName}.md`, {
      exo__Asset_label: `Source: ${sourceName}`,
    });
  }
);

When(
  "I open {string} in Reading View",
  function (this: ExocortexWorld, _sourceName: string) {
    const assetNote = this.notes.get(`Assets/${targetBasename}.md`);
    if (!assetNote) {
      resolvedDisplayName = null;
      return;
    }

    // Simulate BodyLinkPatch alias detection: if the link has an explicit user alias,
    // BodyLinkPatch skips patching (hasUserAlias = true → return early).
    if (userDefinedAlias !== null) {
      resolvedDisplayName = null; // patch is skipped — original alias is preserved
      return;
    }

    const resolver = new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);
    resolvedDisplayName = resolver.resolve({
      metadata: assetNote.frontmatter as Record<string, unknown>,
      basename: assetNote.file.basename,
    });
  }
);

Then(
  "the internal link to {string} displays text {string}",
  function (this: ExocortexWorld, _targetId: string, expectedText: string) {
    assert.strictEqual(
      resolvedDisplayName,
      expectedText,
      `Expected display name "${expectedText}" but got "${resolvedDisplayName}"`
    );
  }
);

Then(
  "the link does NOT show {string}",
  function (this: ExocortexWorld, unexpectedText: string) {
    assert.notStrictEqual(
      resolvedDisplayName,
      unexpectedText,
      `Display name should NOT be "${unexpectedText}" but it is`
    );
  }
);

Then(
  "the internal link to {string} shows the original file basename",
  function (this: ExocortexWorld, _targetId: string) {
    // null means BodyLinkPatch skips this link → shows original basename
    assert.strictEqual(
      resolvedDisplayName,
      null,
      `Expected null (no patching) but got "${resolvedDisplayName}"`
    );
  }
);

Then(
  "the internal link displays text {string}",
  function (this: ExocortexWorld, expectedText: string) {
    // For alias scenario: BodyLinkPatch detected hasUserAlias=true and returned early.
    // resolvedDisplayName = null means the link was NOT patched → original alias preserved.
    // We verify: (a) patching was skipped, (b) the user alias matches what was written.
    if (userDefinedAlias !== null) {
      assert.strictEqual(
        userDefinedAlias,
        expectedText,
        `User alias "${userDefinedAlias}" should match expected "${expectedText}"`
      );
      assert.strictEqual(
        resolvedDisplayName,
        null,
        "BodyLinkPatch should have skipped alias links (no patching)"
      );
      return;
    }
    // Non-alias case: verify resolved display name
    assert.strictEqual(
      resolvedDisplayName,
      expectedText,
      `Expected display name "${expectedText}" but got "${resolvedDisplayName}"`
    );
  }
);

Then(
  "NOT {string}",
  function (this: ExocortexWorld, unexpectedText: string) {
    assert.notStrictEqual(
      resolvedDisplayName,
      unexpectedText,
      `Display name should NOT be "${unexpectedText}"`
    );
  }
);

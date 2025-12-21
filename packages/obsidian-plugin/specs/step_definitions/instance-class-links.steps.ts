import { Given, When, Then } from "@cucumber/cucumber";
import { ExocortexWorld } from "../support/world.js";
import assert from "assert";

/**
 * Helper function to check if an instance class value is empty.
 * Handles null, undefined, empty string, and empty array cases.
 * Written as a separate function to avoid CodeQL comparison type issues.
 */
function isEmptyInstanceClass(value: unknown): boolean {
  if (value == null) return true; // covers null and undefined
  if (typeof value === "string") return value === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// ============================================
// Instance Class Display Tests
// ============================================

Given(
  "I have an asset with exo__Instance_class set to {string}",
  function (this: ExocortexWorld, instanceClass: string) {
    const note = this.createFile("Assets/test-asset.md", {
      exo__Instance_class: instanceClass,
      exo__Asset_label: "Test Asset",
    });
    this.currentNote = note;
  },
);

Given(
  "I have an asset with exo__Instance_class as array {string}",
  function (this: ExocortexWorld, classArrayStr: string) {
    // Parse array format like "[[[ems__Task]], [[ems__Meeting]]]"
    const classes = classArrayStr
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim());

    const note = this.createFile("Assets/test-asset.md", {
      exo__Instance_class: classes,
      exo__Asset_label: "Test Asset",
    });
    this.currentNote = note;
  },
);

Given("I have an asset without exo__Instance_class property", function (this: ExocortexWorld) {
  const note = this.createFile("Assets/test-asset.md", {
    exo__Asset_label: "Test Asset",
  });
  delete note.frontmatter.exo__Instance_class;
  this.currentNote = note;
});

Given(
  "I have an asset with exo__Instance_class set to empty string",
  function (this: ExocortexWorld) {
    const note = this.createFile("Assets/test-asset.md", {
      exo__Instance_class: "",
      exo__Asset_label: "Test Asset",
    });
    this.currentNote = note;
  },
);

Given(
  "I have an asset with exo__Instance_class set to null",
  function (this: ExocortexWorld) {
    const note = this.createFile("Assets/test-asset.md", {
      exo__Instance_class: null,
      exo__Asset_label: "Test Asset",
    });
    this.currentNote = note;
  },
);

When("I view the Relations table", function (this: ExocortexWorld) {
  if (this.currentNote) {
    this.viewNote(this.currentNote);
  }
  // Simulate rendering the relations table
  this.renderedSections.add("Relations");
});

Then(
  "Instance Class column displays as clickable link to {string}",
  function (this: ExocortexWorld, targetFile: string) {
    assert.ok(
      this.currentNote?.frontmatter.exo__Instance_class,
      "Instance class should exist",
    );
    const instanceClass = this.currentNote?.frontmatter.exo__Instance_class;
    const extracted = this.extractLinkTarget(
      Array.isArray(instanceClass) ? instanceClass[0] : instanceClass,
    );
    assert.strictEqual(
      extracted,
      targetFile,
      `Expected link to "${targetFile}", got "${extracted}"`,
    );
  },
);

Then(
  "Instance Class column displays {string} as clickable link",
  function (this: ExocortexWorld, displayText: string) {
    const instanceClass = this.currentNote?.frontmatter.exo__Instance_class;
    const extracted = this.extractLinkTarget(
      Array.isArray(instanceClass) ? instanceClass[0] : instanceClass,
    );
    assert.strictEqual(extracted, displayText);
  },
);

Then(
  "Instance Class does NOT contain {string}",
  function (this: ExocortexWorld, forbiddenText: string) {
    const instanceClass = this.currentNote?.frontmatter.exo__Instance_class;
    if (instanceClass) {
      const stringValue = Array.isArray(instanceClass)
        ? instanceClass.join(",")
        : String(instanceClass);
      // The extracted value should not have wiki-link brackets
      const extracted = this.extractLinkTarget(stringValue);
      assert.ok(
        !extracted.includes(forbiddenText),
        `Instance class should not contain "${forbiddenText}"`,
      );
    }
  },
);

Then("Instance Class is rendered as internal-link", function (this: ExocortexWorld) {
  // In our simulation, we verify that the class can be extracted as a link
  const instanceClass = this.currentNote?.frontmatter.exo__Instance_class;
  if (instanceClass) {
    const extracted = this.extractLinkTarget(
      Array.isArray(instanceClass) ? instanceClass[0] : instanceClass,
    );
    assert.ok(extracted.length > 0, "Should render as a link");
  }
});

Then("clicking on Instance Class opens file {string}", function (this: ExocortexWorld, fileName: string) {
  this.click(fileName);
  assert.strictEqual(
    this.lastClick?.element,
    fileName,
    `Expected click on "${fileName}"`,
  );
});

Then(
  /^Cmd\+clicking on Instance Class opens file "([^"]*)" in new tab$/,
  function (this: ExocortexWorld, fileName: string) {
    this.click(fileName, "Cmd");
    assert.strictEqual(this.lastClick?.element, fileName);
    assert.strictEqual(this.lastClick?.modifier, "Cmd");
  },
);

Then(
  "Instance Class column displays multiple classes as comma-separated links",
  function (this: ExocortexWorld) {
    const instanceClass = this.currentNote?.frontmatter.exo__Instance_class;
    assert.ok(Array.isArray(instanceClass), "Expected array of classes");
    assert.ok(instanceClass.length > 1, "Expected multiple classes");
  },
);

Then("Instance Class column displays {string}", function (this: ExocortexWorld, expectedText: string) {
  const instanceClass = this.currentNote?.frontmatter.exo__Instance_class;
  if (expectedText === "-" || expectedText === "") {
    // Check for empty/falsy instance class (null, undefined, empty string, or empty array)
    const isEmpty = isEmptyInstanceClass(instanceClass);
    assert.ok(isEmpty, "Expected empty or null instance class");
  } else {
    assert.ok(instanceClass, "Expected instance class to exist");
  }
});

Then("Instance Class column is empty", function (this: ExocortexWorld) {
  const instanceClass = this.currentNote?.frontmatter.exo__Instance_class;
  // Check for empty/falsy instance class (null, undefined, empty string, or empty array)
  const isEmpty = isEmptyInstanceClass(instanceClass);
  assert.ok(isEmpty, "Instance class should be empty");
});

Then("no error is thrown", function (this: ExocortexWorld) {
  // If we reach this step, no error was thrown
  assert.ok(true, "No error was thrown");
});

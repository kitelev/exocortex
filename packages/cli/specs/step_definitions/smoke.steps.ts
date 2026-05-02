import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { CliBddWorld } from "../support/world.js";

Given("the CLI BDD harness is initialized", function (this: CliBddWorld) {
  this.initialized = true;
});

When(
  "I record the value {string}",
  function (this: CliBddWorld, value: string) {
    assert.equal(this.initialized, true, "harness must be initialized");
    this.recordedValue = value;
  },
);

Then(
  "the recorded value should be {string}",
  function (this: CliBddWorld, expected: string) {
    assert.equal(this.recordedValue, expected);
  },
);

When(
  "I exec the CLI helper {string} with payload {string}",
  function (this: CliBddWorld, helper: string, payload: string) {
    assert.equal(this.initialized, true, "harness must be initialized");
    if (helper === "echo") {
      this.helperResult = { exitCode: 0, stdout: payload, stderr: "" };
      return;
    }
    this.helperResult = {
      exitCode: 1,
      stdout: "",
      stderr: `unknown helper: ${helper}`,
    };
  },
);

Then(
  "the helper exit code should be {int}",
  function (this: CliBddWorld, expected: number) {
    assert.ok(this.helperResult, "helper must have run");
    assert.equal(this.helperResult!.exitCode, expected);
  },
);

Then(
  "the helper stdout should be {string}",
  function (this: CliBddWorld, expected: string) {
    assert.ok(this.helperResult, "helper must have run");
    assert.equal(this.helperResult!.stdout, expected);
  },
);

/**
 * Unit tests for `resolveCommandsRegionState` — the cold-start COMMANDS region
 * decision (RFC 0002 §3.8 P13, GitHub #3588).
 *
 * The three-way contract:
 *   - resolved buttons present            → "buttons"
 *   - empty AND store still indexing       → "skeleton" (transient placeholder)
 *   - empty AND store ready                → "empty"   (genuine: render nothing)
 */
import { describe, it, expect } from "@jest/globals";
import {
  resolveCommandsRegionState,
  COMMANDS_SKELETON_TEXT,
} from "@plugin/presentation/renderers/commandsRegionState";

describe("resolveCommandsRegionState", () => {
  it("renders buttons whenever any command group resolved — even mid-indexing", () => {
    expect(resolveCommandsRegionState(1, true)).toBe("buttons");
    expect(resolveCommandsRegionState(3, false)).toBe("buttons");
  });

  it("shows the skeleton when the region is empty AND the store is still indexing (partial-store window)", () => {
    expect(resolveCommandsRegionState(0, false)).toBe("skeleton");
  });

  it("renders nothing (empty) when the region is empty AND the store is ready — genuine no-commands asset", () => {
    expect(resolveCommandsRegionState(0, true)).toBe("empty");
  });

  it("never shows the skeleton once buttons exist, regardless of readiness", () => {
    // Buttons present trumps readiness in both directions.
    expect(resolveCommandsRegionState(5, false)).not.toBe("skeleton");
    expect(resolveCommandsRegionState(5, true)).not.toBe("skeleton");
  });

  it("exposes the RFC §3.8 skeleton copy", () => {
    expect(COMMANDS_SKELETON_TEXT).toBe("indexing… buttons will appear shortly");
  });
});

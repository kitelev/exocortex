import { EFFORT_STATUS_OPTIONS } from "../../../src/domain/constants";

describe("EFFORT_STATUS_OPTIONS (RFC 31c1a0be Phase 4 PR-D, #3194)", () => {
  it("should expose 7 options with value and label", () => {
    expect(EFFORT_STATUS_OPTIONS).toHaveLength(7);
    for (const opt of EFFORT_STATUS_OPTIONS) {
      expect(opt.value).toMatch(/^\[\[ems__EffortStatus\w+\]\]$/);
      expect(opt.label).toBeTruthy();
    }
  });

  it("should have correct label/value pairs", () => {
    const draft = EFFORT_STATUS_OPTIONS.find((o) => o.label === "Draft");
    expect(draft?.value).toBe("[[ems__EffortStatusDraft]]");

    const doing = EFFORT_STATUS_OPTIONS.find((o) => o.label === "Doing");
    expect(doing?.value).toBe("[[ems__EffortStatusDoing]]");

    const done = EFFORT_STATUS_OPTIONS.find((o) => o.label === "Done");
    expect(done?.value).toBe("[[ems__EffortStatusDone]]");
  });
});

import { EffortStatus } from "../../../src/domain/constants/EffortStatus";

describe("EffortStatus", () => {
  it("should have DRAFT constant", () => {
    expect(EffortStatus.DRAFT).toBe("ems__EffortStatusDraft");
  });

  it("should have BACKLOG constant", () => {
    expect(EffortStatus.BACKLOG).toBe("ems__EffortStatusBacklog");
  });

  it("should have ANALYSIS constant", () => {
    expect(EffortStatus.ANALYSIS).toBe("ems__EffortStatusAnalysis");
  });

  it("should have TODO constant", () => {
    expect(EffortStatus.TODO).toBe("ems__EffortStatusToDo");
  });

  it("should have DOING constant", () => {
    expect(EffortStatus.DOING).toBe("ems__EffortStatusDoing");
  });

  it("should have DONE constant", () => {
    expect(EffortStatus.DONE).toBe("ems__EffortStatusDone");
  });

  it("should have TRASHED constant", () => {
    expect(EffortStatus.TRASHED).toBe("ems__EffortStatusTrashed");
  });

  it("should have exactly 7 statuses", () => {
    const values = Object.values(EffortStatus);
    expect(values).toHaveLength(7);
  });
});

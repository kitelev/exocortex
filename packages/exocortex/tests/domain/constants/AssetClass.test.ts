import { AssetClass } from "../../../src/domain/constants/AssetClass";

describe("AssetClass", () => {
  it("should have AREA constant", () => {
    expect(AssetClass.AREA).toBe("ems__Area");
  });

  it("should have TASK constant", () => {
    expect(AssetClass.TASK).toBe("ems__Task");
  });

  it("should have PROJECT constant", () => {
    expect(AssetClass.PROJECT).toBe("ems__Project");
  });

  it("should have MEETING constant", () => {
    expect(AssetClass.MEETING).toBe("ems__Meeting");
  });

  it("should have INITIATIVE constant", () => {
    expect(AssetClass.INITIATIVE).toBe("ems__Initiative");
  });

  it("should have TASK_PROTOTYPE constant", () => {
    expect(AssetClass.TASK_PROTOTYPE).toBe("ems__TaskPrototype");
  });

  it("should have MEETING_PROTOTYPE constant", () => {
    expect(AssetClass.MEETING_PROTOTYPE).toBe("ems__MeetingPrototype");
  });

  it("should have DAILY_NOTE constant", () => {
    expect(AssetClass.DAILY_NOTE).toBe("pn__DailyNote");
  });

  it("should have CONCEPT constant", () => {
    expect(AssetClass.CONCEPT).toBe("ims__Concept");
  });

  it("should have exactly 9 constants", () => {
    const values = Object.values(AssetClass);
    expect(values).toHaveLength(9);
  });
});

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

  it("should have TASK_PROTOTYPE_UID constant", () => {
    expect(AssetClass.TASK_PROTOTYPE_UID).toBe("75302770-279e-4a59-ba85-09df29725713");
  });

  it("should have MEETING_PROTOTYPE constant", () => {
    expect(AssetClass.MEETING_PROTOTYPE).toBe("ems__MeetingPrototype");
  });

  it("should have EVENT_PROTOTYPE constant", () => {
    expect(AssetClass.EVENT_PROTOTYPE).toBe("exo__EventPrototype");
  });

  it("should have PROJECT_PROTOTYPE constant", () => {
    expect(AssetClass.PROJECT_PROTOTYPE).toBe("ems__ProjectPrototype");
  });

  it("should have EVENT constant", () => {
    expect(AssetClass.EVENT).toBe("exo__Event");
  });

  it("should have DAILY_NOTE constant", () => {
    expect(AssetClass.DAILY_NOTE).toBe("pn__DailyNote");
  });

  it("should have CONCEPT constant", () => {
    expect(AssetClass.CONCEPT).toBe("ims__Concept");
  });

  it("should have SESSION_START_EVENT constant", () => {
    expect(AssetClass.SESSION_START_EVENT).toBe("ems__SessionStartEvent");
  });

  it("should have SESSION_END_EVENT constant", () => {
    expect(AssetClass.SESSION_END_EVENT).toBe("ems__SessionEndEvent");
  });

  it("should have PROTOTYPE constant", () => {
    expect(AssetClass.PROTOTYPE).toBe("exo__Prototype");
  });

  it("should have CLASS constant", () => {
    expect(AssetClass.CLASS).toBe("exo__Class");
  });

  it("should have exactly 19 constants", () => {
    const values = Object.values(AssetClass);
    expect(values).toHaveLength(19);
  });
});

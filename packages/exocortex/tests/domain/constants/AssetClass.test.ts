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

  it("should have WORKFLOW constant", () => {
    expect(AssetClass.WORKFLOW).toBe("ems__Workflow");
  });

  it("should have WORKFLOW_STATE constant", () => {
    expect(AssetClass.WORKFLOW_STATE).toBe("ems__WorkflowState");
  });

  it("should have WORKFLOW_TRANSITION constant", () => {
    expect(AssetClass.WORKFLOW_TRANSITION).toBe("ems__WorkflowTransition");
  });

  it("should have COMMAND constant (RFC-009)", () => {
    expect(AssetClass.COMMAND).toBe("exocmd__Command");
  });

  it("should have PRECONDITION constant (RFC-009)", () => {
    expect(AssetClass.PRECONDITION).toBe("exocmd__Precondition");
  });

  it("should have GROUNDING constant (RFC-009)", () => {
    expect(AssetClass.GROUNDING).toBe("exocmd__Grounding");
  });

  it("should have COMMAND_BINDING constant (RFC-009)", () => {
    expect(AssetClass.COMMAND_BINDING).toBe("exocmd__CommandBinding");
  });

  it("should have exactly 26 constants", () => {
    const values = Object.values(AssetClass);
    expect(values).toHaveLength(26);
  });
});

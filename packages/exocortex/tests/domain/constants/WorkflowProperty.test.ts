import {
  WorkflowProperty,
  WorkflowStateProperty,
  WorkflowTransitionProperty,
  EFFORT_WORKFLOW_PROPERTY,
} from "../../../src/domain/constants/WorkflowProperty";

describe("WorkflowProperty", () => {
  it("should have TARGET_CLASS property", () => {
    expect(WorkflowProperty.TARGET_CLASS).toBe("ems__Workflow_targetClass");
  });

  it("should have INITIAL_STATE property", () => {
    expect(WorkflowProperty.INITIAL_STATE).toBe("ems__Workflow_initialState");
  });

  it("should have TERMINAL_STATES property", () => {
    expect(WorkflowProperty.TERMINAL_STATES).toBe("ems__Workflow_terminalStates");
  });

  it("should have IS_DEFAULT property", () => {
    expect(WorkflowProperty.IS_DEFAULT).toBe("ems__Workflow_isDefault");
  });

  it("should have exactly 4 properties", () => {
    expect(Object.keys(WorkflowProperty)).toHaveLength(4);
  });
});

describe("WorkflowStateProperty", () => {
  it("should have WORKFLOW property", () => {
    expect(WorkflowStateProperty.WORKFLOW).toBe("ems__WorkflowState_workflow");
  });

  it("should have STATUS property", () => {
    expect(WorkflowStateProperty.STATUS).toBe("ems__WorkflowState_status");
  });

  it("should have ORDER property", () => {
    expect(WorkflowStateProperty.ORDER).toBe("ems__WorkflowState_order");
  });

  it("should have OPTIONAL property", () => {
    expect(WorkflowStateProperty.OPTIONAL).toBe("ems__WorkflowState_optional");
  });

  it("should have TIMESTAMP_ON_ENTER property", () => {
    expect(WorkflowStateProperty.TIMESTAMP_ON_ENTER).toBe("ems__WorkflowState_timestampOnEnter");
  });

  it("should have BADGE_COLOR property", () => {
    expect(WorkflowStateProperty.BADGE_COLOR).toBe("ems__WorkflowState_badgeColor");
  });

  it("should have exactly 6 properties", () => {
    expect(Object.keys(WorkflowStateProperty)).toHaveLength(6);
  });
});

describe("WorkflowTransitionProperty", () => {
  it("should have WORKFLOW property", () => {
    expect(WorkflowTransitionProperty.WORKFLOW).toBe("ems__WorkflowTransition_workflow");
  });

  it("should have FROM property", () => {
    expect(WorkflowTransitionProperty.FROM).toBe("ems__WorkflowTransition_from");
  });

  it("should have TO property", () => {
    expect(WorkflowTransitionProperty.TO).toBe("ems__WorkflowTransition_to");
  });

  it("should have LABEL property", () => {
    expect(WorkflowTransitionProperty.LABEL).toBe("ems__WorkflowTransition_label");
  });

  it("should have ICON property", () => {
    expect(WorkflowTransitionProperty.ICON).toBe("ems__WorkflowTransition_icon");
  });

  it("should have IS_ROLLBACK property", () => {
    expect(WorkflowTransitionProperty.IS_ROLLBACK).toBe("ems__WorkflowTransition_isRollback");
  });

  it("should have exactly 6 properties", () => {
    expect(Object.keys(WorkflowTransitionProperty)).toHaveLength(6);
  });
});

describe("EFFORT_WORKFLOW_PROPERTY", () => {
  it("should be ems__Effort_workflow", () => {
    expect(EFFORT_WORKFLOW_PROPERTY).toBe("ems__Effort_workflow");
  });
});

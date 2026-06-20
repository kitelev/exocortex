import { GroundingType } from "../../../../src/domain/constants/GroundingType";
import {
  CommandProperty,
  PreconditionProperty,
  GroundingProperty,
  CommandBindingProperty,
} from "../../../../src/domain/constants/CommandProperty";
import { AssetClass } from "../../../../src/domain/constants/AssetClass";

describe("GroundingType", () => {
  it("should have all 6 grounding types", () => {
    expect(GroundingType.SPARQL_UPDATE).toBe("sparql_update");
    expect(GroundingType.PROPERTY_DELETE).toBe("property_delete");
    expect(GroundingType.PROPERTY_SET).toBe("property_set");
    expect(GroundingType.COMPOSITE).toBe("composite");
    expect(GroundingType.SERVICE_CALL).toBe("service_call");
    expect(GroundingType.CREATE_INSTANCE).toBe("create_instance");
  });

  it("should have exactly 11 values", () => {
    // SPARQL_UPDATE, PROPERTY_DELETE, PROPERTY_SET, COMPOSITE, SERVICE_CALL,
    // CREATE_INSTANCE, PROPERTY_APPEND (#3132), PROPERTY_INCREMENT (#3134),
    // PROPERTY_SHIFT (#3134), WORKFLOW_TRANSITION (RFC 36347daf Phase 2),
    // BODY_TEMPLATE (subproject 17f58ebe Веха 3).
    const values = Object.values(GroundingType);
    expect(values).toHaveLength(11);
  });
});

describe("CommandProperty", () => {
  it("should have correct exocmd__Command_* property names", () => {
    expect(CommandProperty.ICON).toBe("exocmd__Command_icon");
    expect(CommandProperty.PRECONDITION).toBe("exocmd__Command_precondition");
    expect(CommandProperty.GROUNDING).toBe("exocmd__Command_grounding");
    expect(CommandProperty.CONFIRM_MESSAGE).toBe("exocmd__Command_confirmMessage");
    expect(CommandProperty.SUCCESS_MESSAGE).toBe("exocmd__Command_successMessage");
    expect(CommandProperty.CATEGORY).toBe("exocmd__Command_category");
  });
});

describe("PreconditionProperty", () => {
  it("should have correct exocmd__Precondition_* property names", () => {
    expect(PreconditionProperty.SPARQL_ASK).toBe("exocmd__Precondition_sparqlAsk");
  });
});

describe("GroundingProperty", () => {
  it("should have correct exocmd__Grounding_* property names", () => {
    expect(GroundingProperty.TYPE).toBe("exocmd__Grounding_type");
    expect(GroundingProperty.SPARQL_UPDATE).toBe("exocmd__Grounding_sparqlUpdate");
    expect(GroundingProperty.TARGET_PROPERTY).toBe("exocmd__Grounding_targetProperty");
    expect(GroundingProperty.STEPS).toBe("exocmd__Grounding_steps");
  });

  it("should not expose dropped legacy `TARGET_VALUE` constant (RFC 918a2b65 Phase 4)", () => {
    expect((GroundingProperty as Record<string, unknown>).TARGET_VALUE).toBeUndefined();
  });
});

describe("CommandBindingProperty", () => {
  it("should have correct exocmd__CommandBinding_* property names", () => {
    expect(CommandBindingProperty.COMMAND).toBe("exocmd__CommandBinding_command");
    expect(CommandBindingProperty.TARGET_CLASS).toBe("exocmd__CommandBinding_targetClass");
    expect(CommandBindingProperty.TARGET_PROTOTYPE).toBe("exocmd__CommandBinding_targetPrototype");
    expect(CommandBindingProperty.TARGET_ASSET).toBe("exocmd__CommandBinding_targetAsset");
    expect(CommandBindingProperty.POSITION).toBe("exocmd__CommandBinding_position");
    expect(CommandBindingProperty.ORDER).toBe("exocmd__CommandBinding_order");
    expect(CommandBindingProperty.PRECONDITION).toBe("exocmd__CommandBinding_precondition");
  });

  it("should not expose dropped legacy `GROUP` constant (RFC f1dc284a Phase 8)", () => {
    expect((CommandBindingProperty as Record<string, unknown>).GROUP).toBeUndefined();
  });
});

describe("AssetClass exocmd extensions", () => {
  it("should have COMMAND asset class", () => {
    expect(AssetClass.COMMAND).toBe("exocmd__Command");
  });

  it("should have PRECONDITION asset class", () => {
    expect(AssetClass.PRECONDITION).toBe("exocmd__Precondition");
  });

  it("should have GROUNDING asset class", () => {
    expect(AssetClass.GROUNDING).toBe("exocmd__Grounding");
  });

  it("should have COMMAND_BINDING asset class", () => {
    expect(AssetClass.COMMAND_BINDING).toBe("exocmd__CommandBinding");
  });
});

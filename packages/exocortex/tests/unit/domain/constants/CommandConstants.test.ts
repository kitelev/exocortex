import { GroundingType } from "../../../../src/domain/constants/GroundingType";
import {
  CommandProperty,
  PreconditionProperty,
  GroundingProperty,
  CommandBindingProperty,
} from "../../../../src/domain/constants/CommandProperty";
import { AssetClass } from "../../../../src/domain/constants/AssetClass";

describe("GroundingType", () => {
  it("should have all 5 RFC types", () => {
    expect(GroundingType.SPARQL_UPDATE).toBe("sparql_update");
    expect(GroundingType.PROPERTY_DELETE).toBe("property_delete");
    expect(GroundingType.PROPERTY_SET).toBe("property_set");
    expect(GroundingType.COMPOSITE).toBe("composite");
    expect(GroundingType.SERVICE_CALL).toBe("service_call");
  });

  it("should have exactly 5 values", () => {
    const values = Object.values(GroundingType);
    expect(values).toHaveLength(5);
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
    expect(GroundingProperty.TARGET_VALUE).toBe("exocmd__Grounding_targetValue");
    expect(GroundingProperty.STEPS).toBe("exocmd__Grounding_steps");
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
    expect(CommandBindingProperty.GROUP).toBe("exocmd__CommandBinding_group");
    expect(CommandBindingProperty.PRECONDITION).toBe("exocmd__CommandBinding_precondition");
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

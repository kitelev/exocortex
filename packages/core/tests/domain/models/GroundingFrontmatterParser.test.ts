import { parseGroundingDefinitionFromFrontmatter } from "../../../src/domain/models/GroundingFrontmatterParser";
import type { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GROUNDING_TYPE_UIDS } from "../../../src/domain/constants/GroundingTypeUIDs";

// Wikilink-literal form for a given grounding type (the only accepted shape
// post RFC 9d20c91f Phase 4).
const typeLink = (t: GroundingType): string => `[[${GROUNDING_TYPE_UIDS[t]}]]`;

// A resolveStep that never gets called (non-composite scenarios).
const failingResolveStep = (): GroundingDefinition => {
  throw new Error("resolveStep should not be invoked");
};

describe("parseGroundingDefinitionFromFrontmatter", () => {
  describe("full field mapping", () => {
    it("maps every exocmd__Grounding_* key to its GroundingDefinition field", () => {
      const fm: Record<string, unknown> = {
        exo__Asset_label: "Set status to Done",
        exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_SET),
        exocmd__Grounding_targetProperty: "ems__Effort_status",
        exocmd__Grounding_targetValueRef: "[[7b9b3116-7c3c-438c-9618-94fe301320a6]]",
        exocmd__Grounding_targetValueLiteral: "literal-value",
        exocmd__Grounding_targetValueSubstitution: "8f111111-2222-3333-4444-555555555555",
        exocmd__Grounding_serviceCallPayload: '{"a":1}',
        exocmd__Grounding_appendExpression: "$target.exo__Asset_label",
        exocmd__Grounding_targetClass: "gtd__InboxItem",
        exocmd__Grounding_targetPrototype: "proto-uid",
        exocmd__Grounding_targetFolder: "01 Inbox",
        exocmd__Grounding_shiftDelta: "P1D",
        exocmd__Grounding_incrementBy: "3",
        exocmd__Grounding_linkBackProperty: "exo__Asset_source",
      };

      const def = parseGroundingDefinitionFromFrontmatter(
        "grounding-uid",
        fm,
        failingResolveStep,
      );

      expect(def.id).toBe("grounding-uid");
      expect(def.label).toBe("Set status to Done");
      expect(def.type).toBe(GroundingType.PROPERTY_SET);
      expect(def.targetProperty).toBe("ems__Effort_status");
      // targetValueRef unwrapped to bare UID.
      expect(def.targetValueRef).toBe("7b9b3116-7c3c-438c-9618-94fe301320a6");
      expect(def.targetValueLiteral).toBe("literal-value");
      expect(def.targetValueSubstitution).toBe(
        "8f111111-2222-3333-4444-555555555555",
      );
      expect(def.serviceCallPayload).toBe('{"a":1}');
      expect(def.appendExpression).toBe("$target.exo__Asset_label");
      expect(def.targetClass).toBe("gtd__InboxItem");
      expect(def.targetPrototype).toBe("proto-uid");
      expect(def.targetFolder).toBe("01 Inbox");
      expect(def.shiftDelta).toBe("P1D");
      expect(def.incrementBy).toBe(3);
      expect(def.linkBackProperty).toBe("exo__Asset_source");
      // Non-composite → no steps.
      expect(def.steps).toBeUndefined();
    });

    it("defaults label to empty string when exo__Asset_label is absent", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        { exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_DELETE) },
        failingResolveStep,
      );
      expect(def.label).toBe("");
      expect(def.type).toBe(GroundingType.PROPERTY_DELETE);
    });

    it("leaves unset optional keys undefined", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        { exocmd__Grounding_type: typeLink(GroundingType.SPARQL_UPDATE) },
        failingResolveStep,
      );
      expect(def.targetProperty).toBeUndefined();
      expect(def.targetValueRef).toBeUndefined();
      expect(def.targetValueLiteral).toBeUndefined();
      expect(def.serviceCallPayload).toBeUndefined();
      expect(def.appendExpression).toBeUndefined();
      expect(def.targetClass).toBeUndefined();
      expect(def.incrementBy).toBeUndefined();
      expect(def.steps).toBeUndefined();
    });
  });

  describe("type resolution", () => {
    it("resolves wikilink-literal form to the GroundingType enum", () => {
      for (const t of Object.values(GroundingType)) {
        const def = parseGroundingDefinitionFromFrontmatter(
          "uid",
          { exocmd__Grounding_type: typeLink(t) },
          failingResolveStep,
        );
        expect(def.type).toBe(t);
      }
    });

    it("throws on legacy literal-string type form (RFC 9d20c91f Phase 4)", () => {
      expect(() =>
        parseGroundingDefinitionFromFrontmatter(
          "fixture-uid",
          { exocmd__Grounding_type: "property_set" },
          failingResolveStep,
        ),
      ).toThrow(/legacy literal-string 'property_set'/);
    });

    it("passes a non-string type value through unchanged", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        { exocmd__Grounding_type: undefined },
        failingResolveStep,
      );
      expect(def.type).toBeUndefined();
    });
  });

  describe("service_call serviceId fallback", () => {
    it("reads targetProperty from Grounding_serviceId for service_call", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.SERVICE_CALL),
          exocmd__Grounding_serviceId: "archiveAsset",
          exocmd__Grounding_targetProperty: "should-be-ignored",
        },
        failingResolveStep,
      );
      expect(def.targetProperty).toBe("archiveAsset");
    });

    it("falls back to Grounding_targetProperty when serviceId absent (service_call)", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.SERVICE_CALL),
          exocmd__Grounding_targetProperty: "fallback-prop",
        },
        failingResolveStep,
      );
      expect(def.targetProperty).toBe("fallback-prop");
    });

    it("ignores Grounding_serviceId for non-service_call types", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_SET),
          exocmd__Grounding_serviceId: "archiveAsset",
          exocmd__Grounding_targetProperty: "ems__Effort_status",
        },
        failingResolveStep,
      );
      expect(def.targetProperty).toBe("ems__Effort_status");
    });
  });

  describe("composite steps", () => {
    it("resolves each step via the resolveStep callback with normalized UIDs", () => {
      const calls: string[] = [];
      const resolveStep = (stepUid: string): GroundingDefinition => {
        calls.push(stepUid);
        return {
          id: stepUid,
          label: `step-${stepUid}`,
          type: GroundingType.PROPERTY_DELETE,
        };
      };

      const def = parseGroundingDefinitionFromFrontmatter(
        "composite-uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.COMPOSITE),
          exocmd__Grounding_steps: [
            "[[aaaaaaaa-1111-2222-3333-444444444444]]",
            "[[bbbbbbbb-5555-6666-7777-888888888888|Step Two Alias]]",
          ],
        },
        resolveStep,
      );

      // Step refs normalized: wikilink brackets stripped, UUID-alias collapses
      // to the TARGET uid (not the alias).
      expect(calls).toEqual([
        "aaaaaaaa-1111-2222-3333-444444444444",
        "bbbbbbbb-5555-6666-7777-888888888888",
      ]);
      expect(def.steps).toHaveLength(2);
      expect(def.steps?.[0].id).toBe("aaaaaaaa-1111-2222-3333-444444444444");
      expect(def.steps?.[1].label).toBe(
        "step-bbbbbbbb-5555-6666-7777-888888888888",
      );
    });

    it("leaves steps undefined when Grounding_steps is absent on composite", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        { exocmd__Grounding_type: typeLink(GroundingType.COMPOSITE) },
        failingResolveStep,
      );
      expect(def.steps).toBeUndefined();
    });

    it("does not resolve steps for non-composite types even if present", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_SET),
          exocmd__Grounding_steps: ["[[aaaaaaaa-1111-2222-3333-444444444444]]"],
        },
        failingResolveStep,
      );
      expect(def.steps).toBeUndefined();
    });
  });

  describe("incrementBy parsing", () => {
    const cases: Array<[unknown, number | undefined]> = [
      ["3", 3],
      [5, 5],
      ["-2", -2],
      ["", undefined],
      [null, undefined],
      [undefined, undefined],
      ["not-a-number", undefined],
    ];

    it.each(cases)("parses incrementBy %p → %p", (raw, expected) => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_INCREMENT),
          exocmd__Grounding_incrementBy: raw,
        },
        failingResolveStep,
      );
      expect(def.incrementBy).toBe(expected);
    });
  });

  describe("targetValueRef normalization", () => {
    it("unwraps plain wikilink to bare UID", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_SET),
          exocmd__Grounding_targetValueRef: "[[abc-123]]",
        },
        failingResolveStep,
      );
      expect(def.targetValueRef).toBe("abc-123");
    });

    it("collapses UUID-alias form to the TARGET uid (not the alias)", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_SET),
          exocmd__Grounding_targetValueRef:
            "[[7b9b3116-7c3c-438c-9618-94fe301320a6|ems__EffortStatusDone]]",
        },
        failingResolveStep,
      );
      expect(def.targetValueRef).toBe("7b9b3116-7c3c-438c-9618-94fe301320a6");
    });

    it("strips surrounding quote chars while normalizing", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_SET),
          exocmd__Grounding_targetValueRef: '"[[abc-123]]"',
        },
        failingResolveStep,
      );
      expect(def.targetValueRef).toBe("abc-123");
    });
  });

  describe("body_template fields (Веха 3, subproject 17f58ebe)", () => {
    it("maps inline exocmd__Grounding_bodyTemplate to bodyTemplate", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.BODY_TEMPLATE),
          exocmd__Grounding_bodyTemplate: "## Plan\n- $today",
        },
        failingResolveStep,
      );
      expect(def.type).toBe(GroundingType.BODY_TEMPLATE);
      expect(def.bodyTemplate).toBe("## Plan\n- $today");
      expect(def.templateRef).toBeUndefined();
    });

    it("normalizes exocmd__Grounding_templateRef wikilink to a bare UID", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        {
          exocmd__Grounding_type: typeLink(GroundingType.BODY_TEMPLATE),
          exocmd__Grounding_templateRef:
            '"[[8bdf4506-80bf-4999-8fda-1ea0808b4ee5|exotemplate__Template]]"',
        },
        failingResolveStep,
      );
      expect(def.templateRef).toBe("8bdf4506-80bf-4999-8fda-1ea0808b4ee5");
    });

    it("leaves both fields undefined when neither key is present", () => {
      const def = parseGroundingDefinitionFromFrontmatter(
        "uid",
        { exocmd__Grounding_type: typeLink(GroundingType.PROPERTY_SET) },
        failingResolveStep,
      );
      expect(def.bodyTemplate).toBeUndefined();
      expect(def.templateRef).toBeUndefined();
    });
  });
});

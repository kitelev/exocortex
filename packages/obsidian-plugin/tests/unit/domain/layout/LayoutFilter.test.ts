import { describe, it, expect } from "@jest/globals";
import {
  createLayoutFilterFromFrontmatter,
  isValidFilterOperator,
  isSimpleFilter,
  isSparqlFilter,
  type LayoutFilter,
  type FilterOperator,
} from "../../../../src/domain/layout/LayoutFilter";

describe("LayoutFilter", () => {
  describe("createLayoutFilterFromFrontmatter", () => {
    it("should create a simple LayoutFilter from valid frontmatter", () => {
      const frontmatter = {
        exo__Asset_uid: "filter-001",
        exo__Asset_label: "Active Tasks Filter",
        exo__Asset_description: "Filter out completed tasks",
        exo__LayoutFilter_property: "[[ems__Effort_status]]",
        exo__LayoutFilter_operator: "ne",
        exo__LayoutFilter_value: "[[ems__EffortStatus_Done]]",
      };

      const result = createLayoutFilterFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.uid).toBe("filter-001");
      expect(result!.label).toBe("Active Tasks Filter");
      expect(result!.description).toBe("Filter out completed tasks");
      expect(result!.property).toBe("[[ems__Effort_status]]");
      expect(result!.operator).toBe("ne");
      expect(result!.value).toBe("[[ems__EffortStatus_Done]]");
      expect(result!.sparql).toBeUndefined();
    });

    it("should create a SPARQL LayoutFilter from valid frontmatter", () => {
      const sparqlQuery = `
        ?asset ems:Task_currentEffort ?effort .
        ?effort ems:Effort_startTimestamp ?start .
        FILTER(?start >= NOW() - "P1D"^^xsd:duration)
      `;
      const frontmatter = {
        exo__Asset_uid: "filter-002",
        exo__Asset_label: "Today Filter",
        exo__Asset_description: "Filter tasks started today",
        exo__LayoutFilter_sparql: sparqlQuery,
      };

      const result = createLayoutFilterFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.uid).toBe("filter-002");
      expect(result!.label).toBe("Today Filter");
      expect(result!.sparql).toBe(sparqlQuery);
      expect(result!.property).toBeUndefined();
      expect(result!.operator).toBeUndefined();
    });

    it("should return null when uid is missing", () => {
      const frontmatter = {
        exo__Asset_label: "No UID Filter",
        exo__LayoutFilter_property: "[[ems__Effort_status]]",
        exo__LayoutFilter_operator: "eq",
      };

      const result = createLayoutFilterFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when label is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "filter-001",
        exo__LayoutFilter_property: "[[ems__Effort_status]]",
        exo__LayoutFilter_operator: "eq",
      };

      const result = createLayoutFilterFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when neither property nor sparql is present", () => {
      const frontmatter = {
        exo__Asset_uid: "filter-001",
        exo__Asset_label: "Invalid Filter",
        exo__LayoutFilter_operator: "eq",
        exo__LayoutFilter_value: "some value",
      };

      const result = createLayoutFilterFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should handle all valid filter operators", () => {
      const operators: FilterOperator[] = [
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "startsWith",
        "endsWith",
        "in",
        "notIn",
        "isNull",
        "isNotNull",
      ];

      for (const operator of operators) {
        const frontmatter = {
          exo__Asset_uid: `filter-${operator}`,
          exo__Asset_label: `${operator} Filter`,
          exo__LayoutFilter_property: "[[some_property]]",
          exo__LayoutFilter_operator: operator,
        };

        const result = createLayoutFilterFromFrontmatter(frontmatter);
        expect(result).not.toBeNull();
        expect(result!.operator).toBe(operator);
      }
    });

    it("should set operator to undefined for invalid operator value", () => {
      const frontmatter = {
        exo__Asset_uid: "filter-001",
        exo__Asset_label: "Invalid Operator Filter",
        exo__LayoutFilter_property: "[[some_property]]",
        exo__LayoutFilter_operator: "invalid_operator",
      };

      const result = createLayoutFilterFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.operator).toBeUndefined();
    });

    it("should handle filter with both property and sparql", () => {
      const frontmatter = {
        exo__Asset_uid: "filter-001",
        exo__Asset_label: "Complex Filter",
        exo__LayoutFilter_property: "[[ems__Effort_status]]",
        exo__LayoutFilter_operator: "eq",
        exo__LayoutFilter_sparql: "?asset ?p ?o",
      };

      const result = createLayoutFilterFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.property).toBe("[[ems__Effort_status]]");
      expect(result!.sparql).toBe("?asset ?p ?o");
    });

    it("should handle value being undefined for isNull operator", () => {
      const frontmatter = {
        exo__Asset_uid: "filter-001",
        exo__Asset_label: "Null Check Filter",
        exo__LayoutFilter_property: "[[some_property]]",
        exo__LayoutFilter_operator: "isNull",
      };

      const result = createLayoutFilterFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.operator).toBe("isNull");
      expect(result!.value).toBeUndefined();
    });
  });

  describe("isValidFilterOperator", () => {
    it("should return true for all valid operators", () => {
      const validOperators = [
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "startsWith",
        "endsWith",
        "in",
        "notIn",
        "isNull",
        "isNotNull",
      ];

      for (const op of validOperators) {
        expect(isValidFilterOperator(op)).toBe(true);
      }
    });

    it("should return false for invalid operator strings", () => {
      expect(isValidFilterOperator("invalid")).toBe(false);
      expect(isValidFilterOperator("")).toBe(false);
      expect(isValidFilterOperator("EQ")).toBe(false);
      expect(isValidFilterOperator("equal")).toBe(false);
      expect(isValidFilterOperator("=")).toBe(false);
      expect(isValidFilterOperator("!=")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(isValidFilterOperator(null)).toBe(false);
      expect(isValidFilterOperator(undefined)).toBe(false);
      expect(isValidFilterOperator(123)).toBe(false);
      expect(isValidFilterOperator(true)).toBe(false);
      expect(isValidFilterOperator({})).toBe(false);
    });
  });

  describe("isSimpleFilter", () => {
    it("should return true for filter with property and operator", () => {
      const filter: LayoutFilter = {
        uid: "filter-001",
        label: "Simple Filter",
        property: "[[some_property]]",
        operator: "eq",
        value: "some value",
      };

      expect(isSimpleFilter(filter)).toBe(true);
    });

    it("should return false for filter without property", () => {
      const filter: LayoutFilter = {
        uid: "filter-001",
        label: "SPARQL Only Filter",
        sparql: "?asset ?p ?o",
      };

      expect(isSimpleFilter(filter)).toBe(false);
    });

    it("should return false for filter without operator", () => {
      const filter: LayoutFilter = {
        uid: "filter-001",
        label: "Property Only Filter",
        property: "[[some_property]]",
      };

      expect(isSimpleFilter(filter)).toBe(false);
    });
  });

  describe("isSparqlFilter", () => {
    it("should return true for filter with sparql", () => {
      const filter: LayoutFilter = {
        uid: "filter-001",
        label: "SPARQL Filter",
        sparql: "?asset ?p ?o",
      };

      expect(isSparqlFilter(filter)).toBe(true);
    });

    it("should return false for filter without sparql", () => {
      const filter: LayoutFilter = {
        uid: "filter-001",
        label: "Simple Filter",
        property: "[[some_property]]",
        operator: "eq",
      };

      expect(isSparqlFilter(filter)).toBe(false);
    });

    it("should return true for filter with both property and sparql", () => {
      const filter: LayoutFilter = {
        uid: "filter-001",
        label: "Combined Filter",
        property: "[[some_property]]",
        operator: "eq",
        sparql: "?asset ?p ?o",
      };

      expect(isSparqlFilter(filter)).toBe(true);
    });
  });

  describe("type safety", () => {
    it("should allow creating LayoutFilter with all fields", () => {
      const filter: LayoutFilter = {
        uid: "filter-001",
        label: "Full Filter",
        description: "A fully specified filter",
        property: "[[ems__Effort_status]]",
        operator: "ne",
        value: "[[ems__EffortStatus_Done]]",
        sparql: "OPTIONAL { ?asset ?p ?o }",
      };

      expect(filter.uid).toBe("filter-001");
      expect(filter.operator).toBe("ne");
    });

    it("should allow creating minimal SPARQL filter", () => {
      const filter: LayoutFilter = {
        uid: "filter-001",
        label: "Minimal SPARQL Filter",
        sparql: "?asset ?p ?o",
      };

      expect(filter.uid).toBe("filter-001");
      expect(filter.property).toBeUndefined();
    });
  });
});

/**
 * Filter operators for comparing property values.
 */
export type FilterOperator =
  | "eq" // Equal
  | "ne" // Not equal
  | "gt" // Greater than
  | "gte" // Greater than or equal
  | "lt" // Less than
  | "lte" // Less than or equal
  | "contains" // String contains
  | "startsWith" // String starts with
  | "endsWith" // String ends with
  | "in" // Value in list
  | "notIn" // Value not in list
  | "isNull" // Value is null/undefined
  | "isNotNull"; // Value is not null/undefined

/**
 * Layout Filter interface.
 * Defines filtering conditions for assets in a Layout.
 *
 * Maps to ontology class: exo__LayoutFilter
 *
 * Filters can be either:
 * 1. Simple property-based filters with operator and value
 * 2. Complex SPARQL-based filters with a WHERE clause
 *
 * Properties from ontology:
 * - exo__LayoutFilter_property: Reference to the property to filter
 * - exo__LayoutFilter_operator: Comparison operator
 * - exo__LayoutFilter_value: Value to compare against
 * - exo__LayoutFilter_sparql: SPARQL WHERE clause for complex filters
 *
 * @example
 * Simple filter:
 * ```typescript
 * const activeTasksFilter: LayoutFilter = {
 *   uid: "filter-001",
 *   label: "Active Tasks Filter",
 *   property: "[[ems__Effort_status]]",
 *   operator: "ne",
 *   value: "[[ems__EffortStatus_Done]]"
 * };
 * ```
 *
 * SPARQL filter:
 * ```typescript
 * const todayFilter: LayoutFilter = {
 *   uid: "filter-002",
 *   label: "Today Filter",
 *   sparql: `
 *     ?asset ems:Task_currentEffort ?effort .
 *     ?effort ems:Effort_startTimestamp ?start .
 *     FILTER(?start >= NOW() - "P1D"^^xsd:duration)
 *   `
 * };
 * ```
 */
export interface LayoutFilter {
  /**
   * Unique identifier for the filter definition.
   * Corresponds to exo__Asset_uid in frontmatter.
   */
  uid: string;

  /**
   * Human-readable label for the filter.
   * Corresponds to exo__Asset_label in frontmatter.
   */
  label: string;

  /**
   * Description of the filter.
   * Corresponds to exo__Asset_description in frontmatter.
   */
  description?: string;

  /**
   * Reference to the property to filter by.
   * Value is a wikilink reference like "[[ems__Effort_status]]".
   * Maps to exo__LayoutFilter_property.
   * Optional if using SPARQL filter.
   */
  property?: string;

  /**
   * Comparison operator for simple filters.
   * Maps to exo__LayoutFilter_operator.
   * Optional if using SPARQL filter.
   */
  operator?: FilterOperator;

  /**
   * Value to compare against for simple filters.
   * Can be a literal value or wikilink reference.
   * Maps to exo__LayoutFilter_value.
   * Optional if using SPARQL filter or isNull/isNotNull operators.
   */
  value?: string;

  /**
   * SPARQL WHERE clause for complex filters.
   * Should use ?asset as the main variable binding.
   * Maps to exo__LayoutFilter_sparql.
   * Optional if using simple property filter.
   */
  sparql?: string;
}

/**
 * Create a LayoutFilter from frontmatter data.
 *
 * @param frontmatter - The YAML frontmatter object from an Obsidian note
 * @returns A LayoutFilter object or null if required fields are missing
 *
 * @example
 * ```typescript
 * const frontmatter = {
 *   exo__Asset_uid: "60000000-0000-0000-0000-000000000030",
 *   exo__Asset_label: "Today Filter",
 *   exo__LayoutFilter_sparql: "?asset ems:Task_currentEffort ?effort ..."
 * };
 * const filter = createLayoutFilterFromFrontmatter(frontmatter);
 * ```
 */
export function createLayoutFilterFromFrontmatter(
  frontmatter: Record<string, unknown>,
): LayoutFilter | null {
  const uid = frontmatter["exo__Asset_uid"] as string | undefined;
  const label = frontmatter["exo__Asset_label"] as string | undefined;

  if (!uid || !label) {
    return null;
  }

  const property = frontmatter["exo__LayoutFilter_property"] as
    | string
    | undefined;
  const operator = frontmatter["exo__LayoutFilter_operator"] as
    | string
    | undefined;
  const value = frontmatter["exo__LayoutFilter_value"] as string | undefined;
  const sparql = frontmatter["exo__LayoutFilter_sparql"] as string | undefined;

  // Must have either simple filter (property + operator) or SPARQL filter
  if (!sparql && !property) {
    return null;
  }

  return {
    uid,
    label,
    description: frontmatter["exo__Asset_description"] as string | undefined,
    property,
    operator: isValidFilterOperator(operator) ? operator : undefined,
    value,
    sparql,
  };
}

/**
 * Check if a value is a valid FilterOperator.
 *
 * @param value - The value to check
 * @returns True if the value is a valid FilterOperator
 */
export function isValidFilterOperator(
  value: unknown,
): value is FilterOperator {
  const validOperators: FilterOperator[] = [
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
  return typeof value === "string" && validOperators.includes(value as FilterOperator);
}

/**
 * Check if a filter is a simple property-based filter.
 *
 * @param filter - The filter to check
 * @returns True if the filter is a simple property filter
 */
export function isSimpleFilter(filter: LayoutFilter): boolean {
  return Boolean(filter.property && filter.operator);
}

/**
 * Check if a filter is a SPARQL-based filter.
 *
 * @param filter - The filter to check
 * @returns True if the filter uses SPARQL
 */
export function isSparqlFilter(filter: LayoutFilter): boolean {
  return Boolean(filter.sparql);
}

import { Literal } from "../../../domain/models/rdf/Literal";
import { IRI } from "../../../domain/models/rdf/IRI";
import type { CustomAggregate, AggregateState, Term } from "./CustomAggregateRegistry";

const XSD_DECIMAL = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
const XSD_DOUBLE = new IRI("http://www.w3.org/2001/XMLSchema#double");

/**
 * Standard namespace for Exocortex custom aggregates.
 */
export const EXO_AGGREGATE_NS = "https://exocortex.my/ontology/agg#";

/**
 * Helper function to extract numeric value from an RDF term.
 *
 * @param term - The term to extract value from
 * @returns Numeric value or NaN if not numeric
 */
export function getNumericValue(term: Term): number {
  if (term === null || term === undefined) {
    return NaN;
  }

  if (typeof term === "number") {
    return term;
  }

  if (typeof term === "string") {
    return parseFloat(term);
  }

  if (term instanceof Literal) {
    return parseFloat(term.value);
  }

  if (term instanceof IRI) {
    return NaN;
  }

  if (typeof term === "boolean") {
    return term ? 1 : 0;
  }

  return NaN;
}

/**
 * Helper to create a decimal literal from a number.
 *
 * @param value - The numeric value
 * @returns A Literal with xsd:decimal datatype
 */
export function createDecimalLiteral(value: number): Literal {
  return new Literal(String(value), XSD_DECIMAL);
}

/**
 * Helper to create a double literal from a number.
 *
 * @param value - The numeric value
 * @returns A Literal with xsd:double datatype
 */
export function createDoubleLiteral(value: number): Literal {
  return new Literal(String(value), XSD_DOUBLE);
}

/**
 * State for median calculation.
 */
interface MedianState extends AggregateState {
  values: number[];
}

/**
 * Median aggregate function.
 *
 * Calculates the median (middle value) of a set of numeric values.
 * For an even number of values, returns the average of the two middle values.
 *
 * IRI: https://exocortex.my/ontology/agg#median
 *
 * Example SPARQL:
 * ```sparql
 * PREFIX agg: <https://exocortex.my/ontology/agg#>
 *
 * SELECT ?category (agg:median(?price) AS ?medianPrice)
 * WHERE {
 *   ?product :category ?category ;
 *            :price ?price .
 * }
 * GROUP BY ?category
 * ```
 */
export const medianAggregate: CustomAggregate = {
  init(): MedianState {
    return { values: [] };
  },

  step(state: AggregateState, value: Term): void {
    const medianState = state as MedianState;
    const num = getNumericValue(value);
    if (!isNaN(num)) {
      medianState.values.push(num);
    }
  },

  finalize(state: AggregateState): Literal {
    const medianState = state as MedianState;
    const { values } = medianState;

    if (values.length === 0) {
      return createDecimalLiteral(0);
    }

    // Sort values for median calculation
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    // For odd length: return middle value
    // For even length: return average of two middle values
    const median = sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

    return createDecimalLiteral(median);
  },
};

/**
 * State for variance calculation.
 */
interface VarianceState extends AggregateState {
  values: number[];
}

/**
 * Variance aggregate function.
 *
 * Calculates the population variance of a set of numeric values.
 * Formula: Σ(x - μ)² / N
 *
 * IRI: https://exocortex.my/ontology/agg#variance
 *
 * Example SPARQL:
 * ```sparql
 * PREFIX agg: <https://exocortex.my/ontology/agg#>
 *
 * SELECT ?group (agg:variance(?score) AS ?scoreVariance)
 * WHERE {
 *   ?item :group ?group ;
 *         :score ?score .
 * }
 * GROUP BY ?group
 * ```
 */
export const varianceAggregate: CustomAggregate = {
  init(): VarianceState {
    return { values: [] };
  },

  step(state: AggregateState, value: Term): void {
    const varState = state as VarianceState;
    const num = getNumericValue(value);
    if (!isNaN(num)) {
      varState.values.push(num);
    }
  },

  finalize(state: AggregateState): Literal {
    const varState = state as VarianceState;
    const { values } = varState;

    if (values.length === 0) {
      return createDecimalLiteral(0);
    }

    // Calculate mean
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    // Calculate variance: sum of squared differences from mean / count
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;

    return createDecimalLiteral(variance);
  },
};

/**
 * Standard deviation aggregate function.
 *
 * Calculates the population standard deviation of a set of numeric values.
 * Formula: √(Σ(x - μ)² / N)
 *
 * IRI: https://exocortex.my/ontology/agg#stddev
 *
 * Example SPARQL:
 * ```sparql
 * PREFIX agg: <https://exocortex.my/ontology/agg#>
 *
 * SELECT ?group (agg:stddev(?score) AS ?scoreStdDev)
 * WHERE {
 *   ?item :group ?group ;
 *         :score ?score .
 * }
 * GROUP BY ?group
 * ```
 */
export const stddevAggregate: CustomAggregate = {
  init(): VarianceState {
    return { values: [] };
  },

  step(state: AggregateState, value: Term): void {
    varianceAggregate.step(state, value);
  },

  finalize(state: AggregateState): Literal {
    const varState = state as VarianceState;
    const { values } = varState;

    if (values.length === 0) {
      return createDecimalLiteral(0);
    }

    // Calculate mean
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    // Calculate variance
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;

    // Standard deviation is square root of variance
    return createDecimalLiteral(Math.sqrt(variance));
  },
};

/**
 * State for mode calculation.
 */
interface ModeState extends AggregateState {
  counts: Map<string, number>;
  values: Map<string, Term>;
}

/**
 * Mode aggregate function.
 *
 * Returns the most frequently occurring value in a group.
 * If multiple values have the same highest frequency, returns one of them.
 *
 * IRI: https://exocortex.my/ontology/agg#mode
 *
 * Example SPARQL:
 * ```sparql
 * PREFIX agg: <https://exocortex.my/ontology/agg#>
 *
 * SELECT ?category (agg:mode(?status) AS ?mostCommonStatus)
 * WHERE {
 *   ?item :category ?category ;
 *         :status ?status .
 * }
 * GROUP BY ?category
 * ```
 */
export const modeAggregate: CustomAggregate = {
  init(): ModeState {
    return {
      counts: new Map(),
      values: new Map(),
    };
  },

  step(state: AggregateState, value: Term): void {
    if (value === null || value === undefined) {
      return;
    }

    const modeState = state as ModeState;
    const key = String(value instanceof Literal || value instanceof IRI ? value.value : value);

    const currentCount = modeState.counts.get(key) || 0;
    modeState.counts.set(key, currentCount + 1);
    modeState.values.set(key, value);
  },

  finalize(state: AggregateState): Literal {
    const modeState = state as ModeState;

    if (modeState.counts.size === 0) {
      // Return space for empty group (Literal cannot be empty)
      return new Literal(" ", new IRI("http://www.w3.org/2001/XMLSchema#string"));
    }

    // Find the key with highest count
    let maxKey = "";
    let maxCount = 0;

    for (const [key, count] of modeState.counts) {
      if (count > maxCount) {
        maxCount = count;
        maxKey = key;
      }
    }

    // Return the most frequent value
    const originalValue = modeState.values.get(maxKey);
    if (originalValue instanceof Literal) {
      return originalValue;
    }

    // For numeric mode, return as decimal
    const num = parseFloat(maxKey);
    if (!isNaN(num)) {
      return createDecimalLiteral(num);
    }

    return new Literal(maxKey, new IRI("http://www.w3.org/2001/XMLSchema#string"));
  },
};

/**
 * State for percentile calculation.
 */
interface PercentileState extends AggregateState {
  values: number[];
  percentile: number;
}

/**
 * Create a percentile aggregate for a specific percentile value.
 *
 * @param percentile - The percentile to calculate (0-100)
 * @returns A CustomAggregate for that percentile
 */
export function createPercentileAggregate(percentile: number): CustomAggregate {
  const p = Math.max(0, Math.min(100, percentile)) / 100;

  return {
    init(): PercentileState {
      return { values: [], percentile: p };
    },

    step(state: AggregateState, value: Term): void {
      const percState = state as PercentileState;
      const num = getNumericValue(value);
      if (!isNaN(num)) {
        percState.values.push(num);
      }
    },

    finalize(state: AggregateState): Literal {
      const percState = state as PercentileState;
      const { values } = percState;

      if (values.length === 0) {
        return createDecimalLiteral(0);
      }

      const sorted = [...values].sort((a, b) => a - b);
      const index = percState.percentile * (sorted.length - 1);
      const lower = Math.floor(index);
      const upper = Math.ceil(index);

      if (lower === upper) {
        return createDecimalLiteral(sorted[lower]);
      }

      // Linear interpolation between values
      const fraction = index - lower;
      const result = sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
      return createDecimalLiteral(result);
    },
  };
}

/**
 * Accumulator shared by the three two-column statistics.
 *
 * One pass, six running sums — no pair is retained, so memory is O(1) in the group
 * size (unlike `median`, which must keep every value). A pair is counted ONLY when
 * both columns are numeric: an unbound or non-numeric ?y must not silently shift the
 * ?x-only statistics, which is precisely how a partially-bound join would corrupt a
 * correlation without ever raising.
 */
interface BivariateState extends AggregateState {
  n: number;
  sx: number;
  sy: number;
  sxx: number;
  syy: number;
  sxy: number;
}

function bivariateInit(): BivariateState {
  return { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
}

function bivariateStep(state: AggregateState, value: Term, value2?: Term): void {
  const st = state as BivariateState;
  const x = getNumericValue(value);
  const y = getNumericValue(value2 as Term);
  if (isNaN(x) || isNaN(y)) return;
  st.n += 1;
  st.sx += x;
  st.sy += y;
  st.sxx += x * x;
  st.syy += y * y;
  st.sxy += x * y;
}

/**
 * Pearson correlation r = Σ(x-x̄)(y-ȳ) / √(Σ(x-x̄)² · Σ(y-ȳ)²), computed from the
 * running sums.
 *
 * ⛔ Returns `NaN`^^xsd:double rather than 0 when r is undefined — n < 2, or either
 * column is constant (zero variance ⇒ division by zero). `0` would read as "measured,
 * no correlation", which is a different and false claim: a constant column means the
 * question cannot be answered, not that the answer is zero.
 *
 * ⚠ This deliberately DIVERGES from the convention of the single-column aggregates in
 * this file, which return 0 on empty input (`medianAggregate`, `varianceAggregate`).
 * For a median 0 is merely arbitrary; for a correlation it is a specific, WRONG
 * finding a reader would act on. A truly unbound result is not expressible here —
 * `finalize` must return a Literal and an empty one throws ("Literal value cannot be
 * empty") — so `NaN` is the honest encoding available: standard for xsd:double, and
 * distinguishable from every real value of r.
 *
 * ⛤ Both guards below are DEFENSIVE, not load-bearing, and a test cannot tell them
 * apart from the arithmetic: at n < 2 the variance is 0, and when a column is constant
 * the covariance numerator is 0 as well (Σxy = c·Σy and Σx = n·c cancel exactly), so
 * the expression evaluates to 0/0 = NaN on its own. They are kept because relying on
 * IEEE-754 to produce NaN — rather than ±Infinity, which a differently-shaped numerator
 * WOULD yield — is a fragile contract to leave implicit. What the tests pin is the
 * observable decision (NaN rather than 0), not these two lines.
 */
export const corrAggregate: CustomAggregate = {
  arity: 2,
  init: bivariateInit,
  step: bivariateStep,
  finalize(state: AggregateState): Literal {
    const { n, sx, sy, sxx, syy, sxy } = state as BivariateState;
    if (n < 2) return new Literal("NaN", XSD_DOUBLE);
    const cov = n * sxy - sx * sy;
    const vx = n * sxx - sx * sx;
    const vy = n * syy - sy * sy;
    if (vx <= 0 || vy <= 0) return new Literal("NaN", XSD_DOUBLE);
    return new Literal(String(cov / Math.sqrt(vx * vy)), XSD_DECIMAL);
  },
};

/**
 * Least-squares slope b in y = a + b·x. Undefined (unbound) when n < 2 or ?x is
 * constant — a vertical line has no finite slope, and reporting 0 would invert the
 * meaning (0 = horizontal).
 */
export const slopeAggregate: CustomAggregate = {
  arity: 2,
  init: bivariateInit,
  step: bivariateStep,
  finalize(state: AggregateState): Literal {
    const { n, sx, sy, sxx, sxy } = state as BivariateState;
    if (n < 2) return new Literal("NaN", XSD_DOUBLE);
    const vx = n * sxx - sx * sx;
    if (vx <= 0) return new Literal("NaN", XSD_DOUBLE);
    return new Literal(String((n * sxy - sx * sy) / vx), XSD_DECIMAL);
  },
};

/**
 * Least-squares intercept a in y = a + b·x. Shares slope's guards, since a is
 * derived from b.
 */
export const interceptAggregate: CustomAggregate = {
  arity: 2,
  init: bivariateInit,
  step: bivariateStep,
  finalize(state: AggregateState): Literal {
    const { n, sx, sy, sxx, sxy } = state as BivariateState;
    if (n < 2) return new Literal("NaN", XSD_DOUBLE);
    const vx = n * sxx - sx * sx;
    if (vx <= 0) return new Literal("NaN", XSD_DOUBLE);
    const b = (n * sxy - sx * sy) / vx;
    return new Literal(String((sy - b * sx) / n), XSD_DECIMAL);
  },
};

/**
 * Map of built-in aggregate IRIs to their implementations.
 */
export const BUILT_IN_AGGREGATES: Record<string, CustomAggregate> = {
  [`${EXO_AGGREGATE_NS}median`]: medianAggregate,
  [`${EXO_AGGREGATE_NS}variance`]: varianceAggregate,
  [`${EXO_AGGREGATE_NS}stddev`]: stddevAggregate,
  [`${EXO_AGGREGATE_NS}mode`]: modeAggregate,
  [`${EXO_AGGREGATE_NS}percentile25`]: createPercentileAggregate(25),
  [`${EXO_AGGREGATE_NS}percentile50`]: createPercentileAggregate(50), // Same as median
  [`${EXO_AGGREGATE_NS}percentile75`]: createPercentileAggregate(75),
  [`${EXO_AGGREGATE_NS}percentile90`]: createPercentileAggregate(90),
  [`${EXO_AGGREGATE_NS}percentile95`]: createPercentileAggregate(95),
  [`${EXO_AGGREGATE_NS}percentile99`]: createPercentileAggregate(99),
  [`${EXO_AGGREGATE_NS}corr`]: corrAggregate,
  [`${EXO_AGGREGATE_NS}slope`]: slopeAggregate,
  [`${EXO_AGGREGATE_NS}intercept`]: interceptAggregate,
};

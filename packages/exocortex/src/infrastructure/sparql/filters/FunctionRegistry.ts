/**
 * Function Registry for SPARQL built-in functions.
 *
 * This module reduces cyclomatic complexity in FilterExecutor by organizing
 * SPARQL function handlers into a registry pattern.
 *
 * Each handler receives:
 * - args: Array of evaluated argument values
 * - rawArgs: Original expression arguments (for lazy evaluation)
 * - context: Evaluation context with helper methods
 *
 * @module FunctionRegistry
 */

import { BuiltInFunctions, type RDFTerm } from "./BuiltInFunctions";
import { Literal } from "../../../domain/models/rdf/Literal";
import type { SolutionMapping } from "../SolutionMapping";
import type { Expression } from "../algebra/AlgebraOperation";

// Helper type for casting - matches runtime types from BuiltInFunctions
type DurationArg = string | Literal;

/**
 * Context passed to function handlers for argument evaluation.
 */
export interface FunctionContext {
  /** Evaluate an expression and get the result */
  evaluateExpression: (expr: Expression, solution: SolutionMapping) => unknown;
  /** Get term from expression (for RDF term functions) */
  getTermFromExpression: (expr: Expression, solution: SolutionMapping) => unknown;
  /** Convert value to string */
  getStringValue: (value: unknown) => string;
  /** Current solution mapping */
  solution: SolutionMapping;
  /** Check if value is xsd:yearMonthDuration */
  isYearMonthDurationValue: (value: unknown) => boolean;
  /** Check if value is xsd:dayTimeDuration */
  isDayTimeDurationValue: (value: unknown) => boolean;
}

/**
 * Function handler type.
 * @param args - Raw expression arguments from the parser
 * @param ctx - Evaluation context with helper methods
 * @returns The function result
 */
export type FunctionHandler = (
  args: Expression[],
  ctx: FunctionContext
) => unknown;

/**
 * Registry of SPARQL function handlers.
 * Maps function names (lowercase) to their handler implementations.
 */
export const functionHandlers: Map<string, FunctionHandler> = new Map();

// =============================================================================
// String Functions
// =============================================================================

functionHandlers.set("str", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.str(term);
});

functionHandlers.set("lang", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.lang(term);
});

functionHandlers.set("langmatches", (args, ctx) => {
  const langTag = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const langRange = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.langMatches(langTag, langRange);
});

functionHandlers.set("contains", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const substr = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.contains(str, substr);
});

functionHandlers.set("strstarts", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const prefix = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.strStarts(str, prefix);
});

functionHandlers.set("strends", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const suffix = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.strEnds(str, suffix);
});

functionHandlers.set("strlen", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.strlen(str);
});

functionHandlers.set("ucase", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.ucase(str);
});

functionHandlers.set("lcase", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.lcase(str);
});

functionHandlers.set("substr", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const start = Number(ctx.evaluateExpression(args[1], ctx.solution));
  if (args[2]) {
    const length = Number(ctx.evaluateExpression(args[2], ctx.solution));
    return BuiltInFunctions.substr(str, start, length);
  }
  return BuiltInFunctions.substr(str, start);
});

functionHandlers.set("strbefore", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const sep = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.strBefore(str, sep);
});

functionHandlers.set("strafter", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const sep = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.strAfter(str, sep);
});

functionHandlers.set("concat", (args, ctx) => {
  const concatArgs = args.map((arg) =>
    ctx.getStringValue(ctx.evaluateExpression(arg, ctx.solution))
  );
  return BuiltInFunctions.concat(...concatArgs);
});

functionHandlers.set("replace", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const pattern = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  const replacement = ctx.getStringValue(ctx.evaluateExpression(args[2], ctx.solution));
  const flags = args[3]
    ? ctx.getStringValue(ctx.evaluateExpression(args[3], ctx.solution))
    : undefined;
  return BuiltInFunctions.replace(str, pattern, replacement, flags);
});

functionHandlers.set("regex", (args, ctx) => {
  const text = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const pattern = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  const flags = args[2]
    ? ctx.getStringValue(ctx.evaluateExpression(args[2], ctx.solution))
    : undefined;
  return BuiltInFunctions.regex(text, pattern, flags);
});

functionHandlers.set("encode_for_uri", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.encodeForUri(str);
});

// =============================================================================
// RDF Type Functions
// =============================================================================

functionHandlers.set("datatype", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.datatype(term).value;
});

functionHandlers.set("bound", (args, ctx) => {
  const arg = args[0] as Expression & { type: string; name?: string };
  if (arg.type === "variable" && arg.name) {
    const term = ctx.solution.get(arg.name) as RDFTerm | undefined;
    return BuiltInFunctions.bound(term);
  }
  return true;
});

// Register both isiri and isuri (aliases)
const isIriHandler: FunctionHandler = (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.isIRI(term);
};
functionHandlers.set("isiri", isIriHandler);
functionHandlers.set("isuri", isIriHandler);

functionHandlers.set("isblank", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.isBlank(term);
});

functionHandlers.set("isliteral", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.isLiteral(term);
});

functionHandlers.set("isnumeric", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.isNumeric(term);
});

functionHandlers.set("haslangdir", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.hasLangdir(term);
});

functionHandlers.set("istriple", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.isTriple(term);
});

functionHandlers.set("sameterm", (args, ctx) => {
  const term1 = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  const term2 = ctx.getTermFromExpression(args[1], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.sameTerm(term1, term2);
});

// =============================================================================
// Numeric Functions
// =============================================================================

functionHandlers.set("abs", (args, ctx) => {
  const num = Number(ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution)));
  return BuiltInFunctions.abs(num);
});

functionHandlers.set("round", (args, ctx) => {
  const num = Number(ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution)));
  return BuiltInFunctions.round(num);
});

functionHandlers.set("ceil", (args, ctx) => {
  const num = Number(ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution)));
  return BuiltInFunctions.ceil(num);
});

functionHandlers.set("floor", (args, ctx) => {
  const num = Number(ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution)));
  return BuiltInFunctions.floor(num);
});

functionHandlers.set("rand", () => {
  // SPARQL 1.1 RAND() function - uses pseudo-random for query logic (sampling, shuffling).
  // NOT for security purposes. See W3C spec: https://www.w3.org/TR/sparql11-query/#func-rand
  return BuiltInFunctions.rand();
});

// =============================================================================
// Date/Time Functions
// =============================================================================

functionHandlers.set("parsedate", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.parseDate(str);
});

functionHandlers.set("datebefore", (args, ctx) => {
  const date1 = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const date2 = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.dateBefore(date1, date2);
});

functionHandlers.set("dateafter", (args, ctx) => {
  const date1 = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const date2 = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.dateAfter(date1, date2);
});

functionHandlers.set("dateinrange", (args, ctx) => {
  const date = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const start = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  const end = ctx.getStringValue(ctx.evaluateExpression(args[2], ctx.solution));
  return BuiltInFunctions.dateInRange(date, start, end);
});

functionHandlers.set("datediffminutes", (args, ctx) => {
  const date1 = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const date2 = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.dateDiffMinutes(date1, date2);
});

functionHandlers.set("datediffhours", (args, ctx) => {
  const date1 = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  const date2 = ctx.getStringValue(ctx.evaluateExpression(args[1], ctx.solution));
  return BuiltInFunctions.dateDiffHours(date1, date2);
});

// Date/Time accessor functions with duration overloading
const createDateTimeAccessor = (
  dateTimeFn: (s: string) => number,
  yearMonthDurFn: ((v: DurationArg) => number) | null,
  dayTimeDurFn: ((v: DurationArg) => number) | null
): FunctionHandler => {
  return (args, ctx) => {
    const value = ctx.evaluateExpression(args[0], ctx.solution);
    if (yearMonthDurFn && ctx.isYearMonthDurationValue(value)) {
      return yearMonthDurFn(value as DurationArg);
    }
    if (dayTimeDurFn && ctx.isDayTimeDurationValue(value)) {
      return dayTimeDurFn(value as DurationArg);
    }
    return dateTimeFn(ctx.getStringValue(value));
  };
};

// year/years - can work on dateTime or yearMonthDuration
// Note: static methods use `this` to reference other static methods (e.g., parseDurationComponents),
// so they must be bound to the BuiltInFunctions class to preserve the correct `this` context.
const yearHandler = createDateTimeAccessor(
  BuiltInFunctions.year.bind(BuiltInFunctions),
  BuiltInFunctions.durationYears.bind(BuiltInFunctions),
  null
);
functionHandlers.set("year", yearHandler);
functionHandlers.set("years", yearHandler);

// month/months - can work on dateTime or yearMonthDuration
const monthHandler = createDateTimeAccessor(
  BuiltInFunctions.month.bind(BuiltInFunctions),
  BuiltInFunctions.durationMonths.bind(BuiltInFunctions),
  null
);
functionHandlers.set("month", monthHandler);
functionHandlers.set("months", monthHandler);

// day/days - can work on dateTime or dayTimeDuration
const dayHandler = createDateTimeAccessor(
  BuiltInFunctions.day.bind(BuiltInFunctions),
  null,
  BuiltInFunctions.durationDays.bind(BuiltInFunctions)
);
functionHandlers.set("day", dayHandler);
functionHandlers.set("days", dayHandler);

// hours - can work on dateTime or dayTimeDuration
functionHandlers.set("hours", createDateTimeAccessor(
  BuiltInFunctions.hours.bind(BuiltInFunctions),
  null,
  BuiltInFunctions.durationHours.bind(BuiltInFunctions)
));

// minutes - can work on dateTime or dayTimeDuration
functionHandlers.set("minutes", createDateTimeAccessor(
  BuiltInFunctions.minutes.bind(BuiltInFunctions),
  null,
  BuiltInFunctions.durationMinutes.bind(BuiltInFunctions)
));

// seconds - can work on dateTime or dayTimeDuration
functionHandlers.set("seconds", createDateTimeAccessor(
  BuiltInFunctions.seconds.bind(BuiltInFunctions),
  null,
  BuiltInFunctions.durationSeconds.bind(BuiltInFunctions)
));

functionHandlers.set("timezone", (args, ctx) => {
  const date = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.timezone(date);
});

functionHandlers.set("tz", (args, ctx) => {
  const date = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.tz(date);
});

functionHandlers.set("adjust", (args, ctx) => {
  const dateTime = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  const timezone = args.length > 1
    ? ctx.evaluateExpression(args[1], ctx.solution) as DurationArg | undefined
    : undefined;
  return BuiltInFunctions.adjust(dateTime, timezone);
});

functionHandlers.set("now", () => {
  return BuiltInFunctions.now();
});

// =============================================================================
// XSD Type Casting Functions
// =============================================================================

// datetime/xsd:datetime
const dateTimeHandler: FunctionHandler = (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution);
  return BuiltInFunctions.xsdDateTime(ctx.getStringValue(value));
};
functionHandlers.set("datetime", dateTimeHandler);
functionHandlers.set("xsd:datetime", dateTimeHandler);

// integer/xsd:integer
const integerHandler: FunctionHandler = (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution);
  return BuiltInFunctions.xsdInteger(ctx.getStringValue(value));
};
functionHandlers.set("integer", integerHandler);
functionHandlers.set("xsd:integer", integerHandler);

// decimal/xsd:decimal
const decimalHandler: FunctionHandler = (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution);
  return BuiltInFunctions.xsdDecimal(ctx.getStringValue(value));
};
functionHandlers.set("decimal", decimalHandler);
functionHandlers.set("xsd:decimal", decimalHandler);

// daytimeduration/xsd:daytimeduration
const dayTimeDurationHandler: FunctionHandler = (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution);
  return BuiltInFunctions.xsdDayTimeDuration(ctx.getStringValue(value));
};
functionHandlers.set("daytimeduration", dayTimeDurationHandler);
functionHandlers.set("xsd:daytimeduration", dayTimeDurationHandler);

// =============================================================================
// Duration Functions
// =============================================================================

functionHandlers.set("durationtodays", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationToDays(value);
});

functionHandlers.set("durationtohours", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationToHours(value);
});

functionHandlers.set("durationtominutes", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationToMinutes(value);
});

functionHandlers.set("durationtoseconds", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationToSeconds(value);
});

// Duration component accessors
functionHandlers.set("durationdays", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationDays(value);
});

functionHandlers.set("durationhours", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationHours(value);
});

functionHandlers.set("durationminutes", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationMinutes(value);
});

functionHandlers.set("durationseconds", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationSeconds(value);
});

functionHandlers.set("durationyears", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationYears(value);
});

functionHandlers.set("durationmonths", (args, ctx) => {
  const value = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  return BuiltInFunctions.durationMonths(value);
});

functionHandlers.set("datetimediff", (args, ctx) => {
  const dt1 = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  const dt2 = ctx.evaluateExpression(args[1], ctx.solution) as DurationArg;
  return BuiltInFunctions.dateTimeDiff(dt1, dt2);
});

functionHandlers.set("datetimeadd", (args, ctx) => {
  const dt = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  const dur = ctx.evaluateExpression(args[1], ctx.solution) as DurationArg;
  return BuiltInFunctions.dateTimeAdd(dt, dur);
});

functionHandlers.set("datetimesubtract", (args, ctx) => {
  const dt = ctx.evaluateExpression(args[0], ctx.solution) as DurationArg;
  const dur = ctx.evaluateExpression(args[1], ctx.solution) as DurationArg;
  return BuiltInFunctions.dateTimeSubtract(dt, dur);
});

functionHandlers.set("mstominutes", (args, ctx) => {
  const ms = Number(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.msToMinutes(ms);
});

functionHandlers.set("mstohours", (args, ctx) => {
  const ms = Number(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.msToHours(ms);
});

functionHandlers.set("mstoseconds", (args, ctx) => {
  const ms = Number(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.msToSeconds(ms);
});

// =============================================================================
// Hash Functions
// =============================================================================

functionHandlers.set("md5", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.md5(str);
});

functionHandlers.set("sha1", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.sha1(str);
});

functionHandlers.set("sha256", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.sha256(str);
});

functionHandlers.set("sha384", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.sha384(str);
});

functionHandlers.set("sha512", (args, ctx) => {
  const str = ctx.getStringValue(ctx.evaluateExpression(args[0], ctx.solution));
  return BuiltInFunctions.sha512(str);
});

// =============================================================================
// RDF-Star Functions
// =============================================================================

functionHandlers.set("subject", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.subject(term);
});

functionHandlers.set("predicate", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.predicate(term);
});

functionHandlers.set("object", (args, ctx) => {
  const term = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.object(term);
});

functionHandlers.set("triple", (args, ctx) => {
  const subject = ctx.getTermFromExpression(args[0], ctx.solution) as RDFTerm | undefined;
  const predicate = ctx.getTermFromExpression(args[1], ctx.solution) as RDFTerm | undefined;
  const object = ctx.getTermFromExpression(args[2], ctx.solution) as RDFTerm | undefined;
  return BuiltInFunctions.triple(subject, predicate, object);
});

// =============================================================================
// Conditional Functions (special handling required)
// Note: COALESCE and IF require lazy evaluation and are handled directly
// in FilterExecutor.evaluateFunction() rather than through this registry.
// =============================================================================

// COALESCE and IF are NOT in this registry because they need lazy evaluation
// (evaluating arguments only when needed). They remain in FilterExecutor.

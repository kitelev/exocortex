/**
 * XSD datatype parsing and formatting utilities.
 *
 * This module provides utilities for working with XSD datatypes
 * commonly used in SPARQL queries.
 */

export type { DayTimeDuration } from "./DurationTypes";
export {
  parseXSDDayTimeDuration,
  formatDayTimeDuration,
  durationToMilliseconds,
  millisecondsToStructuredDuration,
  formatStructuredDuration,
} from "./DurationTypes";

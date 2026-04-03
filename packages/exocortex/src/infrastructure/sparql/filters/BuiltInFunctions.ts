import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";
import { StringFunctions } from "./functions/StringFunctions";
import { MathFunctions } from "./functions/MathFunctions";
import { DateTimeFunctions } from "./functions/DateTimeFunctions";
import { LogicalFunctions } from "./functions/LogicalFunctions";
import { RDFTermFunctions } from "./functions/RDFTermFunctions";
import { HashFunctions } from "./functions/HashFunctions";

export type RDFTerm = Subject | Predicate | RDFObject;

export class BuiltInFunctions {
  static str(...args: Parameters<typeof StringFunctions.str>) { return StringFunctions.str(...args); }
  static lang(...args: Parameters<typeof StringFunctions.lang>) { return StringFunctions.lang(...args); }
  static langdir(...args: Parameters<typeof StringFunctions.langdir>) { return StringFunctions.langdir(...args); }
  static langMatches(...args: Parameters<typeof StringFunctions.langMatches>) { return StringFunctions.langMatches(...args); }
  static regex(...args: Parameters<typeof StringFunctions.regex>) { return StringFunctions.regex(...args); }
  static contains(...args: Parameters<typeof StringFunctions.contains>) { return StringFunctions.contains(...args); }
  static strStarts(...args: Parameters<typeof StringFunctions.strStarts>) { return StringFunctions.strStarts(...args); }
  static strEnds(...args: Parameters<typeof StringFunctions.strEnds>) { return StringFunctions.strEnds(...args); }
  static strlen(...args: Parameters<typeof StringFunctions.strlen>) { return StringFunctions.strlen(...args); }
  static ucase(...args: Parameters<typeof StringFunctions.ucase>) { return StringFunctions.ucase(...args); }
  static lcase(...args: Parameters<typeof StringFunctions.lcase>) { return StringFunctions.lcase(...args); }
  static substr(...args: Parameters<typeof StringFunctions.substr>) { return StringFunctions.substr(...args); }
  static strBefore(...args: Parameters<typeof StringFunctions.strBefore>) { return StringFunctions.strBefore(...args); }
  static strAfter(...args: Parameters<typeof StringFunctions.strAfter>) { return StringFunctions.strAfter(...args); }
  static concat(...args: Parameters<typeof StringFunctions.concat>) { return StringFunctions.concat(...args); }
  static replace(...args: Parameters<typeof StringFunctions.replace>) { return StringFunctions.replace(...args); }
  static encodeForUri(...args: Parameters<typeof StringFunctions.encodeForUri>) { return StringFunctions.encodeForUri(...args); }
  static normalize(...args: Parameters<typeof StringFunctions.normalize>) { return StringFunctions.normalize(...args); }
  static fold(...args: Parameters<typeof StringFunctions.fold>) { return StringFunctions.fold(...args); }

  static abs(...args: Parameters<typeof MathFunctions.abs>) { return MathFunctions.abs(...args); }
  static round(...args: Parameters<typeof MathFunctions.round>) { return MathFunctions.round(...args); }
  static ceil(...args: Parameters<typeof MathFunctions.ceil>) { return MathFunctions.ceil(...args); }
  static floor(...args: Parameters<typeof MathFunctions.floor>) { return MathFunctions.floor(...args); }
  static rand() { return MathFunctions.rand(); }
  static msToMinutes(...args: Parameters<typeof MathFunctions.msToMinutes>) { return MathFunctions.msToMinutes(...args); }
  static msToHours(...args: Parameters<typeof MathFunctions.msToHours>) { return MathFunctions.msToHours(...args); }
  static msToSeconds(...args: Parameters<typeof MathFunctions.msToSeconds>) { return MathFunctions.msToSeconds(...args); }

  static parseDate(...args: Parameters<typeof DateTimeFunctions.parseDate>) { return DateTimeFunctions.parseDate(...args); }
  static dateBefore(...args: Parameters<typeof DateTimeFunctions.dateBefore>) { return DateTimeFunctions.dateBefore(...args); }
  static dateAfter(...args: Parameters<typeof DateTimeFunctions.dateAfter>) { return DateTimeFunctions.dateAfter(...args); }
  static dateInRange(...args: Parameters<typeof DateTimeFunctions.dateInRange>) { return DateTimeFunctions.dateInRange(...args); }
  static dateDiffMinutes(...args: Parameters<typeof DateTimeFunctions.dateDiffMinutes>) { return DateTimeFunctions.dateDiffMinutes(...args); }
  static dateDiffHours(...args: Parameters<typeof DateTimeFunctions.dateDiffHours>) { return DateTimeFunctions.dateDiffHours(...args); }
  static year(...args: Parameters<typeof DateTimeFunctions.year>) { return DateTimeFunctions.year(...args); }
  static month(...args: Parameters<typeof DateTimeFunctions.month>) { return DateTimeFunctions.month(...args); }
  static day(...args: Parameters<typeof DateTimeFunctions.day>) { return DateTimeFunctions.day(...args); }
  static hours(...args: Parameters<typeof DateTimeFunctions.hours>) { return DateTimeFunctions.hours(...args); }
  static minutes(...args: Parameters<typeof DateTimeFunctions.minutes>) { return DateTimeFunctions.minutes(...args); }
  static seconds(...args: Parameters<typeof DateTimeFunctions.seconds>) { return DateTimeFunctions.seconds(...args); }
  static timezone(...args: Parameters<typeof DateTimeFunctions.timezone>) { return DateTimeFunctions.timezone(...args); }
  static tz(...args: Parameters<typeof DateTimeFunctions.tz>) { return DateTimeFunctions.tz(...args); }
  static now() { return DateTimeFunctions.now(); }
  static parseDayTimeDuration(...args: Parameters<typeof DateTimeFunctions.parseDayTimeDuration>) { return DateTimeFunctions.parseDayTimeDuration(...args); }
  static formatDayTimeDuration(...args: Parameters<typeof DateTimeFunctions.formatDayTimeDuration>) { return DateTimeFunctions.formatDayTimeDuration(...args); }
  static xsdDayTimeDuration(...args: Parameters<typeof DateTimeFunctions.xsdDayTimeDuration>) { return DateTimeFunctions.xsdDayTimeDuration(...args); }
  static compareDurations(...args: Parameters<typeof DateTimeFunctions.compareDurations>) { return DateTimeFunctions.compareDurations(...args); }
  static isDayTimeDuration(...args: Parameters<typeof DateTimeFunctions.isDayTimeDuration>) { return DateTimeFunctions.isDayTimeDuration(...args); }
  static isDate(...args: Parameters<typeof DateTimeFunctions.isDate>) { return DateTimeFunctions.isDate(...args); }
  static dateDiff(...args: Parameters<typeof DateTimeFunctions.dateDiff>) { return DateTimeFunctions.dateDiff(...args); }
  static dateTimeDiff(...args: Parameters<typeof DateTimeFunctions.dateTimeDiff>) { return DateTimeFunctions.dateTimeDiff(...args); }
  static dateTimeAdd(...args: Parameters<typeof DateTimeFunctions.dateTimeAdd>) { return DateTimeFunctions.dateTimeAdd(...args); }
  static dateTimeSubtract(...args: Parameters<typeof DateTimeFunctions.dateTimeSubtract>) { return DateTimeFunctions.dateTimeSubtract(...args); }
  static dateAdd(...args: Parameters<typeof DateTimeFunctions.dateAdd>) { return DateTimeFunctions.dateAdd(...args); }
  static dateSubtract(...args: Parameters<typeof DateTimeFunctions.dateSubtract>) { return DateTimeFunctions.dateSubtract(...args); }
  static parseYearMonthDuration(...args: Parameters<typeof DateTimeFunctions.parseYearMonthDuration>) { return DateTimeFunctions.parseYearMonthDuration(...args); }
  static isYearMonthDuration(...args: Parameters<typeof DateTimeFunctions.isYearMonthDuration>) { return DateTimeFunctions.isYearMonthDuration(...args); }
  static dateTimeAddYearMonth(...args: Parameters<typeof DateTimeFunctions.dateTimeAddYearMonth>) { return DateTimeFunctions.dateTimeAddYearMonth(...args); }
  static dateTimeSubtractYearMonth(...args: Parameters<typeof DateTimeFunctions.dateTimeSubtractYearMonth>) { return DateTimeFunctions.dateTimeSubtractYearMonth(...args); }
  static dateAddYearMonth(...args: Parameters<typeof DateTimeFunctions.dateAddYearMonth>) { return DateTimeFunctions.dateAddYearMonth(...args); }
  static dateSubtractYearMonth(...args: Parameters<typeof DateTimeFunctions.dateSubtractYearMonth>) { return DateTimeFunctions.dateSubtractYearMonth(...args); }
  static durationAdd(...args: Parameters<typeof DateTimeFunctions.durationAdd>) { return DateTimeFunctions.durationAdd(...args); }
  static durationSubtract(...args: Parameters<typeof DateTimeFunctions.durationSubtract>) { return DateTimeFunctions.durationSubtract(...args); }
  static durationMultiply(...args: Parameters<typeof DateTimeFunctions.durationMultiply>) { return DateTimeFunctions.durationMultiply(...args); }
  static durationDivide(...args: Parameters<typeof DateTimeFunctions.durationDivide>) { return DateTimeFunctions.durationDivide(...args); }
  static formatYearMonthDuration(...args: Parameters<typeof DateTimeFunctions.formatYearMonthDuration>) { return DateTimeFunctions.formatYearMonthDuration(...args); }
  static yearMonthDurationAdd(...args: Parameters<typeof DateTimeFunctions.yearMonthDurationAdd>) { return DateTimeFunctions.yearMonthDurationAdd(...args); }
  static yearMonthDurationSubtract(...args: Parameters<typeof DateTimeFunctions.yearMonthDurationSubtract>) { return DateTimeFunctions.yearMonthDurationSubtract(...args); }
  static durationYears(...args: Parameters<typeof DateTimeFunctions.durationYears>) { return DateTimeFunctions.durationYears(...args); }
  static durationMonths(...args: Parameters<typeof DateTimeFunctions.durationMonths>) { return DateTimeFunctions.durationMonths(...args); }
  static durationToDays(...args: Parameters<typeof DateTimeFunctions.durationToDays>) { return DateTimeFunctions.durationToDays(...args); }
  static durationToHours(...args: Parameters<typeof DateTimeFunctions.durationToHours>) { return DateTimeFunctions.durationToHours(...args); }
  static durationToMinutes(...args: Parameters<typeof DateTimeFunctions.durationToMinutes>) { return DateTimeFunctions.durationToMinutes(...args); }
  static durationToSeconds(...args: Parameters<typeof DateTimeFunctions.durationToSeconds>) { return DateTimeFunctions.durationToSeconds(...args); }
  static durationDays(...args: Parameters<typeof DateTimeFunctions.durationDays>) { return DateTimeFunctions.durationDays(...args); }
  static durationHours(...args: Parameters<typeof DateTimeFunctions.durationHours>) { return DateTimeFunctions.durationHours(...args); }
  static durationMinutes(...args: Parameters<typeof DateTimeFunctions.durationMinutes>) { return DateTimeFunctions.durationMinutes(...args); }
  static durationSeconds(...args: Parameters<typeof DateTimeFunctions.durationSeconds>) { return DateTimeFunctions.durationSeconds(...args); }
  static adjust(...args: Parameters<typeof DateTimeFunctions.adjust>) { return DateTimeFunctions.adjust(...args); }
  static isTime(...args: Parameters<typeof DateTimeFunctions.isTime>) { return DateTimeFunctions.isTime(...args); }
  static timeDiff(...args: Parameters<typeof DateTimeFunctions.timeDiff>) { return DateTimeFunctions.timeDiff(...args); }

  static compare(...args: Parameters<typeof LogicalFunctions.compare>) { return LogicalFunctions.compare(...args); }
  static logicalAnd(...args: Parameters<typeof LogicalFunctions.logicalAnd>) { return LogicalFunctions.logicalAnd(...args); }
  static logicalOr(...args: Parameters<typeof LogicalFunctions.logicalOr>) { return LogicalFunctions.logicalOr(...args); }
  static logicalNot(...args: Parameters<typeof LogicalFunctions.logicalNot>) { return LogicalFunctions.logicalNot(...args); }
  static coalesce<T>(...args: Parameters<typeof LogicalFunctions.coalesce<T>>) { return LogicalFunctions.coalesce<T>(...args); }
  static if<T>(...args: Parameters<typeof LogicalFunctions.if<T>>) { return LogicalFunctions.if<T>(...args); }

  static datatype(...args: Parameters<typeof RDFTermFunctions.datatype>) { return RDFTermFunctions.datatype(...args); }
  static bound(...args: Parameters<typeof RDFTermFunctions.bound>) { return RDFTermFunctions.bound(...args); }
  static isIRI(...args: Parameters<typeof RDFTermFunctions.isIRI>) { return RDFTermFunctions.isIRI(...args); }
  static isBlank(...args: Parameters<typeof RDFTermFunctions.isBlank>) { return RDFTermFunctions.isBlank(...args); }
  static isLiteral(...args: Parameters<typeof RDFTermFunctions.isLiteral>) { return RDFTermFunctions.isLiteral(...args); }
  static isTriple(...args: Parameters<typeof RDFTermFunctions.isTriple>) { return RDFTermFunctions.isTriple(...args); }
  static isNumeric(...args: Parameters<typeof RDFTermFunctions.isNumeric>) { return RDFTermFunctions.isNumeric(...args); }
  static hasLangdir(...args: Parameters<typeof RDFTermFunctions.hasLangdir>) { return RDFTermFunctions.hasLangdir(...args); }
  static sameTerm(...args: Parameters<typeof RDFTermFunctions.sameTerm>) { return RDFTermFunctions.sameTerm(...args); }
  static iri(...args: Parameters<typeof RDFTermFunctions.iri>) { return RDFTermFunctions.iri(...args); }
  static uri(...args: Parameters<typeof RDFTermFunctions.uri>) { return RDFTermFunctions.uri(...args); }
  static bnode(...args: Parameters<typeof RDFTermFunctions.bnode>) { return RDFTermFunctions.bnode(...args); }
  static strdt(...args: Parameters<typeof RDFTermFunctions.strdt>) { return RDFTermFunctions.strdt(...args); }
  static strlang(...args: Parameters<typeof RDFTermFunctions.strlang>) { return RDFTermFunctions.strlang(...args); }
  static strlangdir(...args: Parameters<typeof RDFTermFunctions.strlangdir>) { return RDFTermFunctions.strlangdir(...args); }
  static uuid() { return RDFTermFunctions.uuid(); }
  static struuid() { return RDFTermFunctions.struuid(); }
  static xsdDateTime(...args: Parameters<typeof RDFTermFunctions.xsdDateTime>) { return RDFTermFunctions.xsdDateTime(...args); }
  static xsdInteger(...args: Parameters<typeof RDFTermFunctions.xsdInteger>) { return RDFTermFunctions.xsdInteger(...args); }
  static xsdDecimal(...args: Parameters<typeof RDFTermFunctions.xsdDecimal>) { return RDFTermFunctions.xsdDecimal(...args); }
  static triple(...args: Parameters<typeof RDFTermFunctions.triple>) { return RDFTermFunctions.triple(...args); }
  static subject(...args: Parameters<typeof RDFTermFunctions.subject>) { return RDFTermFunctions.subject(...args); }
  static predicate(...args: Parameters<typeof RDFTermFunctions.predicate>) { return RDFTermFunctions.predicate(...args); }
  static object(...args: Parameters<typeof RDFTermFunctions.object>) { return RDFTermFunctions.object(...args); }

  static md5(...args: Parameters<typeof HashFunctions.md5>) { return HashFunctions.md5(...args); }
  static sha1(...args: Parameters<typeof HashFunctions.sha1>) { return HashFunctions.sha1(...args); }
  static sha256(...args: Parameters<typeof HashFunctions.sha256>) { return HashFunctions.sha256(...args); }
  static sha384(...args: Parameters<typeof HashFunctions.sha384>) { return HashFunctions.sha384(...args); }
  static sha512(...args: Parameters<typeof HashFunctions.sha512>) { return HashFunctions.sha512(...args); }
}

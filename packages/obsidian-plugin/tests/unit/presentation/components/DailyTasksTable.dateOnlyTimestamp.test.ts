/**
 * Tests for date-only timestamp handling in DailyTasksTable helpers.
 *
 * Issue #2766 item 6: Daily Note Tasks table renders date-only timestamps
 * (like `"2025-11-10"`) as a wall-clock hour by feeding them to `new Date()`,
 * which parses them as UTC midnight. In any non-UTC timezone the result is
 * the local timezone offset (e.g. `"05:00"` in `Asia/Almaty` / UTC+5).
 *
 * The fix introduces `isDateOnlyTimestamp` and teaches `formatTimeDisplay`
 * to suppress the time portion when the underlying value has no time.
 */

import {
  isDateOnlyTimestamp,
  formatTimeDisplay,
} from '@plugin/presentation/components/DailyTasksTable';

describe('Issue #2766 item 6: date-only timestamp handling', () => {
  describe('isDateOnlyTimestamp', () => {
    it.each([
      '2025-11-10',
      '2025-01-01',
      '1999-12-31',
      '2099-06-15',
    ])('returns true for ISO date-only string %s', (value) => {
      expect(isDateOnlyTimestamp(value)).toBe(true);
    });

    it.each([
      '2025-11-10T00:00:00',
      '2025-11-10T05:30:00+05:00',
      '2025-11-10 12:00',
      '2025/11/10',
      'Mon Nov 10 2025',
      '',
    ])('returns false for non-date-only string %s', (value) => {
      expect(isDateOnlyTimestamp(value)).toBe(false);
    });

    it.each([null, undefined, 0, 1731196800000, true, {}, []])(
      'returns false for non-string value %p',
      (value) => {
        expect(isDateOnlyTimestamp(value)).toBe(false);
      },
    );

    it('rejects partial / malformed date strings', () => {
      expect(isDateOnlyTimestamp('2025-11')).toBe(false);
      expect(isDateOnlyTimestamp('2025-1-10')).toBe(false);
      expect(isDateOnlyTimestamp('25-11-10')).toBe(false);
      expect(isDateOnlyTimestamp('2025-11-10extra')).toBe(false);
    });
  });

  describe('formatTimeDisplay with date-only timestamps', () => {
    it('returns the fallback (not a locale-shifted time) when showFullDateInEffortTimes=false', () => {
      // The fallback is empty (the upstream renderer should set startTime=""
      // for date-only values), so the cell renders "-" instead of leaking
      // a UTC→local hour.
      expect(formatTimeDisplay('2025-11-10', '', false)).toBe('-');
    });

    it('uses string slicing (not Date arithmetic) when showFullDateInEffortTimes=true', () => {
      // String slicing is timezone-independent — "2025-11-10" → "11-10".
      // Crucially: NO trailing " 05:00" (or any other locale-derived hour).
      expect(formatTimeDisplay('2025-11-10', '', true)).toBe('11-10');
      expect(formatTimeDisplay('2025-01-01', '', true)).toBe('01-01');
    });

    it('does NOT leak local hours for date-only timestamps in any showFullDateInEffortTimes mode', () => {
      // Regression guard for #2766 #6.
      expect(formatTimeDisplay('2025-11-10', '', true)).not.toMatch(/\d{2}:\d{2}/);
      expect(formatTimeDisplay('2025-11-10', '', false)).not.toMatch(/\d{2}:\d{2}/);
    });
  });

  describe('formatTimeDisplay with timestamps that DO have a time component', () => {
    it('still renders ISO datetime hours when showFullDateInEffortTimes=true', () => {
      // ISO without timezone parses as local — keep existing behaviour.
      const result = formatTimeDisplay('2025-11-10T14:30:00', '14:30', true);
      // We don't assert exact output (depends on local TZ in CI), only that
      // some "MM-DD HH:MM" pattern survives — i.e. real timestamps are NOT
      // accidentally suppressed by the new date-only branch.
      expect(result).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('falls back to fallbackFormatted when showFullDateInEffortTimes=false', () => {
      expect(formatTimeDisplay('2025-11-10T14:30:00', '14:30', false)).toBe('14:30');
    });

    it('returns "-" for null timestamps with empty fallback', () => {
      expect(formatTimeDisplay(null, '', false)).toBe('-');
      expect(formatTimeDisplay(undefined, '', false)).toBe('-');
    });

    it('returns fallback for invalid timestamp strings', () => {
      expect(formatTimeDisplay('not-a-date', 'fallback', false)).toBe('fallback');
    });
  });
});

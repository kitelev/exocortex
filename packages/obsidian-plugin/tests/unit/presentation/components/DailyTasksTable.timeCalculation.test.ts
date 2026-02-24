/**
 * Tests for dynamic time calculation feature in DailyTasksTable
 * Issue #2236: Dynamic time calculation for Time column in DailyNote Tasks table
 *
 * This feature calculates duration from timestamps when explicit timeEstimateMinutes is missing.
 * Priority order:
 * 1. Use explicit ems__Effort_timeEstimateMinutes if present
 * 2. Calculate from actual timestamps (startTimestamp → endTimestamp)
 * 3. Calculate from planned timestamps (plannedStartTimestamp → plannedEndTimestamp)
 * 4. Return null if no valid data
 */

import { calculateTimeFromTimestamps } from '@plugin/presentation/components/DailyTasksTable';

describe('Issue #2236: calculateTimeFromTimestamps', () => {
  describe('priority 1: actual timestamps (fact > plan)', () => {
    it('should calculate duration from actual start/end timestamps', () => {
      const metadata = {
        ems__Effort_startTimestamp: '2025-10-20T09:00:00',
        ems__Effort_endTimestamp: '2025-10-20T10:30:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBe(90); // 1h 30m = 90 minutes
    });

    it('should handle numeric timestamps (ms since epoch)', () => {
      const start = new Date('2025-10-20T09:00:00').getTime();
      const end = new Date('2025-10-20T11:00:00').getTime();
      const metadata = {
        ems__Effort_startTimestamp: start,
        ems__Effort_endTimestamp: end,
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBe(120); // 2h = 120 minutes
    });

    it('should prefer actual timestamps over planned timestamps', () => {
      const metadata = {
        // Actual: 1 hour
        ems__Effort_startTimestamp: '2025-10-20T09:00:00',
        ems__Effort_endTimestamp: '2025-10-20T10:00:00',
        // Planned: 3 hours (should be ignored)
        ems__Effort_plannedStartTimestamp: '2025-10-20T09:00:00',
        ems__Effort_plannedEndTimestamp: '2025-10-20T12:00:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBe(60); // 1h = 60 minutes (from actual, not planned)
    });
  });

  describe('priority 2: planned timestamps', () => {
    it('should calculate duration from planned timestamps when actual are missing', () => {
      const metadata = {
        ems__Effort_plannedStartTimestamp: '2025-10-20T09:00:00',
        ems__Effort_plannedEndTimestamp: '2025-10-20T10:30:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBe(90); // 1h 30m = 90 minutes
    });

    it('should use planned timestamps when only startTimestamp (no endTimestamp) is present', () => {
      const metadata = {
        ems__Effort_startTimestamp: '2025-10-20T09:00:00',
        // No endTimestamp - actual timestamps incomplete
        ems__Effort_plannedStartTimestamp: '2025-10-20T09:00:00',
        ems__Effort_plannedEndTimestamp: '2025-10-20T11:00:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBe(120); // 2h from planned
    });
  });

  describe('edge cases', () => {
    it('should return null when no timestamps are present', () => {
      const metadata = {};

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBeNull();
    });

    it('should return null when only start timestamp is present', () => {
      const metadata = {
        ems__Effort_startTimestamp: '2025-10-20T09:00:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBeNull();
    });

    it('should return null when only end timestamp is present', () => {
      const metadata = {
        ems__Effort_endTimestamp: '2025-10-20T10:30:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBeNull();
    });

    it('should return null when end is before start (actual)', () => {
      const metadata = {
        ems__Effort_startTimestamp: '2025-10-20T10:00:00',
        ems__Effort_endTimestamp: '2025-10-20T09:00:00', // End before start
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBeNull();
    });

    it('should return null when end is before start (planned)', () => {
      const metadata = {
        ems__Effort_plannedStartTimestamp: '2025-10-20T10:00:00',
        ems__Effort_plannedEndTimestamp: '2025-10-20T09:00:00', // End before start
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBeNull();
    });

    it('should return null when timestamps are invalid strings', () => {
      const metadata = {
        ems__Effort_startTimestamp: 'invalid-date',
        ems__Effort_endTimestamp: 'also-invalid',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBeNull();
    });

    it('should handle zero-duration (start equals end)', () => {
      const metadata = {
        ems__Effort_startTimestamp: '2025-10-20T09:00:00',
        ems__Effort_endTimestamp: '2025-10-20T09:00:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      // Zero duration is technically valid but not useful for display
      // Implementation should return null or 0 - let's accept 0
      expect(result).toBe(0);
    });

    it('should round to nearest minute', () => {
      // 45 minutes and 30 seconds
      const start = new Date('2025-10-20T09:00:00').getTime();
      const end = start + (45 * 60 + 30) * 1000; // 45.5 minutes
      const metadata = {
        ems__Effort_startTimestamp: start,
        ems__Effort_endTimestamp: end,
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBe(46); // Rounded up from 45.5
    });
  });

  describe('fallback behavior when actual timestamps incomplete', () => {
    it('should fall back to planned when actual endTimestamp is missing', () => {
      const metadata = {
        ems__Effort_startTimestamp: '2025-10-20T09:00:00',
        // No endTimestamp
        ems__Effort_plannedStartTimestamp: '2025-10-20T08:00:00',
        ems__Effort_plannedEndTimestamp: '2025-10-20T09:30:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBe(90); // 1h 30m from planned
    });

    it('should fall back to planned when actual startTimestamp is missing', () => {
      const metadata = {
        ems__Effort_endTimestamp: '2025-10-20T10:30:00',
        // No startTimestamp
        ems__Effort_plannedStartTimestamp: '2025-10-20T09:00:00',
        ems__Effort_plannedEndTimestamp: '2025-10-20T11:00:00',
      };

      const result = calculateTimeFromTimestamps(metadata);

      expect(result).toBe(120); // 2h from planned
    });
  });
});

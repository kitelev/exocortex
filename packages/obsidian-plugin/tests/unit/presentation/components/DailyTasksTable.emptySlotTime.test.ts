/**
 * Tests for Empty Slot time display in DailyTasksTable
 * Issue #2238: Empty Slots не отображают динамическое время в колонке Time
 *
 * Empty Slots should display time using the same calculation logic as regular Tasks:
 * 1. If startTimestamp and endTimestamp present → show difference
 * 2. If plannedStartTimestamp and plannedEndTimestamp present → show difference
 * 3. Otherwise → empty
 */

import { calculateTimeFromTimestamps } from '@plugin/presentation/components/DailyTasksTable';

describe('Issue #2238: Empty Slot time calculation', () => {
  /**
   * Empty Slots are created by createEmptySlot() with:
   * - startTimestamp: number (ms)
   * - endTimestamp: number (ms)
   * - metadata: should contain timestamp fields for calculateTimeFromTimestamps to work
   */

  describe('Empty Slot with timestamps in metadata', () => {
    it('should calculate time from actual timestamps', () => {
      // Simulate Empty Slot metadata with timestamps
      const start = new Date('2025-10-20T09:00:00').getTime();
      const end = new Date('2025-10-20T10:30:00').getTime();

      const emptySlotMetadata = {
        ems__Effort_startTimestamp: start,
        ems__Effort_endTimestamp: end,
      };

      const result = calculateTimeFromTimestamps(emptySlotMetadata);

      expect(result).toBe(90); // 1h 30m = 90 minutes
    });

    it('should calculate time from planned timestamps for Empty Slot', () => {
      // Empty Slots might have planned timestamps
      const start = new Date('2025-10-20T14:00:00').getTime();
      const end = new Date('2025-10-20T15:00:00').getTime();

      const emptySlotMetadata = {
        ems__Effort_plannedStartTimestamp: start,
        ems__Effort_plannedEndTimestamp: end,
      };

      const result = calculateTimeFromTimestamps(emptySlotMetadata);

      expect(result).toBe(60); // 1h = 60 minutes
    });

    it('should return null for Empty Slot without timestamps in metadata', () => {
      // Current bug: Empty Slots created with empty metadata {}
      const emptySlotMetadata = {};

      const result = calculateTimeFromTimestamps(emptySlotMetadata);

      expect(result).toBeNull();
    });
  });

  describe('Empty Slot rendering expectations', () => {
    /**
     * These tests document the expected behavior after the fix:
     * Empty Slots should use calculateTimeFromTimestamps just like regular Tasks
     */

    it('should render time for 30-minute gap', () => {
      const start = new Date('2025-10-20T10:00:00').getTime();
      const end = new Date('2025-10-20T10:30:00').getTime();

      const metadata = {
        ems__Effort_startTimestamp: start,
        ems__Effort_endTimestamp: end,
      };

      const duration = calculateTimeFromTimestamps(metadata);

      // formatTimeEstimate would format this as "30m"
      expect(duration).toBe(30);
    });

    it('should render time for 2-hour gap', () => {
      const start = new Date('2025-10-20T12:00:00').getTime();
      const end = new Date('2025-10-20T14:00:00').getTime();

      const metadata = {
        ems__Effort_startTimestamp: start,
        ems__Effort_endTimestamp: end,
      };

      const duration = calculateTimeFromTimestamps(metadata);

      // formatTimeEstimate would format this as "2h"
      expect(duration).toBe(120);
    });

    it('should handle 5-minute minimum gap (smallest valid Empty Slot)', () => {
      // createEmptySlot uses MIN_GAP_MS = 5 * 60 * 1000 (5 minutes)
      const start = new Date('2025-10-20T10:00:00').getTime();
      const end = new Date('2025-10-20T10:05:00').getTime();

      const metadata = {
        ems__Effort_startTimestamp: start,
        ems__Effort_endTimestamp: end,
      };

      const duration = calculateTimeFromTimestamps(metadata);

      // formatTimeEstimate would format this as "5m"
      expect(duration).toBe(5);
    });
  });
});

/**
 * Flaky Test Quarantine System
 *
 * Allows marking known flaky tests for quarantine, preventing them from
 * failing CI while they are being investigated/fixed.
 *
 * @example
 * // In tests/quarantine.ts
 * export const QUARANTINED_TESTS: QuarantinedTest[] = [
 *   {
 *     file: 'src/components/MyComponent.test.ts',
 *     name: 'should handle async state',
 *     issue: 'https://github.com/org/repo/issues/123',
 *     reason: 'Race condition in state update',
 *     quarantinedAt: '2025-01-15',
 *   },
 * ];
 *
 * @example
 * // In jest.config.js
 * module.exports = {
 *   setupFilesAfterEnv: ['@kitelev/exocortex-test-utils/reporters/quarantine-setup'],
 * };
 */

export interface QuarantinedTest {
  /** File path containing the test (relative to root or absolute) */
  file: string;
  /** Test name (the string passed to `it()` or `test()`) */
  name: string;
  /** Link to tracking issue */
  issue?: string;
  /** Description of why the test is flaky */
  reason?: string;
  /** ISO date when test was quarantined */
  quarantinedAt?: string;
  /** ISO date when quarantine expires (auto-remove after this date) */
  expiresAt?: string;
  /** Who quarantined the test */
  owner?: string;
}

export interface QuarantineConfig {
  /** List of quarantined tests */
  tests: QuarantinedTest[];
  /** Whether to skip quarantined tests entirely (vs just not failing on them) */
  skipQuarantined?: boolean;
  /** Maximum age in days before quarantine expires (default: 30) */
  maxQuarantineDays?: number;
  /** Warn about expired quarantines */
  warnOnExpired?: boolean;
}

const DEFAULT_CONFIG: Required<Omit<QuarantineConfig, "tests">> = {
  skipQuarantined: false,
  maxQuarantineDays: 30,
  warnOnExpired: true,
};

/**
 * Quarantine manager for handling flaky test configuration
 */
export class QuarantineManager {
  private config: Required<QuarantineConfig>;
  private testMap: Map<string, QuarantinedTest>;

  constructor(config: QuarantineConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      tests: config.tests ?? [],
    };
    this.testMap = new Map();
    this.buildTestMap();
  }

  private buildTestMap(): void {
    for (const test of this.config.tests) {
      const key = this.getTestKey(test.file, test.name);
      this.testMap.set(key, test);
    }
  }

  private getTestKey(file: string, name: string): string {
    // Normalize file path for cross-platform compatibility
    const normalizedFile = file.replace(/\\/g, "/");
    return `${normalizedFile}::${name}`;
  }

  /**
   * Check if a test is quarantined
   */
  isQuarantined(file: string, name: string): boolean {
    const key = this.getTestKey(file, name);
    const quarantined = this.testMap.get(key);

    if (!quarantined) {
      return false;
    }

    // Check if quarantine has expired
    if (quarantined.expiresAt) {
      const expiryDate = new Date(quarantined.expiresAt);
      if (expiryDate < new Date()) {
        if (this.config.warnOnExpired) {
          console.warn(
            `⚠️  Quarantine expired for test: ${name}\n` +
              `   File: ${file}\n` +
              `   Expired: ${quarantined.expiresAt}\n` +
              `   Issue: ${quarantined.issue ?? "N/A"}\n`,
          );
        }
        return false;
      }
    }

    // Check if quarantine is too old (based on quarantinedAt + maxQuarantineDays)
    if (quarantined.quarantinedAt && this.config.maxQuarantineDays > 0) {
      const quarantinedDate = new Date(quarantined.quarantinedAt);
      const maxDate = new Date(quarantinedDate);
      maxDate.setDate(maxDate.getDate() + this.config.maxQuarantineDays);

      if (maxDate < new Date()) {
        if (this.config.warnOnExpired) {
          console.warn(
            `⚠️  Quarantine expired (exceeded ${this.config.maxQuarantineDays} days) for test: ${name}\n` +
              `   File: ${file}\n` +
              `   Quarantined at: ${quarantined.quarantinedAt}\n` +
              `   Issue: ${quarantined.issue ?? "N/A"}\n`,
          );
        }
        return false;
      }
    }

    return true;
  }

  /**
   * Get quarantine info for a test
   */
  getQuarantineInfo(file: string, name: string): QuarantinedTest | undefined {
    const key = this.getTestKey(file, name);
    return this.testMap.get(key);
  }

  /**
   * Get all quarantined tests
   */
  getAllQuarantined(): QuarantinedTest[] {
    return [...this.config.tests];
  }

  /**
   * Get expired quarantines
   */
  getExpiredQuarantines(): QuarantinedTest[] {
    const now = new Date();
    return this.config.tests.filter((test) => {
      if (test.expiresAt) {
        return new Date(test.expiresAt) < now;
      }
      if (test.quarantinedAt && this.config.maxQuarantineDays > 0) {
        const quarantinedDate = new Date(test.quarantinedAt);
        const maxDate = new Date(quarantinedDate);
        maxDate.setDate(maxDate.getDate() + this.config.maxQuarantineDays);
        return maxDate < now;
      }
      return false;
    });
  }

  /**
   * Should this test be skipped entirely?
   */
  shouldSkip(file: string, name: string): boolean {
    return this.config.skipQuarantined && this.isQuarantined(file, name);
  }

  /**
   * Print quarantine summary
   */
  printSummary(): void {
    const total = this.config.tests.length;
    const expired = this.getExpiredQuarantines().length;

    if (total === 0) {
      console.log("📋 No tests in quarantine");
      return;
    }

    console.log("\n" + "=".repeat(60));
    console.log("📋 QUARANTINE SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total quarantined: ${total}`);
    console.log(`Expired: ${expired}`);
    console.log("");

    for (const test of this.config.tests) {
      console.log(`  - ${test.name}`);
      console.log(`    File: ${test.file}`);
      console.log(`    Reason: ${test.reason ?? "N/A"}`);
      console.log(`    Issue: ${test.issue ?? "N/A"}`);
      console.log(`    Quarantined: ${test.quarantinedAt ?? "N/A"}`);
    }

    console.log("=".repeat(60) + "\n");
  }
}

/**
 * Global quarantine manager instance
 * Initialize with loadQuarantine() in your test setup
 */
let globalQuarantineManager: QuarantineManager | null = null;

/**
 * Load quarantine configuration
 */
export function loadQuarantine(config: QuarantineConfig): QuarantineManager {
  globalQuarantineManager = new QuarantineManager(config);
  return globalQuarantineManager;
}

/**
 * Get the global quarantine manager
 */
export function getQuarantineManager(): QuarantineManager | null {
  return globalQuarantineManager;
}

/**
 * Check if a test is quarantined using the global manager
 */
export function isTestQuarantined(file: string, name: string): boolean {
  return globalQuarantineManager?.isQuarantined(file, name) ?? false;
}

/**
 * Check if a test should be skipped using the global manager
 */
export function shouldSkipTest(file: string, name: string): boolean {
  return globalQuarantineManager?.shouldSkip(file, name) ?? false;
}

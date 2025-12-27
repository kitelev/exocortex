/**
 * DailyReviewService - Mobile-friendly daily review operations
 *
 * Provides capabilities for:
 * - Getting today's practices checklist (recurring tasks)
 * - Quick capture of activities
 * - Daily statistics and review
 * - Creating Task instances from prototypes
 *
 * Designed for mobile/Telegram integration via CLI.
 *
 * @module services
 * @since 1.0.0
 */

import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";
import { DateFormatter } from "../utilities/DateFormatter";
import { FrontmatterService } from "../utilities/FrontmatterService";
import { v4 as uuidv4 } from "uuid";

/**
 * A practice is a recurring task prototype that user should do regularly
 */
export interface Practice {
  /** UUID of the prototype */
  uid: string;
  /** Human-readable label */
  label: string;
  /** File path to prototype */
  path: string;
  /** Recurring rule (e.g., "daily", "weekly", "Раз в 2 недели") */
  recurringRule: string | null;
  /** Estimated duration in minutes */
  estimatedDuration: number | null;
  /** Whether already done today */
  doneToday: boolean;
  /** Whether in progress today */
  inProgressToday: boolean;
  /** Today's instance path if exists */
  todayInstancePath: string | null;
}

/**
 * Summary of daily activities
 */
export interface DailyReviewSummary {
  /** Date of the review (YYYY-MM-DD) */
  date: string;
  /** Total planned tasks for today */
  plannedCount: number;
  /** Completed tasks today */
  completedCount: number;
  /** In progress tasks */
  inProgressCount: number;
  /** Practices due today */
  practicesDue: Practice[];
  /** Completion percentage */
  completionPercentage: number;
  /** Total time spent today in minutes */
  totalTimeMinutes: number;
}

/**
 * Result of quick activity capture
 */
export interface QuickCaptureResult {
  /** Created task file path */
  path: string;
  /** Task UID */
  uid: string;
  /** Task label */
  label: string;
  /** Whether task was started immediately */
  started: boolean;
}

/**
 * Options for creating a task from practice
 */
export interface CreateFromPracticeOptions {
  /** Practice prototype UID */
  prototypeUid: string;
  /** Optional custom label (defaults to prototype label + date) */
  label?: string;
  /** Whether to start the task immediately */
  startImmediately?: boolean;
  /** Optional area UID to link to */
  areaUid?: string;
  /** Optional parent effort UID */
  parentUid?: string;
}

@injectable()
export class DailyReviewService {
  private frontmatterService: FrontmatterService;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {
    this.frontmatterService = new FrontmatterService();
  }

  /**
   * Get list of practices (recurring task prototypes)
   */
  async getPractices(): Promise<Practice[]> {
    const allFiles = this.vault.getAllFiles();
    const practices: Practice[] = [];
    const today = DateFormatter.toDateString(new Date());

    for (const file of allFiles) {
      if (!file.path.endsWith(".md")) continue;

      try {
        const content = await this.vault.read(file);
        const parsed = this.frontmatterService.parse(content);
        if (!parsed.exists) continue;

        // Check if it's a TaskPrototype
        const instanceClass = this.frontmatterService.getPropertyValue(
          parsed.content,
          "exo__Instance_class",
        );

        if (!this.isTaskPrototype(instanceClass)) continue;

        // Get UID
        const uidRaw = this.frontmatterService.getPropertyValue(
          parsed.content,
          "exo__Asset_uid",
        );
        if (!uidRaw) continue;
        const uid = uidRaw.replace(/"/g, "");

        // Get label
        const labelRaw = this.frontmatterService.getPropertyValue(
          parsed.content,
          "exo__Asset_label",
        );
        if (!labelRaw) continue;
        const label = labelRaw.replace(/"/g, "");

        // Get recurring rule
        const recurringRuleRaw = this.frontmatterService.getPropertyValue(
          parsed.content,
          "ems__Recurring_rule",
        );
        const recurringRule = recurringRuleRaw?.replace(/"/g, "") || null;

        // Get estimated duration
        const estimatedDurationStr = this.frontmatterService.getPropertyValue(
          parsed.content,
          "ems__Task_estimatedDuration",
        );
        let estimatedDuration: number | null = null;
        if (estimatedDurationStr) {
          const parsed_duration = parseInt(estimatedDurationStr, 10);
          if (!isNaN(parsed_duration)) {
            estimatedDuration = parsed_duration;
          }
        }

        // Check if there's an instance for today
        const todayInstance = await this.findTodayInstance(uid, today);

        practices.push({
          uid,
          label,
          path: file.path,
          recurringRule,
          estimatedDuration,
          doneToday: todayInstance?.status === "done",
          inProgressToday: todayInstance?.status === "doing",
          todayInstancePath: todayInstance?.path || null,
        });
      } catch {
        // Skip files that can't be processed
        continue;
      }
    }

    // Sort by label
    return practices.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Get today's daily review summary
   */
  async getDailyReviewSummary(date?: Date): Promise<DailyReviewSummary> {
    const targetDate = date || new Date();
    const dateStr = DateFormatter.toDateString(targetDate);
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const allFiles = this.vault.getAllFiles();
    let plannedCount = 0;
    let completedCount = 0;
    let inProgressCount = 0;
    let totalTimeMinutes = 0;

    for (const file of allFiles) {
      if (!file.path.endsWith(".md")) continue;

      try {
        const content = await this.vault.read(file);
        const parsed = this.frontmatterService.parse(content);
        if (!parsed.exists) continue;

        // Check if it's a Task (not prototype)
        const instanceClass = this.frontmatterService.getPropertyValue(
          parsed.content,
          "exo__Instance_class",
        );
        if (!this.isTask(instanceClass)) continue;

        // Check if planned for today
        const plannedStart = this.frontmatterService.getPropertyValue(
          parsed.content,
          "ems__Effort_plannedStartTimestamp",
        );

        // Check if started today
        const startTimestamp = this.frontmatterService.getPropertyValue(
          parsed.content,
          "ems__Effort_startTimestamp",
        );

        const startDate = startTimestamp ? new Date(startTimestamp) : null;
        const plannedDate = plannedStart ? new Date(plannedStart) : null;

        // Count if planned for today or started today
        const isForToday =
          (plannedDate && plannedDate >= dayStart && plannedDate <= dayEnd) ||
          (startDate && startDate >= dayStart && startDate <= dayEnd);

        if (!isForToday) continue;

        plannedCount++;

        // Check status
        const status = this.frontmatterService.getPropertyValue(
          parsed.content,
          "ems__Effort_status",
        );

        if (this.isDoneStatus(status)) {
          completedCount++;

          // Calculate duration if both timestamps exist
          const endTimestamp = this.frontmatterService.getPropertyValue(
            parsed.content,
            "ems__Effort_endTimestamp",
          );
          if (startTimestamp && endTimestamp) {
            const duration = this.calculateDurationMinutes(
              startTimestamp,
              endTimestamp,
            );
            totalTimeMinutes += duration;
          }
        } else if (this.isDoingStatus(status)) {
          inProgressCount++;
        }
      } catch {
        continue;
      }
    }

    // Get practices due today
    const practices = await this.getPractices();
    const practicesDue = practices.filter(
      (p) => !p.doneToday && p.recurringRule,
    );

    const completionPercentage =
      plannedCount > 0 ? Math.round((completedCount / plannedCount) * 100) : 0;

    return {
      date: dateStr,
      plannedCount,
      completedCount,
      inProgressCount,
      practicesDue,
      completionPercentage,
      totalTimeMinutes: Math.round(totalTimeMinutes),
    };
  }

  /**
   * Quick capture an activity (create and optionally start a task)
   */
  async quickCapture(
    label: string,
    startImmediately = true,
    options?: {
      prototypeUid?: string;
      areaUid?: string;
      parentUid?: string;
    },
  ): Promise<QuickCaptureResult> {
    const uid = uuidv4();
    const timestamp = DateFormatter.toISOTimestamp(new Date());
    const filename = `${uid}.md`;
    const folder = "03 Knowledge/kitelev"; // Default folder for tasks

    // Build frontmatter
    const frontmatterLines: string[] = [
      "---",
      `exo__Asset_uid: "${uid}"`,
      `exo__Asset_label: "${label}"`,
      `exo__Instance_class: "[[ems__Task]]"`,
    ];

    if (options?.prototypeUid) {
      const prototypeUri = this.buildPrototypeUri(options.prototypeUid);
      frontmatterLines.push(`exo__Asset_prototype: "${prototypeUri}"`);
    }

    if (options?.areaUid) {
      const areaUri = this.buildAssetUri(options.areaUid);
      frontmatterLines.push(`ems__Effort_area: "${areaUri}"`);
    }

    if (options?.parentUid) {
      const parentUri = this.buildAssetUri(options.parentUid);
      frontmatterLines.push(`ems__Effort_parent: "${parentUri}"`);
    }

    if (startImmediately) {
      frontmatterLines.push(`ems__Effort_status: "[[ems__EffortStatusDoing]]"`);
      frontmatterLines.push(`ems__Effort_startTimestamp: ${timestamp}`);
    } else {
      frontmatterLines.push(
        `ems__Effort_status: "[[ems__EffortStatusBacklog]]"`,
      );
    }

    frontmatterLines.push("---", "", "");

    const content = frontmatterLines.join("\n");
    const path = `${folder}/${filename}`;

    await this.vault.create(path, content);

    return {
      path,
      uid,
      label,
      started: startImmediately,
    };
  }

  /**
   * Create a task from practice prototype
   */
  async createFromPractice(
    options: CreateFromPracticeOptions,
  ): Promise<QuickCaptureResult> {
    // Find the prototype
    const practices = await this.getPractices();
    const practice = practices.find((p) => p.uid === options.prototypeUid);

    if (!practice) {
      throw new Error(`Practice not found: ${options.prototypeUid}`);
    }

    // Check if already done today
    if (practice.doneToday) {
      throw new Error(`Practice "${practice.label}" already completed today`);
    }

    // If there's an in-progress instance, return it
    if (practice.inProgressToday && practice.todayInstancePath) {
      return {
        path: practice.todayInstancePath,
        uid: options.prototypeUid,
        label: practice.label,
        started: true,
      };
    }

    // Build label with date
    const today = DateFormatter.toDateString(new Date());
    const label = options.label || `${practice.label} ${today}`;

    return this.quickCapture(label, options.startImmediately ?? true, {
      prototypeUid: options.prototypeUid,
      areaUid: options.areaUid,
      parentUid: options.parentUid,
    });
  }

  /**
   * Mark a practice as done (complete the today's instance)
   */
  async markPracticeDone(prototypeUid: string): Promise<void> {
    const practices = await this.getPractices();
    const practice = practices.find((p) => p.uid === prototypeUid);

    if (!practice) {
      throw new Error(`Practice not found: ${prototypeUid}`);
    }

    if (practice.doneToday) {
      return; // Already done
    }

    if (!practice.todayInstancePath) {
      throw new Error(
        `No active instance for practice "${practice.label}" today`,
      );
    }

    // Find the file and mark as done
    const abstractFile = this.vault.getAbstractFileByPath(practice.todayInstancePath);
    if (!abstractFile || !("basename" in abstractFile)) {
      throw new Error(`File not found: ${practice.todayInstancePath}`);
    }
    const file = abstractFile as IFile;

    const content = await this.vault.read(file);
    const timestamp = DateFormatter.toISOTimestamp(new Date());

    let updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_status",
      '"[[ems__EffortStatusDone]]"',
    );
    updated = this.frontmatterService.updateProperty(
      updated,
      "ems__Effort_endTimestamp",
      timestamp,
    );
    updated = this.frontmatterService.updateProperty(
      updated,
      "ems__Effort_resolutionTimestamp",
      timestamp,
    );

    await this.vault.modify(file, updated);
  }

  /**
   * Find today's instance of a prototype
   */
  private async findTodayInstance(
    prototypeUid: string,
    today: string,
  ): Promise<{ path: string; status: "doing" | "done" | "other" } | null> {
    const allFiles = this.vault.getAllFiles();

    for (const file of allFiles) {
      if (!file.path.endsWith(".md")) continue;

      try {
        const content = await this.vault.read(file);
        const parsed = this.frontmatterService.parse(content);
        if (!parsed.exists) continue;

        // Check prototype
        const prototype = this.frontmatterService.getPropertyValue(
          parsed.content,
          "exo__Asset_prototype",
        );
        if (!prototype || !prototype.includes(prototypeUid)) continue;

        // Check if it's for today
        const label = this.frontmatterService.getPropertyValue(
          parsed.content,
          "exo__Asset_label",
        );
        const startTimestamp = this.frontmatterService.getPropertyValue(
          parsed.content,
          "ems__Effort_startTimestamp",
        );

        // Check by label containing date or by start timestamp
        const labelHasToday = label?.includes(today);
        const startDate = startTimestamp ? new Date(startTimestamp) : null;
        const startIsToday =
          startDate && DateFormatter.toDateString(startDate) === today;

        if (!labelHasToday && !startIsToday) continue;

        // Get status
        const status = this.frontmatterService.getPropertyValue(
          parsed.content,
          "ems__Effort_status",
        );

        if (this.isDoneStatus(status)) {
          return { path: file.path, status: "done" };
        } else if (this.isDoingStatus(status)) {
          return { path: file.path, status: "doing" };
        } else {
          return { path: file.path, status: "other" };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private isTaskPrototype(instanceClass: string | null): boolean {
    if (!instanceClass) return false;
    return (
      instanceClass.includes("ems__TaskPrototype") ||
      instanceClass.includes("TaskPrototype")
    );
  }

  private isTask(instanceClass: string | null): boolean {
    if (!instanceClass) return false;
    // Match ems__Task but not ems__TaskPrototype
    return (
      (instanceClass.includes("ems__Task") ||
        instanceClass.includes("[[ems__Task]]")) &&
      !instanceClass.includes("Prototype")
    );
  }

  private isDoneStatus(status: string | null): boolean {
    if (!status) return false;
    return status.includes("Done") || status.includes("EffortStatusDone");
  }

  private isDoingStatus(status: string | null): boolean {
    if (!status) return false;
    return status.includes("Doing") || status.includes("EffortStatusDoing");
  }

  private calculateDurationMinutes(start: string, end: string): number {
    const startDate = new Date(start);
    const endDate = new Date(end);
    return (endDate.getTime() - startDate.getTime()) / 1000 / 60;
  }

  private buildPrototypeUri(uid: string): string {
    return `obsidian://vault/03%20Knowledge%2Fkitelev%2F${uid}.md`;
  }

  private buildAssetUri(uid: string): string {
    return `obsidian://vault/03%20Knowledge%2Fkitelev%2F${uid}.md`;
  }
}

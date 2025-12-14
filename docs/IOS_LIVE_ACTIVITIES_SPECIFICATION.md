# iOS Live Activities Integration - Technical Specification

**Version**: 1.0
**Status**: 📋 Planning
**Last Updated**: 2025-11-01
**Author**: Claude Code
**Target Implementation**: Q1 2025

---

## 📖 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Proposed Solution](#proposed-solution)
4. [System Architecture](#system-architecture)
5. [Component Specifications](#component-specifications)
6. [Communication Protocols](#communication-protocols)
7. [Data Models](#data-models)
8. [Implementation Plan](#implementation-plan)
9. [Testing Strategy](#testing-strategy)
10. [Security & Privacy](#security--privacy)
11. [Performance Requirements](#performance-requirements)
12. [Error Handling](#error-handling)
13. [Deployment Strategy](#deployment-strategy)
14. [Future Enhancements](#future-enhancements)
15. [References](#references)

---

## Executive Summary

### Goal

Enable **persistent iOS Live Activities** for tasks in `ems__EffortStatusDoing` state, displaying real-time elapsed time and task completion controls on the lock screen.

### Key Benefits

- ✅ **Always-visible task tracking** - Persistent notification on lock screen
- ✅ **Zero maintenance** - Auto-updating timer without background app execution
- ✅ **One-tap completion** - Complete tasks directly from lock screen
- ✅ **Seamless integration** - Works with existing Obsidian plugin workflow
- ✅ **Privacy-first** - All data stays local, no cloud services

### Success Metrics

- Live Activity appears within **2 seconds** of status change to DOING
- Timer updates **every second** with 100% accuracy
- Task completion updates Obsidian frontmatter within **5 seconds**
- **95%+ reliability** across iOS 16.1+ devices
- **Zero data loss** during app/device restarts

---

## Problem Statement

### User Need

When a user starts working on a task (changes status to `[[ems__EffortStatusDoing]]`), they need:

1. **Persistent visibility** - See active task even when iPhone is locked
2. **Time tracking** - Know how long they've been working
3. **Quick completion** - Mark task done without unlocking device
4. **No context switching** - Stay focused without opening apps

### Current Limitations

**Obsidian Plugin Constraints:**
- ❌ No access to iOS Live Activities API (requires native Swift code)
- ❌ No persistent lock screen notifications
- ❌ Background execution limited to ~3 minutes
- ❌ Cannot create system-wide widgets

**Alternative Solutions (Rejected):**
- **In-app banner**: Only visible when Obsidian is open ❌
- **Push notifications**: Disappear after tap, not persistent ❌
- **Timer app integration**: Requires manual task entry, no sync ❌
- **Obsidian fork**: Requires maintaining entire Obsidian codebase ❌

### Solution Requirements

**Must Have:**
- ✅ Lock screen visibility (even when device locked)
- ✅ Auto-updating elapsed time timer
- ✅ One-tap task completion
- ✅ Bidirectional Obsidian sync
- ✅ Works offline (no network required)

**Nice to Have:**
- 🔄 Pause/resume functionality
- 🔄 Dynamic Island support (iPhone 14 Pro+)
- 🔄 Multiple concurrent tasks
- 🔄 Task history and statistics

---

## Proposed Solution

### Hybrid Architecture

**Two-component system:**

1. **iOS Companion App** (NEW - Swift/SwiftUI)
   - Manages Live Activities lifecycle
   - Renders lock screen UI
   - Handles user interactions (completion button)
   - Communicates with Obsidian via URL schemes

2. **Obsidian Plugin Enhancement** (TypeScript - existing codebase)
   - Detects status changes to DOING
   - Launches companion app with task data
   - Processes completion callbacks
   - Updates frontmatter to DONE

### Communication Flow

```
┌─────────────────────────────────────────────────────────┐
│  User changes status → ems__EffortStatusDoing           │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Obsidian Plugin: TaskTrackingService                   │
│  • Detects frontmatter change via MetadataCache         │
│  • Extracts task: id, title, startTime                  │
│  • Saves state to iCloud Drive (persistence)            │
│  • Launches: exocortex://task/start?params              │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│  iOS Companion App: URL Handler                         │
│  • Parses URL parameters                                │
│  • Creates ActivityKit Live Activity                    │
│  • Live Activity appears on lock screen                 │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Lock Screen: Live Activity Widget                      │
│  📝 Fix bug #123                                        │
│  ⏱️  1h 23m 45s  ← Auto-updates via Text(timerInterval:)│
│  [✅ Завершить]  ← App Intent button                    │
└─────────────────────────────────────────────────────────┘
                           ↓ (user taps button)
┌─────────────────────────────────────────────────────────┐
│  Companion App: CompleteTaskIntent                      │
│  • Triggers callback URL to Obsidian                    │
│  • Ends Live Activity                                   │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Obsidian Plugin: x-callback-url handler                │
│  • Updates frontmatter: ems__EffortStatusDone           │
│  • Clears iCloud state file                             │
│  • Shows completion notice                              │
└─────────────────────────────────────────────────────────┘
```

---

## System Architecture

### Component Diagram

```
┌───────────────────────────────────────────────────────────────────┐
│                         iOS ECOSYSTEM                              │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              Exocortex Companion App                      │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │  Main App Target                                     │ │    │
│  │  │  • URL Scheme Handler: exocortex://                 │ │    │
│  │  │  • TaskManager: Business logic                      │ │    │
│  │  │  • iCloudSyncService: State persistence             │ │    │
│  │  │  • ObsidianBridge: URL builder for callbacks        │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  │                                                            │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │  Widget Extension Target                             │ │    │
│  │  │  • TaskLiveActivity: WidgetKit configuration        │ │    │
│  │  │  • LiveActivityView: SwiftUI layout                 │ │    │
│  │  │  • CompleteTaskIntent: App Intent for button        │ │    │
│  │  │  • Text(timerInterval:): Auto-updating timer        │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  │                                                            │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │  Shared Framework (App Group: group.exocortex)      │ │    │
│  │  │  • TaskData: Codable models                         │ │    │
│  │  │  • ActivityAttributes: ActivityKit types            │ │    │
│  │  │  • Constants: URL schemes, keys                     │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              Obsidian Mobile App                          │    │
│  │  ┌─────────────────────────────────────────────────────┐ │    │
│  │  │  Exocortex Plugin (TypeScript)                       │ │    │
│  │  │  • TaskTrackingService: Core business logic         │ │    │
│  │  │  • MetadataCache listener: Status detection         │ │    │
│  │  │  • ObsidianProtocolHandler: Callback receiver       │ │    │
│  │  │  • iCloudFileService: State file management         │ │    │
│  │  └─────────────────────────────────────────────────────┘ │    │
│  │                                                            │    │
│  │  Dependencies:                                             │    │
│  │  • Obsidian Advanced URI plugin (x-callback-url)          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              iCloud Drive                                 │    │
│  │  ~/Library/Mobile Documents/                              │    │
│  │    iCloud~md~obsidian/Documents/Exocortex/                │    │
│  │      ├── current_task.json    (active task state)         │    │
│  │      ├── task_history.json    (completed tasks)           │    │
│  │      └── sync_metadata.json   (sync timestamps)           │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

### Technology Stack

**iOS Companion App:**
- Language: Swift 5.9+
- UI Framework: SwiftUI
- Widget Framework: WidgetKit
- Live Activities: ActivityKit (iOS 16.1+)
- Storage: FileManager (iCloud Drive)
- Minimum iOS: 16.1 (Live Activities requirement)
- Deployment Target: iOS 16.1+

**Obsidian Plugin:**
- Language: TypeScript 4.9+
- Runtime: Obsidian Plugin API 1.5.0+
- Build Tool: ESBuild
- Storage: Obsidian Vault API + FileManager
- Testing: Jest (unit), Playwright (E2E)

**Shared Infrastructure:**
- Communication: URL Schemes (`exocortex://`, `obsidian://`)
- Persistence: iCloud Drive (JSON files)
- Sync: File-based state sharing (no network)

---

## Component Specifications

### Component 1: iOS Companion App

#### 1.1 Main App Target

**Responsibilities:**
- Parse incoming `exocortex://` URL schemes
- Manage Live Activity lifecycle (create, update, end)
- Persist task state to iCloud Drive
- Build callback URLs to Obsidian
- Provide minimal standalone UI (task list, settings)

**Key Classes:**

```swift
// ExocortexCompanionApp.swift
@main
struct ExocortexCompanionApp: App {
    @StateObject private var taskManager = TaskManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(taskManager)
                .onOpenURL { url in
                    Task {
                        await taskManager.handleURL(url)
                    }
                }
        }
    }
}

// TaskManager.swift
@MainActor
class TaskManager: ObservableObject {
    @Published var currentTask: TaskData?
    @Published var activityID: String?

    private let activityService: ActivityService
    private let icloudService: iCloudSyncService
    private let obsidianBridge: ObsidianBridge

    // Handle exocortex://task/start URL
    func handleURL(_ url: URL) async throws {
        guard url.scheme == "exocortex" else { return }

        switch url.host {
        case "task":
            try await handleTaskURL(url)
        default:
            throw URLError.unknownHost
        }
    }

    private func handleTaskURL(_ url: URL) async throws {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let action = url.pathComponents.last

        switch action {
        case "start":
            try await startTask(from: components)
        case "complete":
            try await completeCurrentTask()
        default:
            throw URLError.unknownAction
        }
    }

    // Start tracking task with Live Activity
    func startTask(from components: URLComponents?) async throws {
        guard let params = components?.queryItems else {
            throw TaskError.missingParameters
        }

        let taskData = try TaskData(from: params)

        // Save to iCloud for persistence
        try await icloudService.saveCurrentTask(taskData)

        // Create Live Activity
        let activityID = try await activityService.startActivity(for: taskData)

        // Update state
        self.currentTask = taskData
        self.activityID = activityID
    }

    // Complete task and notify Obsidian
    func completeCurrentTask() async throws {
        guard let task = currentTask else {
            throw TaskError.noActiveTask
        }

        // Build callback URL to Obsidian
        let callbackURL = try obsidianBridge.buildCompletionURL(
            taskID: task.id,
            vaultName: task.vaultName
        )

        // Open Obsidian (triggers Advanced URI)
        await UIApplication.shared.open(callbackURL)

        // End Live Activity
        if let activityID = activityID {
            try await activityService.endActivity(activityID)
        }

        // Clear state
        try await icloudService.clearCurrentTask()
        self.currentTask = nil
        self.activityID = nil
    }
}

// ActivityService.swift
class ActivityService {
    func startActivity(for task: TaskData) async throws -> String {
        let attributes = TaskAttributes(taskID: task.id)
        let state = TaskAttributes.ContentState(
            taskTitle: task.title,
            startDate: task.startTime
        )

        let content = ActivityContent(state: state, staleDate: nil)

        let activity = try Activity.request(
            attributes: attributes,
            content: content,
            pushType: nil
        )

        return activity.id
    }

    func endActivity(_ id: String) async throws {
        guard let activity = Activity<TaskAttributes>.activities.first(where: { $0.id == id }) else {
            throw ActivityError.notFound
        }

        await activity.end(dismissalPolicy: .immediate)
    }
}

// iCloudSyncService.swift
class iCloudSyncService {
    private let fileManager = FileManager.default
    private var icloudURL: URL? {
        fileManager.url(
            forUbiquityContainerIdentifier: nil
        )?.appendingPathComponent("Documents/Exocortex")
    }

    func saveCurrentTask(_ task: TaskData) async throws {
        guard let icloudURL = icloudURL else {
            throw iCloudError.containerNotAvailable
        }

        // Ensure directory exists
        try fileManager.createDirectory(
            at: icloudURL,
            withIntermediateDirectories: true
        )

        let fileURL = icloudURL.appendingPathComponent("current_task.json")
        let data = try JSONEncoder().encode(task)
        try data.write(to: fileURL, options: .atomic)
    }

    func loadCurrentTask() async throws -> TaskData? {
        guard let icloudURL = icloudURL else { return nil }

        let fileURL = icloudURL.appendingPathComponent("current_task.json")

        guard fileManager.fileExists(atPath: fileURL.path) else {
            return nil
        }

        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode(TaskData.self, from: data)
    }

    func clearCurrentTask() async throws {
        guard let icloudURL = icloudURL else { return }

        let fileURL = icloudURL.appendingPathComponent("current_task.json")
        try? fileManager.removeItem(at: fileURL)
    }
}

// ObsidianBridge.swift
class ObsidianBridge {
    func buildCompletionURL(taskID: String, vaultName: String) throws -> URL {
        var components = URLComponents()
        components.scheme = "obsidian"
        components.host = "x-callback-url"
        components.path = "/advanced-uri"

        components.queryItems = [
            URLQueryItem(name: "vault", value: vaultName),
            URLQueryItem(name: "filepath", value: "\(taskID).md"),
            URLQueryItem(name: "frontmatter", value: "{\"ems__EffortStatus\": \"[[ems__EffortStatusDone]]\"}"),
            URLQueryItem(name: "x-success", value: "exocortex://task/completed")
        ]

        guard let url = components.url else {
            throw URLError.invalidURL
        }

        return url
    }
}
```

#### 1.2 Widget Extension Target

**Responsibilities:**
- Render Live Activity UI on lock screen
- Auto-update elapsed time timer
- Handle button tap interactions
- Conform to WidgetKit/ActivityKit protocols

**Key Components:**

```swift
// TaskLiveActivity.swift
import ActivityKit
import WidgetKit
import SwiftUI

// Define what data is static (attributes) vs dynamic (state)
struct TaskAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var taskTitle: String
        var startDate: Date
    }

    var taskID: String
}

// Main Widget Configuration
struct TaskLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TaskAttributes.self) { context in
            // Lock Screen & Banner UI
            LockScreenLiveActivityView(context: context)
        } dynamicIsland: { context in
            // Dynamic Island UI (iPhone 14 Pro+)
            DynamicIsland {
                // Expanded view
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.taskTitle)
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: context.state.startDate...Date.distantFuture, countsDown: false)
                        .font(.title2)
                        .monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Button(intent: CompleteTaskIntent(taskID: context.attributes.taskID)) {
                        Label("Завершить", systemImage: "checkmark.circle.fill")
                    }
                }
            } compactLeading: {
                Image(systemName: "timer")
            } compactTrailing: {
                Text(timerInterval: context.state.startDate...Date.distantFuture, countsDown: false)
                    .monospacedDigit()
                    .font(.caption2)
            } minimal: {
                Image(systemName: "timer")
            }
        }
    }
}

// Lock Screen UI
struct LockScreenLiveActivityView: View {
    let context: ActivityViewContext<TaskAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checkmark.square.fill")
                    .foregroundColor(.accentColor)

                Text(context.state.taskTitle)
                    .font(.headline)
                    .lineLimit(2)

                Spacer()
            }

            HStack {
                // Auto-updating timer (no app updates needed!)
                Text(timerInterval: context.state.startDate...Date.distantFuture, countsDown: false)
                    .font(.title2)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundColor(.accentColor)

                Spacer()

                // Completion button (works even on lock screen)
                Button(intent: CompleteTaskIntent(taskID: context.attributes.taskID)) {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                        Text("Завершить")
                    }
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.green)
                    .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.25))
    }
}

// App Intent for button interaction
struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Task"

    @Parameter(title: "Task ID")
    var taskID: String

    init() {}

    init(taskID: String) {
        self.taskID = taskID
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        // Get TaskManager instance
        let taskManager = TaskManager.shared

        // Complete task (triggers Obsidian callback)
        try await taskManager.completeCurrentTask()

        return .result()
    }
}
```

#### 1.3 Shared Framework

**Responsibilities:**
- Define shared data models (TaskData, ActivityAttributes)
- Define constants (URL schemes, keys, defaults)
- Provide utility functions used by both targets

**Key Models:**

```swift
// TaskData.swift
import Foundation

struct TaskData: Codable, Hashable {
    let id: String           // Note filename (without .md)
    let title: String        // Task label
    let startTime: Date      // When task started
    let vaultName: String    // Obsidian vault name

    // Initialize from URL query parameters
    init(from queryItems: [URLQueryItem]) throws {
        guard let id = queryItems.first(where: { $0.name == "id" })?.value,
              let title = queryItems.first(where: { $0.name == "title" })?.value,
              let startTimeString = queryItems.first(where: { $0.name == "startTime" })?.value,
              let vaultName = queryItems.first(where: { $0.name == "vaultName" })?.value else {
            throw TaskError.missingParameters
        }

        guard let startTime = ISO8601DateFormatter().date(from: startTimeString) else {
            throw TaskError.invalidDateFormat
        }

        self.id = id
        self.title = title
        self.startTime = startTime
        self.vaultName = vaultName
    }
}

// Constants.swift
enum Constants {
    enum URLScheme {
        static let exocortex = "exocortex"
        static let obsidian = "obsidian"

        static let taskStart = "task/start"
        static let taskComplete = "task/complete"
        static let taskCompleted = "task/completed"
    }

    enum iCloud {
        static let directory = "Documents/Exocortex"
        static let currentTaskFile = "current_task.json"
        static let historyFile = "task_history.json"
    }
}

// Errors.swift
enum TaskError: LocalizedError {
    case missingParameters
    case invalidDateFormat
    case noActiveTask

    var errorDescription: String? {
        switch self {
        case .missingParameters:
            return "Missing required URL parameters"
        case .invalidDateFormat:
            return "Invalid ISO8601 date format"
        case .noActiveTask:
            return "No active task to complete"
        }
    }
}

enum ActivityError: LocalizedError {
    case notFound
    case creationFailed

    var errorDescription: String? {
        switch self {
        case .notFound:
            return "Live Activity not found"
        case .creationFailed:
            return "Failed to create Live Activity"
        }
    }
}

enum iCloudError: LocalizedError {
    case containerNotAvailable
    case fileReadFailed
    case fileWriteFailed

    var errorDescription: String? {
        switch self {
        case .containerNotAvailable:
            return "iCloud Drive container not available"
        case .fileReadFailed:
            return "Failed to read file from iCloud"
        case .fileWriteFailed:
            return "Failed to write file to iCloud"
        }
    }
}
```

### Component 2: Obsidian Plugin Enhancement

#### 2.1 TaskTrackingService

**Responsibilities:**
- Listen to frontmatter changes via MetadataCache
- Detect transitions to `ems__EffortStatusDoing`
- Launch companion app via URL scheme
- Save task state to iCloud Drive
- Handle completion callbacks via x-callback-url
- Update frontmatter to `ems__EffortStatusDone`

**Implementation:**

```typescript
// packages/obsidian-plugin/src/infrastructure/services/TaskTrackingService.ts

import { App, TFile, Notice, MetadataCache } from 'obsidian';
import { EffortStatus } from 'exocortex';

interface TaskData {
  id: string;
  title: string;
  startTime: string;
  vaultName: string;
}

export class TaskTrackingService {
  private readonly COMPANION_SCHEME = 'exocortex://';
  private readonly ICLOUD_PATH: string;
  private currentTaskId: string | null = null;

  constructor(
    private app: App,
    private icloudBasePath?: string
  ) {
    this.ICLOUD_PATH = icloudBasePath || this.getDefaultiCloudPath();
  }

  private getDefaultiCloudPath(): string {
    // iOS: ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Exocortex/
    // This path is accessible from Obsidian mobile
    return 'iCloud~md~obsidian/Documents/Exocortex';
  }

  async onStatusChange(file: TFile, newStatus: string): Promise<void> {
    const normalizedStatus = this.normalizeStatus(newStatus);

    if (normalizedStatus === EffortStatus.DOING) {
      await this.startTracking(file);
    } else if (this.currentTaskId === file.basename) {
      // Task status changed away from DOING
      await this.stopTracking();
    }
  }

  private normalizeStatus(status: string): string {
    return status.replace(/["'[\]]/g, '').trim();
  }

  private async startTracking(file: TFile): Promise<void> {
    try {
      const taskData = await this.buildTaskData(file);

      // Save to iCloud for persistence
      await this.saveToiCloud(taskData);

      // Launch companion app via URL scheme
      const url = this.buildLaunchURL(taskData);
      this.openURL(url);

      // Track current task
      this.currentTaskId = taskData.id;

      new Notice(`Started tracking: ${taskData.title}`);
    } catch (error) {
      console.error('Failed to start task tracking:', error);
      new Notice('Failed to start task tracking. Check console for details.');
    }
  }

  private async stopTracking(): Promise<void> {
    try {
      await this.cleariCloudState();
      this.currentTaskId = null;
    } catch (error) {
      console.error('Failed to stop task tracking:', error);
    }
  }

  private async buildTaskData(file: TFile): Promise<TaskData> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    const title = frontmatter?.exo__Asset_label || file.basename;
    const id = file.basename;
    const startTime = new Date().toISOString();
    const vaultName = this.app.vault.getName();

    return { id, title, startTime, vaultName };
  }

  private buildLaunchURL(data: TaskData): string {
    const params = new URLSearchParams({
      id: data.id,
      title: data.title,
      startTime: data.startTime,
      vaultName: data.vaultName,
      'x-success': `obsidian://x-callback-url/open?vault=${encodeURIComponent(data.vaultName)}`,
      'x-cancel': `obsidian://x-callback-url/open?vault=${encodeURIComponent(data.vaultName)}`
    });

    return `${this.COMPANION_SCHEME}task/start?${params.toString()}`;
  }

  private openURL(url: string): void {
    if (Platform.isMobileApp) {
      // iOS: Use window.open to trigger URL scheme
      window.open(url, '_blank');
    } else {
      new Notice('Task tracking is only available on iOS');
    }
  }

  private async saveToiCloud(taskData: TaskData): Promise<void> {
    // Note: iCloud Drive access from Obsidian mobile uses FileManager API
    // Path: ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Exocortex/

    const jsonContent = JSON.stringify(taskData, null, 2);
    const filePath = `${this.ICLOUD_PATH}/current_task.json`;

    // Use Obsidian's adapter to write to file system
    // This works because Obsidian has iCloud Drive access on iOS
    try {
      await this.app.vault.adapter.write(filePath, jsonContent);
    } catch (error) {
      console.warn('Failed to write to iCloud Drive:', error);
      // Non-fatal: companion app can still work via URL parameters
    }
  }

  private async cleariCloudState(): Promise<void> {
    const filePath = `${this.ICLOUD_PATH}/current_task.json`;

    try {
      await this.app.vault.adapter.remove(filePath);
    } catch (error) {
      // Ignore errors (file may not exist)
    }
  }

  async handleCompletion(taskId: string): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(`${taskId}.md`);

      if (!(file instanceof TFile)) {
        throw new Error(`File not found: ${taskId}.md`);
      }

      // Update frontmatter
      await this.updateStatus(file, EffortStatus.DONE);

      // Clear state
      await this.cleariCloudState();
      this.currentTaskId = null;

      new Notice(`Task completed: ${file.basename}`);
    } catch (error) {
      console.error('Failed to handle task completion:', error);
      new Notice('Failed to complete task. Check console for details.');
    }
  }

  private async updateStatus(file: TFile, newStatus: EffortStatus): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.ems__Effort_status = `"[[${newStatus}]]"`;
    });
  }
}
```

#### 2.2 Plugin Integration

**Modifications to ExocortexPlugin.ts:**

```typescript
// packages/obsidian-plugin/src/ExocortexPlugin.ts

import { Plugin, TFile } from 'obsidian';
import { TaskTrackingService } from './infrastructure/services/TaskTrackingService';

export default class ExocortexPlugin extends Plugin {
  private taskTracker!: TaskTrackingService;

  async onload() {
    console.log('Loading Exocortex Plugin');

    // ... existing initialization ...

    // Initialize task tracking (iOS only)
    if (Platform.isMobileApp) {
      this.taskTracker = new TaskTrackingService(this.app);
      this.registerTaskTracking();
    }

    // ... rest of onload ...
  }

  private registerTaskTracking(): void {
    // Listen to metadata changes
    this.registerEvent(
      this.app.metadataCache.on('changed', async (file) => {
        if (!(file instanceof TFile)) return;

        const cache = this.app.metadataCache.getFileCache(file);
        const status = cache?.frontmatter?.ems__Effort_status;

        if (status) {
          await this.taskTracker.onStatusChange(file, status);
        }
      })
    );

    // Register x-callback-url handler (requires Advanced URI plugin)
    // URL format: obsidian://exocortex-task-complete?id=<taskId>
    this.registerObsidianProtocolHandler('exocortex-task-complete', async (params) => {
      const taskId = params.id;
      if (taskId) {
        await this.taskTracker.handleCompletion(taskId);
      }
    });
  }
}
```

---

## Communication Protocols

### Protocol 1: Task Start

**Direction:** Obsidian → Companion App
**Transport:** URL Scheme
**Trigger:** User changes status to `[[ems__EffortStatusDoing]]`

**URL Format:**
```
exocortex://task/start?
  id=<note-filename>&
  title=<task-title>&
  startTime=<ISO8601-timestamp>&
  vaultName=<vault-name>&
  x-success=obsidian://x-callback-url/open?vault=<vault-name>&
  x-cancel=obsidian://x-callback-url/open?vault=<vault-name>
```

**Parameters:**
| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `id` | string | ✅ | Note filename (without .md) | `550e8400-e29b-41d4-a716-446655440000` |
| `title` | string | ✅ | Task label from frontmatter | `Fix bug #123` |
| `startTime` | ISO8601 | ✅ | Task start timestamp | `2025-11-01T10:30:00Z` |
| `vaultName` | string | ✅ | Obsidian vault name | `My Vault` |
| `x-success` | URL | ✅ | Callback on success | `obsidian://x-callback-url/open?vault=My%20Vault` |
| `x-cancel` | URL | ✅ | Callback on cancel | `obsidian://x-callback-url/open?vault=My%20Vault` |

**Example:**
```
exocortex://task/start?id=550e8400-e29b-41d4-a716-446655440000&title=Fix%20bug%20%23123&startTime=2025-11-01T10%3A30%3A00Z&vaultName=My%20Vault&x-success=obsidian%3A%2F%2Fx-callback-url%2Fopen%3Fvault%3DMy%2520Vault&x-cancel=obsidian%3A%2F%2Fx-callback-url%2Fopen%3Fvault%3DMy%2520Vault
```

**Response:**
- Companion app launches
- Live Activity created
- Lock screen notification appears

**Error Handling:**
- App not installed → Show notice: "Install Exocortex Companion from App Store"
- Invalid parameters → Log error, show user-friendly message
- Activity creation failed → Retry once, then show error

---

### Protocol 2: Task Completion

**Direction:** Companion App → Obsidian
**Transport:** URL Scheme (x-callback-url via Advanced URI)
**Trigger:** User taps "Завершить" button on lock screen

**URL Format:**
```
obsidian://x-callback-url/advanced-uri?
  vault=<vault-name>&
  filepath=<note-path>&
  frontmatter=<json-encoded-updates>&
  x-success=exocortex://task/completed
```

**Parameters:**
| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `vault` | string | ✅ | Vault name | `My Vault` |
| `filepath` | string | ✅ | Note path (with .md) | `550e8400-e29b-41d4-a716-446655440000.md` |
| `frontmatter` | JSON | ✅ | Frontmatter updates | `{"ems__Effort_status": "[[ems__EffortStatusDone]]"}` |
| `x-success` | URL | ✅ | Callback on success | `exocortex://task/completed` |

**Example:**
```
obsidian://x-callback-url/advanced-uri?vault=My%20Vault&filepath=550e8400-e29b-41d4-a716-446655440000.md&frontmatter=%7B%22ems__Effort_status%22%3A%20%22%5B%5Bems__EffortStatusDone%5D%5D%22%7D&x-success=exocortex%3A%2F%2Ftask%2Fcompleted
```

**Response:**
- Obsidian updates frontmatter
- Status changes to `[[ems__EffortStatusDone]]`
- Callback triggers companion app
- Companion app ends Live Activity

**Error Handling:**
- Advanced URI not installed → Fallback to manual protocol handler
- File not found → Log error, show notice
- Frontmatter update failed → Retry once, then alert user

---

### Protocol 3: State Persistence (iCloud Drive)

**Direction:** Bidirectional (Obsidian ↔ iCloud ↔ Companion)
**Transport:** JSON files in iCloud Drive
**Purpose:** Restore state after app/device restart

**File Structure:**

```json
// current_task.json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Fix bug #123",
  "startTime": "2025-11-01T10:30:00Z",
  "vaultName": "My Vault"
}
```

**Location:**
- **iOS**: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Exocortex/current_task.json`
- **Obsidian**: Accessible via `vault.adapter.write()` API

**Sync Behavior:**
- **Write**: Immediate (both apps write on task start)
- **Read**: On app launch, every 30 seconds (companion app)
- **Delete**: On task completion (both apps)
- **Conflict Resolution**: Obsidian is source of truth (overwrites companion)

**Error Handling:**
- iCloud unavailable → Continue with URL-based communication only
- Sync delay > 30s → Show "Sync pending" indicator
- File corrupted → Delete and recreate from current Obsidian state

---

## Data Models

### TaskData (Shared between Obsidian & iOS)

```typescript
// TypeScript (Obsidian)
interface TaskData {
  id: string;           // Note filename without .md
  title: string;        // exo__Asset_label or filename
  startTime: string;    // ISO8601 timestamp
  vaultName: string;    // Vault name for callbacks
}
```

```swift
// Swift (iOS)
struct TaskData: Codable, Hashable {
    let id: String
    let title: String
    let startTime: Date
    let vaultName: String
}
```

**Validation Rules:**
- `id`: Non-empty string, max 255 chars
- `title`: Non-empty string, max 500 chars
- `startTime`: Valid ISO8601 date, not in future
- `vaultName`: Non-empty string, valid vault name

---

### ActivityAttributes (iOS only)

```swift
struct TaskAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var taskTitle: String
        var startDate: Date
    }

    var taskID: String
}
```

**Usage:**
- `taskID` (attribute): Immutable, identifies the task
- `taskTitle` (state): Can update if task renamed
- `startDate` (state): Immutable, used for timer calculation

---

## Implementation Plan

### Phase 1: iOS Companion App MVP (2 weeks)

**Week 1: Core Infrastructure**
- [x] Research completed
- [ ] Create Xcode project with Live Activities capability
- [ ] Setup App Group entitlement (if needed for future)
- [ ] Implement URL scheme handler (`exocortex://`)
- [ ] Create TaskData model and URLComponents parser
- [ ] Implement ActivityService (create/end Live Activity)
- [ ] Add basic error handling

**Week 2: Live Activity UI**
- [ ] Design Live Activity layout (SwiftUI)
- [ ] Implement Text(timerInterval:) auto-updating timer
- [ ] Create CompleteTaskIntent for button
- [ ] Add ObsidianBridge for callback URLs
- [ ] Implement iCloudSyncService
- [ ] Test on physical device (Live Activities don't work in Simulator)
- [ ] Polish UI (colors, fonts, layout)

**Deliverables:**
- ✅ Functional iOS app (beta)
- ✅ Live Activity with timer works
- ✅ Completion button triggers callback
- ✅ iCloud persistence works

---

### Phase 2: Obsidian Plugin Integration (1 week)

**Day 1-2: Service Implementation**
- [ ] Create TaskTrackingService class
- [ ] Implement MetadataCache listener
- [ ] Add status change detection logic
- [ ] Implement URL scheme launcher

**Day 3-4: iCloud Integration**
- [ ] Add iCloud file write/read utilities
- [ ] Test iCloud sync on iOS device
- [ ] Handle iCloud unavailable gracefully

**Day 5-7: Callback Handling & Testing**
- [ ] Register Obsidian protocol handler
- [ ] Implement completion callback logic
- [ ] Write unit tests for TaskTrackingService
- [ ] Test end-to-end flow (Obsidian → iOS → Obsidian)
- [ ] Fix bugs and edge cases

**Deliverables:**
- ✅ TaskTrackingService integrated into plugin
- ✅ Full workflow tested on iOS
- ✅ Unit tests passing (≥80% coverage)

---

### Phase 3: Testing & Refinement (1 week)

**Day 1-3: Integration Testing**
- [ ] Test full workflow 20+ times
- [ ] Test edge cases:
  - App killed while task active
  - Device restart during task
  - Obsidian closed when completing task
  - Multiple tasks started quickly
  - Invalid URLs
  - iCloud sync delays

**Day 4-5: Error Handling**
- [ ] Improve error messages (user-friendly)
- [ ] Add retry logic for URL schemes
- [ ] Handle Advanced URI plugin missing
- [ ] Add logging for debugging

**Day 6-7: Documentation & Polish**
- [ ] Write user guide (setup, usage, troubleshooting)
- [ ] Update README.md
- [ ] Create demo video/screenshots
- [ ] Polish notification messages
- [ ] Prepare App Store assets

**Deliverables:**
- ✅ Robust, tested implementation
- ✅ Comprehensive error handling
- ✅ User documentation
- ✅ Ready for beta testing

---

### Phase 4: App Store Submission (1 week)

**Day 1-2: App Store Preparation**
- [ ] Create App Store Connect listing
- [ ] Write app description
- [ ] Create screenshots (required sizes)
- [ ] Add privacy policy
- [ ] Configure app permissions

**Day 3: Submit for Review**
- [ ] Build release version
- [ ] Upload to App Store Connect
- [ ] Submit for review
- [ ] Address reviewer questions

**Day 4-7: Review & Launch**
- [ ] Wait for review (typically 1-2 days)
- [ ] Fix any rejection issues
- [ ] Resubmit if needed
- [ ] Launch publicly

**Deliverables:**
- ✅ App live on App Store
- ✅ Users can download and use

---

### Phase 5: Advanced Features (Optional, 2-4 weeks)

**Nice-to-have enhancements:**
- [ ] Pause/Resume functionality
- [ ] Multiple concurrent tasks support
- [ ] Task history and statistics view
- [ ] Dynamic Island compact view
- [ ] Push notifications fallback (requires server)
- [ ] Apple Watch complication
- [ ] Siri Shortcuts integration
- [ ] Widget customization (colors, layout)

---

## Testing Strategy

### Unit Tests

**Obsidian Plugin (Jest):**
```typescript
describe('TaskTrackingService', () => {
  describe('buildTaskData', () => {
    it('should extract task data from file frontmatter', async () => {
      const file = mockTFile('task.md');
      const service = new TaskTrackingService(mockApp);

      const data = await service.buildTaskData(file);

      expect(data.id).toBe('task');
      expect(data.title).toBe('Fix bug #123');
      expect(data.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(data.vaultName).toBe('Test Vault');
    });
  });

  describe('buildLaunchURL', () => {
    it('should build valid exocortex:// URL', () => {
      const service = new TaskTrackingService(mockApp);
      const url = service.buildLaunchURL(mockTaskData);

      expect(url).toContain('exocortex://task/start');
      expect(url).toContain('id=550e8400');
      expect(url).toContain('title=Fix%20bug');
      expect(url).toContain('x-success=obsidian');
    });
  });

  describe('handleCompletion', () => {
    it('should update frontmatter to DONE', async () => {
      const service = new TaskTrackingService(mockApp);

      await service.handleCompletion('task-id');

      const file = mockApp.vault.getAbstractFileByPath('task-id.md');
      const frontmatter = mockApp.metadataCache.getFileCache(file)?.frontmatter;

      expect(frontmatter?.ems__Effort_status).toBe('"[[ems__EffortStatusDone]]"');
    });
  });
});
```

**iOS Companion App (XCTest):**
```swift
class TaskManagerTests: XCTestCase {
    func testHandleTaskStartURL() async throws {
        let taskManager = TaskManager()
        let url = URL(string: "exocortex://task/start?id=abc&title=Test&startTime=2025-11-01T10:00:00Z&vaultName=Vault")!

        try await taskManager.handleURL(url)

        XCTAssertNotNil(taskManager.currentTask)
        XCTAssertEqual(taskManager.currentTask?.id, "abc")
        XCTAssertEqual(taskManager.currentTask?.title, "Test")
    }

    func testBuildCompletionURL() throws {
        let bridge = ObsidianBridge()
        let url = try bridge.buildCompletionURL(taskID: "abc", vaultName: "Vault")

        XCTAssertEqual(url.scheme, "obsidian")
        XCTAssertTrue(url.absoluteString.contains("filepath=abc.md"))
        XCTAssertTrue(url.absoluteString.contains("frontmatter="))
    }
}
```

---

### Integration Tests

**End-to-End Workflow (Manual testing on device):**
1. Open Obsidian, navigate to a Task note
2. Change `ems__Effort_status` to `[[ems__EffortStatusDoing]]`
3. **Verify**: Companion app launches, Live Activity appears on lock screen
4. Lock device
5. **Verify**: Live Activity visible, timer updates every second
6. Wait 1 minute
7. **Verify**: Timer shows ~1:00
8. Tap "Завершить" button on lock screen
9. **Verify**: Live Activity disappears, Obsidian opens
10. Check Task note frontmatter
11. **Verify**: Status is `[[ems__EffortStatusDone]]`

**Edge Case Tests:**
- Kill companion app while task active → Restart app → Verify Live Activity restored
- Restart device while task active → Verify Live Activity restored
- Complete task while Obsidian closed → Verify frontmatter updated when Obsidian opens
- Start 3 tasks quickly → Verify only latest task tracked
- Delete task file while tracked → Verify graceful error handling

---

### Performance Tests

**Metrics to measure:**
- Time from status change to Live Activity appearing: **Target <2s**
- Timer accuracy (compare to system time after 1 hour): **Target <1s drift**
- Completion callback to frontmatter update: **Target <5s**
- iCloud sync latency (write to read): **Measure, accept <30s**
- App launch time (cold start): **Target <1s**

**Tools:**
- Xcode Instruments (Time Profiler)
- iOS Settings → Developer → Network Simulator (test iCloud delays)
- Manual stopwatch testing

---

## Security & Privacy

### Data Privacy

**Principles:**
- ✅ **Local-first**: All task data stored locally (device + iCloud Drive)
- ✅ **No telemetry**: No analytics, no tracking, no external servers
- ✅ **User control**: User can delete iCloud files anytime
- ✅ **Transparent**: Open-source Obsidian plugin, clear data flows

**Data Storage:**
| Data | Location | Encryption | Access |
|------|----------|------------|--------|
| Task title, ID | iCloud Drive | ✅ iCloud encryption | User only |
| Live Activity state | iOS system | ✅ iOS secure storage | System only |
| Obsidian notes | Obsidian vault | ✅ User's choice (iCloud/Sync) | User only |

**Privacy Policy (App Store requirement):**
- "This app does not collect, transmit, or sell any user data"
- "Task data stored in your iCloud Drive, encrypted by Apple"
- "No third-party services or analytics"

---

### URL Scheme Security

**Threats:**
- Malicious app sends fake `exocortex://` URL with crafted parameters
- URL injection attacks (SQLi-style)

**Mitigations:**
1. **Input validation**: Validate all URL parameters
   ```swift
   guard taskID.range(of: "^[a-zA-Z0-9-]+$", options: .regularExpression) != nil else {
       throw ValidationError.invalidTaskID
   }
   ```

2. **URL encoding**: Always encode/decode URLs properly
   ```swift
   let encodedTitle = title.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
   ```

3. **Whitelist schemes**: Only accept `exocortex://` and `obsidian://`
   ```swift
   guard url.scheme == "exocortex" else {
       throw URLError.untrustedScheme
   }
   ```

4. **User confirmation**: For destructive actions, show confirmation alert
   ```swift
   // Not needed for completion (user explicitly tapped button)
   // But consider for future features like "delete task"
   ```

---

### iOS Permissions

**Required:**
- ❌ **No special permissions needed** - Live Activities work without user prompt

**Optional:**
- iCloud Drive (automatic if user enables iCloud)
- Notifications (if adding push notification fallback in future)

**User consent:**
- First launch: Show onboarding explaining iCloud usage
- Settings: Toggle to disable iCloud sync (use URL-only mode)

---

## Performance Requirements

### Response Times

| Operation | Target | Maximum | Notes |
|-----------|--------|---------|-------|
| Status change → Live Activity appears | <2s | <5s | Includes URL launch + Activity creation |
| Timer update frequency | 1s | 1s | Automatic via Text(timerInterval:) |
| Completion button tap → frontmatter update | <3s | <10s | Includes callback + file write |
| iCloud write | <1s | <5s | Local write, async iCloud sync |
| iCloud read (app launch) | <2s | <10s | May be slower on poor network |
| App cold start | <1s | <2s | Minimal app, fast launch |

---

### Resource Usage

**Memory:**
- Target: <50 MB (app + widget combined)
- Maximum: <100 MB

**CPU:**
- Idle (Live Activity visible): <1% average
- URL handling: <10% spike (brief)
- Timer updates: 0% (handled by iOS system)

**Battery:**
- Impact: **Negligible** (Live Activities are system-optimized)
- No background execution needed (timer is declarative)

**Network:**
- iCloud sync: <10 KB per task (JSON file)
- Total: <100 KB/day (typical usage)

---

### Scalability

**Current design:**
- ✅ Single task tracking (one Live Activity at a time)
- ✅ Handles 10-20 task starts/completions per day

**Future scaling:**
- 🔄 Multiple concurrent tasks (requires UI redesign)
- 🔄 100+ tasks per day (may need local database instead of JSON)

---

## Error Handling

### Error Categories

#### 1. URL Scheme Errors

**Scenario:** Companion app not installed

**Detection:** `window.open()` fails silently on iOS

**Handling:**
```typescript
// Obsidian plugin
private openURL(url: string): void {
  if (Platform.isMobileApp) {
    window.open(url, '_blank');

    // Show instruction after delay (app launch cancels if successful)
    setTimeout(() => {
      new Notice(
        'Install Exocortex Companion from App Store to track tasks',
        10000
      );
    }, 2000);
  }
}
```

**Scenario:** Invalid URL parameters

**Detection:** Parsing fails in Swift

**Handling:**
```swift
// iOS app
do {
  let taskData = try TaskData(from: queryItems)
} catch TaskError.missingParameters {
  showAlert(
    title: "Invalid Task Data",
    message: "The task link from Obsidian is missing required information. Please try again."
  )
}
```

---

#### 2. Live Activity Errors

**Scenario:** Activity creation fails (iOS quota exceeded)

**Detection:** `Activity.request()` throws error

**Handling:**
```swift
do {
  let activity = try Activity.request(attributes: attributes, content: content)
} catch ActivityAuthorizationError.activityLimitExceeded {
  showAlert(
    title: "Too Many Activities",
    message: "iOS allows maximum 8 Live Activities. Please end some before starting new tasks."
  )
} catch {
  showAlert(
    title: "Failed to Start Tracking",
    message: "Could not create Live Activity. Please try again."
  )
}
```

**Scenario:** Live Activity expires (after 12 hours)

**Detection:** ActivityKit sends expiration event

**Handling:**
```swift
// Show notification
UNUserNotificationCenter.current().add(notification: "Task tracking expired. Please check task status in Obsidian.")

// Clear state
try await icloudService.clearCurrentTask()
```

---

#### 3. iCloud Errors

**Scenario:** iCloud Drive not available

**Detection:** `fileManager.url(forUbiquityContainerIdentifier:)` returns nil

**Handling:**
```swift
guard let icloudURL = icloudURL else {
  // Graceful degradation: continue without iCloud
  logger.warning("iCloud Drive unavailable, persistence disabled")
  return
}
```

```typescript
// Obsidian plugin
try {
  await this.saveToiCloud(taskData);
} catch (error) {
  console.warn('iCloud save failed, continuing without persistence:', error);
  // Non-fatal: URL parameters still work
}
```

**Scenario:** iCloud sync delay >30s

**Detection:** File read timestamp comparison

**Handling:**
- Show "Sync pending" indicator in app
- Retry read every 10s for up to 2 minutes
- If still no sync, notify user: "iCloud sync delayed. Task state may be outdated."

---

#### 4. Obsidian Integration Errors

**Scenario:** Advanced URI plugin not installed

**Detection:** Obsidian protocol handler not registered

**Handling:**
```typescript
// Check on plugin load
async onload() {
  if (Platform.isMobileApp) {
    const hasAdvancedURI = this.app.plugins.getPlugin('obsidian-advanced-uri');

    if (!hasAdvancedURI) {
      new Notice(
        'Install "Advanced URI" plugin for task tracking to work',
        0 // Persistent notice
      );
      return; // Don't initialize TaskTrackingService
    }
  }
}
```

**Scenario:** File not found during completion

**Detection:** `vault.getAbstractFileByPath()` returns null

**Handling:**
```typescript
async handleCompletion(taskId: string): Promise<void> {
  const file = this.app.vault.getAbstractFileByPath(`${taskId}.md`);

  if (!file) {
    new Notice(`Task file not found: ${taskId}.md. It may have been deleted.`);
    await this.cleariCloudState(); // Clean up orphaned state
    return;
  }

  // ... proceed with completion
}
```

---

#### 5. Network Errors

**Scenario:** Device offline during completion callback

**Detection:** URL open fails (no error thrown, just no response)

**Handling:**
```swift
// Retry logic in companion app
func completeCurrentTask() async throws {
  let callbackURL = try obsidianBridge.buildCompletionURL(...)

  // Try to open Obsidian
  await UIApplication.shared.open(callbackURL)

  // Wait for x-success callback
  let callbackReceived = await waitForCallback(timeout: 10.0)

  if !callbackReceived {
    // Retry once
    await UIApplication.shared.open(callbackURL)
    let retryReceived = await waitForCallback(timeout: 10.0)

    if !retryReceived {
      showAlert(
        title: "Could Not Complete Task",
        message: "Please open Obsidian and manually mark task as Done."
      )
    }
  }
}
```

---

### Error Recovery Matrix

| Error | Detection | User Impact | Recovery | Fallback |
|-------|-----------|-------------|----------|----------|
| App not installed | Timeout | Can't track | Install app | Manual timer |
| Invalid URL | Parse error | No tracking | Show error | Retry |
| Activity quota exceeded | iOS error | No Live Activity | End other activities | In-app timer |
| iCloud unavailable | API nil | No persistence | Continue without iCloud | URL-only mode |
| Advanced URI missing | Plugin check | No completion | Install plugin | Manual status change |
| File deleted | File not found | Orphaned task | Clean up state | N/A |
| Network offline | No callback | Completion delayed | Retry, manual fix | Manual completion |

---

## Deployment Strategy

### Development Environment

**Requirements:**
- Xcode 15.0+ (for iOS 17 SDK)
- macOS 14.0+ (Sonoma)
- iPhone with iOS 16.1+ (physical device for testing)
- Apple Developer Account ($99/year)
- Obsidian mobile app (for testing)

**Setup:**
```bash
# Clone iOS app repo (to be created)
git clone https://github.com/kitelev/exocortex-companion-ios
cd exocortex-companion-ios

# Open in Xcode
open ExocortexCompanion.xcodeproj

# Configure signing
# Xcode → Target → Signing & Capabilities
# - Team: Select your Apple Developer team
# - Bundle ID: com.exocortex.companion
# - Capabilities: Enable "Live Activities"

# Build and run on device
# Xcode → Product → Run (Cmd+R)
# Select connected iPhone as destination
```

---

### Beta Testing (TestFlight)

**Phase 1: Internal Testing (Week 1)**
- Upload beta build to App Store Connect
- Invite 5-10 internal testers
- Collect feedback on:
  - Live Activity appearance
  - Timer accuracy
  - Completion reliability
  - iCloud sync behavior

**Phase 2: External Beta (Week 2-3)**
- Public TestFlight link
- Invite 50-100 external testers
- Provide test script:
  1. Install app
  2. Install Obsidian Advanced URI plugin
  3. Create test Task in Obsidian
  4. Change status to DOING
  5. Verify Live Activity appears
  6. Wait 5 minutes, check timer
  7. Complete task from lock screen
  8. Verify status changed to DONE

**Bug Tracking:**
- GitHub Issues: https://github.com/kitelev/exocortex-companion-ios/issues
- TestFlight feedback form
- Discord community channel (optional)

---

### App Store Submission

**Pre-submission Checklist:**
- [ ] All critical bugs fixed (P0/P1)
- [ ] Privacy policy published
- [ ] App Store screenshots (6.7", 6.5", 5.5" sizes)
- [ ] App description written (English, Russian optional)
- [ ] Keywords optimized (Live Activities, Obsidian, task tracking)
- [ ] Support URL configured
- [ ] App icon (1024x1024)
- [ ] Age rating (4+, no objectionable content)

**Submission Process:**
1. Archive release build (Xcode → Product → Archive)
2. Upload to App Store Connect
3. Complete app metadata
4. Submit for review
5. Wait 1-2 days for review result
6. Address any rejection feedback
7. Resubmit if needed
8. Release publicly (or scheduled release)

**App Store Assets:**

```
Screenshots (required sizes):
- iPhone 6.7" (1290 x 2796): iPhone 14 Pro Max, 15 Pro Max
- iPhone 6.5" (1242 x 2688): iPhone 11 Pro Max, XS Max
- iPhone 5.5" (1242 x 2208): iPhone 8 Plus (legacy)

Content:
1. Lock screen with Live Activity (timer showing)
2. Obsidian integration flow (status change)
3. Completion button interaction
4. App main screen (task list)
5. Settings screen

App Preview (optional):
- 30-second video showing full workflow
- Obsidian → Live Activity → Completion → Obsidian
```

---

### Release Strategy

**Version Numbering:**
- v1.0.0: Initial public release
- v1.0.x: Bug fixes
- v1.x.0: Minor features (pause/resume, history)
- v2.0.0: Major features (multiple tasks, push notifications)

**Release Channels:**
1. **TestFlight (Beta)**: Continuous releases, 2-3 times per week
2. **App Store (Stable)**: Monthly releases, only well-tested builds
3. **GitHub Releases**: Tag each App Store release for reference

**Communication:**
- GitHub Releases: Changelog with features/fixes
- README.md: Update version number, screenshots
- Social media: Announce major releases (optional)

---

### Monitoring & Analytics

**Principles:**
- ❌ No user tracking (privacy-first)
- ❌ No crash reporting (unless user opts in)
- ✅ GitHub Issues for bug reports
- ✅ App Store reviews for feedback

**Optional (with user consent):**
- Crash reporting via Xcode Organizer (anonymous)
- Basic usage metrics (app launches, feature usage) via local logging

---

## Future Enhancements

### Phase 6: Advanced Features (Post-MVP)

#### 1. Pause/Resume Functionality

**User Story:**
As a user, I want to pause task tracking when taking a break, so timer accurately reflects actual work time.

**Design:**
- Add "Pause" button to Live Activity
- Store pause timestamps in iCloud
- Calculate elapsed time = (pauses[i].end - pauses[i].start) sum
- Show "Paused" state in Live Activity

**Complexity:** Medium (2-3 days)

---

#### 2. Multiple Concurrent Tasks

**User Story:**
As a user, I want to track multiple tasks simultaneously (e.g., main task + interruption), so I can context-switch without losing time.

**Design:**
- Support up to 3 concurrent Live Activities
- Carousel UI on lock screen
- Separate iCloud files: `task_1.json`, `task_2.json`, `task_3.json`
- Tap task to expand, tap "Complete" to finish

**Complexity:** High (1-2 weeks)

---

#### 3. Task History & Statistics

**User Story:**
As a user, I want to see my completed tasks and time spent, so I can review my productivity.

**Design:**
- Store completed tasks in `task_history.json` (append-only)
- Add History tab in companion app
- Show: task title, total time, completion date
- Aggregate: total tasks completed, total time this week/month
- Charts: Tasks per day, time distribution

**Complexity:** Medium (3-5 days)

---

#### 4. Dynamic Island Support (iPhone 14 Pro+)

**User Story:**
As an iPhone 14 Pro user, I want to see task timer in Dynamic Island, so it's always visible.

**Design:**
- Implement compact/minimal/expanded Dynamic Island views
- Compact: Timer icon + elapsed time
- Minimal: Timer icon (pill shape)
- Expanded: Full task details + completion button

**Complexity:** Low (1-2 days, already partially implemented)

---

#### 5. Push Notifications Fallback

**User Story:**
As a user, if Live Activity expires, I want a notification reminding me to complete the task.

**Design:**
- Schedule local notification for 8 hours after task start
- Notification: "Task 'Fix bug #123' still running. Complete it?"
- Tap notification → Open Obsidian
- Requires: User permission for notifications

**Complexity:** Medium (2-3 days)

---

#### 6. Apple Watch Complication

**User Story:**
As an Apple Watch user, I want to see task timer on my watch face.

**Design:**
- watchOS app with complication
- Sync via shared iCloud file
- Show timer in complication
- Force Touch → Complete task

**Complexity:** High (1-2 weeks, requires watchOS development)

---

#### 7. Siri Shortcuts Integration

**User Story:**
As a user, I want to say "Hey Siri, complete my task" to finish tracking.

**Design:**
- Expose App Intents: "Start Task", "Complete Current Task"
- Support Shortcuts app automation
- Trigger: Voice, time-based, location-based

**Complexity:** Medium (3-5 days)

---

## References

### Apple Documentation

- [ActivityKit Framework](https://developer.apple.com/documentation/activitykit)
- [WidgetKit Framework](https://developer.apple.com/documentation/widgetkit)
- [Live Activities WWDC23](https://developer.apple.com/videos/play/wwdc2023/10184/)
- [App Intents](https://developer.apple.com/documentation/appintents)
- [URL Schemes](https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app)

### Obsidian Documentation

- [Obsidian Plugin API](https://docs.obsidian.md/)
- [MetadataCache API](https://docs.obsidian.md/Plugins/Metadata+cache)
- [Obsidian URI](https://help.obsidian.md/Extending+Obsidian/Obsidian+URI)
- [Advanced URI Plugin](https://vinzent03.github.io/obsidian-advanced-uri/)

### Exocortex Internal Docs

- [CLAUDE.md](../CLAUDE.md) - Development guidelines
- [API_CONTRACTS.md](./API_CONTRACTS.md) - Service contracts
- [ADR-0005](./adr/0005-effort-voting-system.md) - Effort voting system
- [PROPERTY_SCHEMA.md](./PROPERTY_SCHEMA.md) - Property definitions

### Third-Party Resources

- [Stack Overflow: iOS Live Activities](https://stackoverflow.com/questions/tagged/live-activity)
- [GitHub: Live Activities Examples](https://github.com/1998code/iOS16-Live-Activities)
- [Medium: Building Live Activities](https://medium.com/@ritika_verma/ios-widgets-with-widgetkit-intents-live-activities-31d8e64f070f)

---

## Appendix

### Glossary

| Term | Definition |
|------|------------|
| Live Activity | iOS 16.1+ feature for persistent lock screen notifications with auto-updating content |
| ActivityKit | Apple framework for managing Live Activities lifecycle |
| WidgetKit | Apple framework for rendering widget/Live Activity UI using SwiftUI |
| Dynamic Island | iPhone 14 Pro+ feature for interactive status display in screen cutout area |
| App Intent | iOS mechanism for exposing app actions to Shortcuts, widgets, and Live Activities |
| x-callback-url | URL scheme pattern for bidirectional inter-app communication with success/error callbacks |
| Advanced URI | Obsidian community plugin for extended URL scheme capabilities (frontmatter updates) |
| iCloud Drive | Apple's cloud storage service, accessible from both iOS apps and Obsidian mobile |
| Effort Status | Exocortex property tracking task lifecycle: Draft → Backlog → Analysis → ToDo → **Doing** → Done |

---

### Acronyms

- **API**: Application Programming Interface
- **URI**: Uniform Resource Identifier
- **URL**: Uniform Resource Locator
- **JSON**: JavaScript Object Notation
- **UUID**: Universally Unique Identifier
- **ISO8601**: International date/time format standard
- **MVP**: Minimum Viable Product
- **E2E**: End-to-End (testing)
- **CI/CD**: Continuous Integration / Continuous Deployment
- **WWDC**: Apple Worldwide Developers Conference

---

### Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-01 | Claude Code | Initial specification created |

---

**End of Document**

*This specification is a living document and will be updated as implementation progresses.*

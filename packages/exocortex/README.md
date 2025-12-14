# exocortex

Pure TypeScript business logic for Exocortex knowledge management system.

## Features

- **Zero Dependencies on Obsidian** - Pure business logic that can run anywhere
- **File System Agnostic** - Adapter pattern allows use with any file system (Node.js, Obsidian, browser, etc.)
- **Task Management** - Create tasks from areas, projects, and prototypes
- **Project Management** - Create projects and manage hierarchies
- **Status Workflow** - Complete effort status management (Draft → Backlog → Analysis → ToDo → Doing → Done)
- **Planning** - Plan tasks for specific days with date management
- **Utilities** - Frontmatter manipulation, date formatting, wikilink helpers

## Installation

```bash
npm install exocortex
```

## Usage

### Basic Example

```typescript
import {
  TaskCreationService,
  TaskStatusService,
  PlanningService,
  IFileSystemAdapter
} from 'exocortex';

// Implement IFileSystemAdapter for your platform
class MyFsAdapter implements IFileSystemAdapter {
  // ... implementation
}

const adapter = new MyFsAdapter('/path/to/vault');
const taskService = new TaskCreationService(adapter);
const statusService = new TaskStatusService(adapter);
const planningService = new PlanningService(adapter);

// Create a task
const taskPath = await taskService.createTask(
  'area-file.md',
  { exo__Asset_isDefinedBy: 'my-ontology' },
  'ems__Area',
  'My Task Label'
);

// Change status
await statusService.moveToToDo(taskPath);

// Plan for today
await planningService.planOnToday(taskPath);
```

## Architecture

```
exocortex/
├── domain/              - Business entities and constants
│   ├── constants/       - AssetClass, EffortStatus enums
│   ├── models/          - GraphNode, GraphData, AreaNode
│   └── commands/        - Command visibility logic
├── application/         - Use cases and services
│   └── services/        - TaskCreationService, ProjectCreationService, etc.
└── infrastructure/      - Utilities and interfaces
    ├── interfaces/      - IFileSystemAdapter
    └── utilities/       - FrontmatterService, DateFormatter, etc.
```

## Services

### TaskCreationService

Create tasks from areas, projects, or prototypes.

```typescript
const service = new TaskCreationService(adapter);

// Create from area
await service.createTask(
  'areas/work.md',
  metadata,
  'ems__Area',
  'Task label',
  'small'
);

// Create from prototype
await service.createTask(
  'prototypes/weekly-review.md',
  metadata,
  'ems__TaskPrototype',
  'Review',
  null
);

// Create related task (bidirectional link)
await service.createRelatedTask(
  'tasks/123.md',
  metadata,
  'Subtask label'
);
```

### ProjectCreationService

Create projects from areas or initiatives.

```typescript
const service = new ProjectCreationService(adapter);

await service.createProject(
  'areas/product.md',
  metadata,
  'ems__Area',
  'Q1 Product Launch'
);
```

### TaskStatusService

Manage effort status workflow.

```typescript
const service = new TaskStatusService(adapter);

// Status transitions
await service.setDraftStatus('tasks/123.md');
await service.moveToBacklog('tasks/123.md');
await service.moveToAnalysis('projects/456.md');
await service.moveToToDo('projects/456.md');
await service.startEffort('tasks/123.md');
await service.markTaskAsDone('tasks/123.md');

// Rollback status
await service.rollbackStatus('tasks/123.md');

// Archive
await service.archiveTask('tasks/123.md');
```

### PlanningService

Plan tasks for specific dates.

```typescript
const service = new PlanningService(adapter);

// Plan for today
await service.planOnToday('tasks/123.md');

// Plan for specific date
await service.planOnDate('tasks/123.md', new Date('2025-10-30'));

// Plan for evening
await service.planForEvening('tasks/123.md');

// Shift planning day
await service.shiftDayForward('tasks/123.md');
await service.shiftDayBackward('tasks/123.md');
```

## Utilities

### FrontmatterService

Manipulate YAML frontmatter in markdown files.

```typescript
import { FrontmatterService } from 'exocortex';

const service = new FrontmatterService();

// Parse frontmatter
const result = service.parse(content);

// Update property
const updated = service.updateProperty(
  content,
  'status',
  '"[[StatusDone]]"'
);

// Remove property
const removed = service.removeProperty(content, 'archived');
```

### DateFormatter

Format dates for Exocortex.

```typescript
import { DateFormatter } from 'exocortex';

// Local timestamp: 2025-10-26T14:30:00
const timestamp = DateFormatter.toLocalTimestamp(new Date());

// Wikilink: "[[2025-10-26]]"
const wikilink = DateFormatter.getTodayWikilink();

// Date string: 2025-10-26
const dateStr = DateFormatter.toDateString(new Date());

// Add days
const tomorrow = DateFormatter.addDays(new Date(), 1);
```

## Implementing IFileSystemAdapter

To use Core with your platform, implement the `IFileSystemAdapter` interface:

```typescript
export interface IFileSystemAdapter {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  getFileMetadata(path: string): Promise<Record<string, any>>;
  createFile(path: string, content: string): Promise<string>;
  updateFile(path: string, content: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  directoryExists(path: string): Promise<boolean>;
  getMarkdownFiles(rootPath?: string): Promise<string[]>;
  findFilesByMetadata(query: Record<string, any>): Promise<string[]>;
  findFileByUID(uid: string): Promise<string | null>;
}
```

See `@exocortex/cli` package for Node.js implementation example.

## Constants

### AssetClass

```typescript
enum AssetClass {
  AREA = "ems__Area",
  TASK = "ems__Task",
  PROJECT = "ems__Project",
  MEETING = "ems__Meeting",
  INITIATIVE = "ems__Initiative",
  TASK_PROTOTYPE = "ems__TaskPrototype",
  MEETING_PROTOTYPE = "ems__MeetingPrototype",
  EVENT_PROTOTYPE = "exo__EventPrototype",
  EVENT = "exo__Event",
  DAILY_NOTE = "pn__DailyNote",
  CONCEPT = "ims__Concept"
}
```

### EffortStatus

```typescript
enum EffortStatus {
  DRAFT = "ems__EffortStatusDraft",
  BACKLOG = "ems__EffortStatusBacklog",
  ANALYSIS = "ems__EffortStatusAnalysis",
  TODO = "ems__EffortStatusToDo",
  DOING = "ems__EffortStatusDoing",
  DONE = "ems__EffortStatusDone",
  TRASHED = "ems__EffortStatusTrashed"
}
```

## License

MIT

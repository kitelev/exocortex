# Exocortex API Contracts

**Version**: 1.0
**Last Updated**: 2025-10-26
**Purpose**: Document public interfaces and contracts for all services

---

## 📖 Table of Contents

1. [Service Contracts](#service-contracts)
2. [Utility Contracts](#utility-contracts)
3. [Command Visibility Contracts](#command-visibility-contracts)
4. [Type Definitions](#type-definitions)

---

## 🔧 Service Contracts

### TaskCreationService

**Purpose**: Create Task assets from Areas, Projects, or Prototypes

**Dependencies**: `Vault`

**Public Methods**:

#### `createTask()`

```typescript
async createTask(
  sourceFile: TFile,
  sourceMetadata: Record<string, any>,
  sourceClass: string,
  label?: string,
  taskSize?: string | null,
): Promise<TFile>
```

**Contract**:
- **Input Validation**:
  - `sourceFile` must exist and be readable
  - `sourceClass` must be valid AssetClass (Area, Project, TaskPrototype, MeetingPrototype)
  - `taskSize` must be one of: `S`, `M`, `L`, `XL`, or `null`
- **Output Guarantee**:
  - Returns created `TFile` with UUID-based filename
  - File contains valid frontmatter with all required properties
  - File created in same folder as `sourceFile`
- **Side Effects**:
  - Creates new file in vault
  - Generates UUID for filename
  - Inherits Algorithm section if source is TaskPrototype
- **Error Conditions**:
  - Throws if `sourceFile` not readable
  - Throws if folder doesn't exist and can't be created
  - Throws if file with UUID already exists (extremely rare)

**Example**:
```typescript
const createdFile = await service.createTask(
  areaFile,
  { exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"' },
  AssetClass.AREA,
  "Review PR #123",
  "M"
);
// Returns: TFile with path "path/550e8400-e29b-41d4-a716-446655440000.md"
```

#### `generateTaskFrontmatter()` ✅ PURE

```typescript
generateTaskFrontmatter(
  sourceMetadata: Record<string, any>,
  sourceName: string,
  sourceClass: string,
  label?: string,
  uid?: string,
  taskSize?: string | null,
): Record<string, any>
```

**Contract**:
- **Type**: Pure function (no side effects)
- **Input**: Metadata and source information
- **Output**: Complete frontmatter object
- **Deterministic**: Same inputs → same output
- **Testable**: 100% unit testable without Obsidian

**Generates**:
```javascript
{
  exo__Asset_uid: uid || uuidv4(),
  exo__Asset_label: label || auto-generated,
  exo__Asset_createdAt: ISO 8601 timestamp,
  exo__Asset_isDefinedBy: inherited from sourceMetadata,
  exo__Instance_class: ['"[[ems__Task]]"'],  // From INSTANCE_CLASS_MAP
  ems__Effort_status: '"[[ems__EffortStatusDraft]]"',
  ems__Effort_area: '"[[{sourceName}]]"',  // If sourceClass is Area
  ems__Effort_parent: '"[[{sourceName}]]"',  // If sourceClass is Project
  exo__Asset_prototype: '"[[{sourceName}]]"',  // If sourceClass is Prototype
  ems__Task_size: taskSize || undefined,
  aliases: [label]
}
```

#### `createRelatedTask()`

```typescript
async createRelatedTask(
  taskFile: TFile,
  taskMetadata: Record<string, any>,
  label: string,
  taskSize?: string | null,
): Promise<TFile>
```

**Contract**:
- Creates bidirectional task relationship
- Adds `ems__Effort_relatedTask` to both tasks
- Updates source file frontmatter automatically

---

### ProjectCreationService

**Purpose**: Create Project assets from Areas or Initiatives

**Dependencies**: `Vault`

**Public Methods**:

#### `createProject()`

```typescript
async createProject(
  sourceFile: TFile,
  sourceMetadata: Record<string, any>,
  sourceClass: string,
  label?: string,
  uid?: string,
): Promise<TFile>
```

**Contract**:
- **Input Validation**:
  - `sourceClass` must be Area or Initiative
- **Output Guarantee**:
  - Returns TFile with UUID filename
  - Frontmatter includes `exo__Instance_class: ['"[[ems__Project]]"']`
- **Property Mapping**:
  - From Area → adds `ems__Effort_area`
  - From Initiative → adds `ems__Effort_parent`

#### `generateProjectFrontmatter()` ✅ PURE

```typescript
generateProjectFrontmatter(
  sourceMetadata: Record<string, any>,
  sourceName: string,
  sourceClass: string,
  label?: string,
  uid?: string,
): Record<string, any>
```

**Contract**: Pure function, same pattern as `generateTaskFrontmatter`

---

### ConceptCreationService

**Purpose**: Create Concept assets in knowledge management system

**Dependencies**: `Vault`

**Public Methods**:

#### `createNarrowerConcept()`

```typescript
async createNarrowerConcept(
  parentFile: TFile,
  fileName: string,
  definition: string,
  aliases: string[],
): Promise<TFile>
```

**Contract**:
- **Input Validation**:
  - `parentFile` must be `ims__Concept` type
  - `fileName` must be valid (sanitized if needed)
  - `definition` should not be empty (recommended)
- **Output Guarantee**:
  - Creates file in `concepts/` folder
  - Adds `.md` extension if missing
  - Generates UUID for `exo__Asset_uid`
- **Frontmatter Generated**:
  ```yaml
  exo__Asset_isDefinedBy: "[[!concepts]]"
  exo__Instance_class: ['"[[ims__Concept]]"']
  ims__Concept_broader: "[[{parentFile.basename}]]"
  ims__Concept_definition: {definition}
  aliases: {aliases}
  ```

---

### TaskStatusService

**Purpose**: Manage effort status transitions through workflow

**Dependencies**: `Vault`

**Public Methods**:

#### `moveToTodo()`, `moveToDoing()`, etc.

```typescript
async moveToTodo(taskFile: TFile): Promise<void>
async moveToDoing(taskFile: TFile): Promise<void>
async moveToDone(taskFile: TFile): Promise<void>
async moveToBacklog(taskFile: TFile): Promise<void>
// ... etc for all statuses
```

**Contract**:
- **Input Validation**:
  - File must exist and be readable
  - File must be an Effort (Task/Project/Meeting)
- **Workflow Validation**:
  - Validates transition is allowed (getPreviousStatusFromWorkflow)
  - Projects: must go through ToDo before Doing
  - Tasks: can skip to Doing from Backlog
- **Side Effects**:
  - Updates `ems__Effort_status` property
  - Adds timestamp if transitioning to/from Doing
  - `→ Doing`: Sets `ems__Effort_startTimestamp`
  - `← Doing`: Sets `ems__Effort_endTimestamp`
  - `→ Done`: Sets `ems__Effort_resolutionTimestamp`
- **Error Conditions**:
  - Throws if invalid transition
  - Throws if file not found

**Workflow State Machine**:
```
Draft → Backlog → Analysis → ToDo → Doing → Done
                                ↓
                              Trashed (from any state)
```

#### `getPreviousStatusFromWorkflow()` ✅ PURE

```typescript
private getPreviousStatusFromWorkflow(
  currentStatus: string,
  instanceClass: string | string[] | null,
): string | null | undefined
```

**Contract**:
- **Type**: Pure function
- **Returns**: Expected previous status, `null` if at start, `undefined` if invalid
- **Logic**:
  - For Projects: ToDo → Doing → Done
  - For Tasks: Backlog → Doing → Done (can skip Analysis/ToDo)

---

### EffortVotingService

**Purpose**: Manage vote counting for effort prioritization

**Dependencies**: `Vault`

**Public Methods**:

#### `incrementEffortVotes()`

```typescript
async incrementEffortVotes(effortFile: TFile): Promise<number>
```

**Contract**:
- **Input Validation**:
  - File must be an Effort (Task/Project/Meeting)
  - File must not be archived
- **Output Guarantee**:
  - Returns new vote count after increment
  - Vote count is always integer ≥1
- **Side Effects**:
  - Creates `ems__Effort_votes` property if doesn't exist (starts at 1)
  - Increments existing vote count by 1
  - Preserves Unix (\n) or Windows (\r\n) line endings
- **Frontmatter Handling**:
  - Creates frontmatter if missing
  - Preserves all other properties
  - Maintains property order

**Example**:
```typescript
const newVotes = await service.incrementEffortVotes(taskFile);
// Before: ems__Effort_votes: 3
// After: ems__Effort_votes: 4
// Returns: 4
```

#### `extractVoteCount()` ✅ PURE

```typescript
private extractVoteCount(content: string): number
```

**Contract**:
- Pure function
- Returns current vote count or 0 if property doesn't exist
- Handles both Unix and Windows line endings

---

### PropertyCleanupService

**Purpose**: Remove empty frontmatter properties

**Dependencies**: `Vault`

**Public Methods**:

#### `cleanEmptyProperties()`

```typescript
async cleanEmptyProperties(file: TFile): Promise<void>
```

**Contract**:
- Removes properties with empty values
- **Empty values**: `null`, `undefined`, `""`, `[]`, `{}`
- Preserves non-empty properties
- Updates file in place

#### `removeEmptyPropertiesFromContent()` ✅ PURE

```typescript
private removeEmptyPropertiesFromContent(content: string): string
```

**Contract**:
- Pure function (string → string)
- Returns content with empty properties removed
- Preserves formatting

---

### AreaCreationService

**Purpose**: Create child Area assets

**Dependencies**: `Vault`

**Public Methods**:

#### `createChildArea()`

```typescript
async createChildArea(
  parentFile: TFile,
  parentMetadata: Record<string, any>,
  label?: string,
): Promise<TFile>
```

**Contract**:
- Creates child area with `ems__Area_parent` reference
- Inherits `exo__Asset_isDefinedBy` from parent
- Creates in same folder as parent

---

### LabelToAliasService

**Purpose**: Copy asset label to aliases array

**Dependencies**: `Vault`

**Public Methods**:

#### `copyLabelToAliases()`

```typescript
async copyLabelToAliases(file: TFile): Promise<void>
```

**Contract**:
- Extracts `exo__Asset_label`
- Adds to `aliases` array if not already present
- Creates `aliases` property if missing

---

### SupervisionCreationService

**Purpose**: Create CBT supervision notes

**Dependencies**: `Vault`

**Public Methods**:

#### `createSupervision()`

```typescript
async createSupervision(formData: SupervisionFormData): Promise<TFile>
```

**Contract**:
- Creates supervision note with structured frontmatter
- Generates formatted body content (CBT format)
- Creates in `supervision/` folder

---

### GraphDataService

**Purpose**: Build graph data from all notes

**Dependencies**: `App`, `MetadataCache`

**Public Methods**:

#### `buildGraphData()`

```typescript
async buildGraphData(): Promise<GraphData>
```

**Contract**:
- Scans all markdown files
- Extracts nodes (assets with labels)
- Extracts edges (property references)
- Returns `GraphData` with nodes and edges arrays

---

### AreaHierarchyBuilder

**Purpose**: Build hierarchical tree of areas

**Dependencies**: `Vault`, `MetadataCache`

**Public Methods**:

#### `buildHierarchy()`

```typescript
buildHierarchy(currentAreaFile: TFile | null): AreaNode | null
```

**Contract**:
- Builds tree from current area up to root
- Includes child areas
- Filters archived areas (if setting enabled)

---

### FolderRepairService

**Purpose**: Move files to expected folders based on ontology

**Dependencies**: `Vault`, `MetadataCache`

**Public Methods**:

#### `repairFileLocation()`

```typescript
async repairFileLocation(file: TFile, expectedFolder: string): Promise<void>
```

**Contract**:
- Moves file to expected folder
- Preserves filename
- Updates all WikiLink references automatically (Obsidian feature)

---

### RenameToUidService

**Purpose**: Rename files to UUID format

**Dependencies**: `App.fileManager`

**Public Methods**:

#### `renameToUid()`

```typescript
async renameToUid(file: TFile): Promise<void>
```

**Contract**:
- Renames file to `{exo__Asset_uid}.md`
- Uses `app.fileManager.renameFile()` for proper link updating
- Preserves folder location

---

## 🛠️ Utility Contracts

### FrontmatterService ✅ PURE

**All methods are pure functions (100% testable without Obsidian)**

#### `parse()`

```typescript
parse(content: string): { frontmatter: Record<string, any>; body: string }
```

**Contract**:
- Extracts YAML frontmatter from markdown content
- Returns frontmatter object + body text
- Returns empty object if no frontmatter

#### `updateProperty()`

```typescript
updateProperty(content: string, property: string, value: any): string
```

**Contract**:
- Pure function (no side effects)
- Updates property value in frontmatter
- Creates property if doesn't exist
- Preserves all other properties and formatting

#### `removeProperty()`

```typescript
removeProperty(content: string, property: string): string
```

**Contract**:
- Removes property from frontmatter
- Preserves other properties
- Returns original content if property doesn't exist

#### `getPropertyValue()`

```typescript
getPropertyValue(frontmatterContent: string, property: string): string | null
```

**Contract**:
- Extracts value of property from frontmatter string
- Returns `null` if property doesn't exist
- Pure function

---

### DateFormatter ✅ PURE

**All methods are static pure functions**

#### `toLocalTimestamp()`

```typescript
static toLocalTimestamp(date: Date): string
```

**Contract**:
- Formats date to ISO 8601 local time: `YYYY-MM-DDTHH:mm:ss`
- Uses local timezone (NOT UTC)
- Pads single-digit values with zeros
- Pure, deterministic function

**Example**:
```typescript
DateFormatter.toLocalTimestamp(new Date('2025-10-26T14:30:45'))
// Returns: "2025-10-26T14:30:45"
```

#### `toDateWikilink()`

```typescript
static toDateWikilink(date: Date): string
```

**Contract**:
- Formats date as WikiLink: `YYYY-MM-DD`
- Does NOT include brackets (caller adds them)
- Pure function

**Example**:
```typescript
DateFormatter.toDateWikilink(new Date('2025-10-26'))
// Returns: "2025-10-26"
```

#### `addDays()`

```typescript
static addDays(date: Date, days: number): Date
```

**Contract**:
- Adds/subtracts days from date
- Handles month/year boundaries correctly
- Returns new Date (doesn't mutate input)
- Pure function

---

### WikiLinkHelpers ✅ PURE

**All methods are static pure functions**

#### `normalize()`

```typescript
static normalize(value: string | null | undefined): string
```

**Contract**:
- Removes `[[` `]]` brackets from WikiLinks
- Removes quotes `"` from values
- Returns empty string for `null`/`undefined`
- Pure function

**Examples**:
```typescript
WikiLinkHelpers.normalize('"[[ems__Task]]"')  // Returns: "ems__Task"
WikiLinkHelpers.normalize('[[Area]]')         // Returns: "Area"
WikiLinkHelpers.normalize('Task')             // Returns: "Task"
WikiLinkHelpers.normalize(null)               // Returns: ""
```

#### `normalizeArray()`

```typescript
static normalizeArray(values: string[] | string | null | undefined): string[]
```

**Contract**:
- Normalizes each value in array
- Handles single string value (wraps in array)
- Returns empty array for `null`/`undefined`
- Pure function

#### `equals()`

```typescript
static equals(
  a: string | null | undefined,
  b: string | null | undefined
): boolean
```

**Contract**:
- Compares normalized values (ignores brackets/quotes)
- Pure function
- Case-sensitive

#### `includes()`

```typescript
static includes(
  array: string[] | string | null | undefined,
  value: string
): boolean
```

**Contract**:
- Checks if array includes value (after normalization)
- Handles single string as array
- Returns `false` for `null`/`undefined`

---

### MetadataHelpers ✅ PURE

**All methods are static pure functions**

#### `buildFileContent()`

```typescript
static buildFileContent(
  frontmatter: Record<string, any>,
  bodyContent?: string
): string
```

**Contract**:
- Pure function
- Builds complete markdown file content
- Formats frontmatter as YAML
- Appends body content if provided
- Returns valid markdown string

**Output Format**:
```markdown
---
property1: value1
property2: value2
---

Body content here
```

#### `isAssetArchived()`

```typescript
static isAssetArchived(metadata: Record<string, any>): boolean
```

**Contract**:
- Checks multiple archive properties:
  - `exo__Asset_isArchived`
  - `archived` (Obsidian standard)
- Handles various formats: `true`, `1`, `"true"`, `"yes"`
- Returns `false` if no archive property found
- Pure function

#### `ensureQuoted()`

```typescript
static ensureQuoted(value: string): string
```

**Contract**:
- Adds quotes if not present: `value` → `"value"`
- Preserves existing quotes: `"value"` → `"value"`
- Pure function

---

### EffortSortingHelpers ✅ PURE

#### `sortByPriority()`

```typescript
static sortByPriority<T extends EffortItem>(a: T, b: T): number
```

**Contract**:
- Pure comparison function for `Array.sort()`
- Sorting order:
  1. Non-trashed before trashed
  2. Not-done before done
  3. Higher votes before lower votes ⭐
  4. Earlier start time before later start time
- Returns: `-1`, `0`, or `1` (standard comparator)

**Example**:
```typescript
efforts.sort(EffortSortingHelpers.sortByPriority);
// Result: [active, voted tasks] → [low-voted tasks] → [done tasks] → [trashed]
```

---

### MetadataExtractor

**Purpose**: Extract metadata from Obsidian cache

**Dependencies**: `MetadataCache`

**Public Methods**:

#### `extractCommandVisibilityContext()`

```typescript
extractCommandVisibilityContext(file: TFile): CommandVisibilityContext
```

**Contract**:
- Returns context object for command visibility
- Normalizes WikiLinks
- Checks archive status (multiple formats)
- Returns default values if metadata missing

---

## 🎯 Command Visibility Contracts

### Interface

```typescript
interface CommandVisibilityContext {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  metadata: Record<string, any>;
  isArchived: boolean;
  currentFolder: string;
  expectedFolder: string | null;
}
```

### Visibility Functions (All Pure)

#### `canCreateTask()`

```typescript
export function canCreateTask(context: CommandVisibilityContext): boolean
```

**Contract**:
- Returns `true` if `instanceClass` is Area or Project
- Pure function (no side effects)

#### `canCreateInstance()`

```typescript
export function canCreateInstance(context: CommandVisibilityContext): boolean
```

**Contract**:
- Returns `true` if `instanceClass` is TaskPrototype or MeetingPrototype
- Pure function

#### `canVoteOnEffort()`

```typescript
export function canVoteOnEffort(context: CommandVisibilityContext): boolean
```

**Contract**:
- Returns `true` if asset is Effort AND not archived
- Checks: Task, Project, or Meeting
- Pure function

**All 25+ visibility functions follow same pattern:**
- Input: `CommandVisibilityContext`
- Output: `boolean`
- Type: Pure function (testable without Obsidian)
- Side effects: None

---

## 📐 Type Definitions

### AssetClass (Enum)

```typescript
export enum AssetClass {
  AREA = "ems__Area",
  TASK = "ems__Task",
  PROJECT = "ems__Project",
  MEETING = "ems__Meeting",
  INITIATIVE = "ems__Initiative",
  TASK_PROTOTYPE = "ems__TaskPrototype",
  MEETING_PROTOTYPE = "ems__MeetingPrototype",
  CONCEPT = "ims__Concept",
  DAILY_NOTE = "pn__DailyNote",
}
```

### EffortStatus (Enum)

```typescript
export enum EffortStatus {
  DRAFT = "ems__EffortStatusDraft",
  BACKLOG = "ems__EffortStatusBacklog",
  ANALYSIS = "ems__EffortStatusAnalysis",
  TODO = "ems__EffortStatusToDo",
  DOING = "ems__EffortStatusDoing",
  DONE = "ems__EffortStatusDone",
  TRASHED = "ems__EffortStatusTrashed",
}
```

### LabelInputModalResult

```typescript
export interface LabelInputModalResult {
  label: string | null;
  taskSize: string | null;
}
```

### SupervisionFormData

```typescript
export interface SupervisionFormData {
  situation: string;
  emotions: string;
  thoughts: string;
  behavior: string;
  shortTermConsequences: string;
  longTermConsequences: string;
}
```

---

## ✅ Contract Guarantees

### For Pure Functions (✅ marked)

All pure functions guarantee:
- **No side effects**: Doesn't modify external state
- **Deterministic**: Same inputs → same outputs
- **Testable**: 100% unit testable without mocks
- **Reusable**: Can be used in any context (CLI, Web, Plugin)

### For Services (Obsidian-dependent)

All services guarantee:
- **Input validation**: Check parameters before operations
- **Error handling**: Throw meaningful errors
- **Atomic operations**: Either complete or revert
- **Event consistency**: Obsidian events fire correctly

---

## 🔄 Migration to Core (Issue #122)

### Services → Core (with IFileSystemAdapter)

**Current signature** (Plugin):
```typescript
async createTask(sourceFile: TFile, ...): Promise<TFile>
```

**Future signature** (Core):
```typescript
async createTask(sourceFilePath: string, ...): Promise<string>
```

**Changes**:
- `TFile` → `string` (file path)
- `Vault` → `IFileSystemAdapter` (interface)
- Return `string` (path) instead of `TFile`

### Pure Functions → Core (no changes)

All functions marked ✅ PURE can be copied to Core **as-is**:
- `generateTaskFrontmatter()`
- `generateProjectFrontmatter()`
- All WikiLinkHelpers methods
- All DateFormatter methods
- All MetadataHelpers methods
- All EffortSortingHelpers methods
- All CommandVisibility functions

---

## 🔗 Related Documentation

- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [PROPERTY_SCHEMA.md](./PROPERTY_SCHEMA.md) - Property reference
- Source files in `/src/infrastructure/services/`

---

**Maintainer**: @kitelev
**Related Issues**: #122 (Core Extraction), #123 (Test Coverage), #124 (Architecture Docs)
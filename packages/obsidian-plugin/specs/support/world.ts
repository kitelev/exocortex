import { setWorldConstructor, World, IWorldOptions } from "@cucumber/cucumber";

/**
 * Mock file for testing
 */
export interface MockFile {
  path: string;
  basename: string;
  name: string;
  parent: MockFolder | null;
  stat?: { ctime: number; mtime: number };
}

/**
 * Mock folder for testing
 */
export interface MockFolder {
  path: string;
  name: string;
}

/**
 * Mock frontmatter for testing
 */
export interface MockFrontmatter {
  [key: string]: any;
}

/**
 * Mock note combining file and frontmatter
 */
export interface MockNote {
  file: MockFile;
  frontmatter: MockFrontmatter;
}

/**
 * Sort state interface
 */
export interface SortState {
  column: string;
  direction: "asc" | "desc";
}

/**
 * Custom World for Exocortex BDD tests.
 * Provides a simulated Obsidian environment for testing.
 */
export class ExocortexWorld extends World {
  // Current note being viewed
  public currentNote: MockNote | null = null;

  // All notes in the vault
  public notes: Map<string, MockNote> = new Map();

  // All folders in the vault
  public folders: Map<string, MockFolder> = new Map();

  // Relations map for backlinks
  public relations: Map<string, any> = new Map();

  // Plugin state
  public dataviewInstalled: boolean = true;
  public pluginInitialized: boolean = true;

  // UI state
  public renderedSections: Set<string> = new Set();
  public renderedButtons: Set<string> = new Set();
  public tableRows: any[] = [];
  public areaColumnVisible: boolean = false;

  // Actions performed
  public lastAction: string | null = null;
  public lastClick: { element: string; modifier?: string } | null = null;

  // Results
  public openedFile: MockFile | null = null;
  public openedInNewTab: boolean = false;

  // Effort workflow state
  public pendingCreation: MockNote | null = null;
  public lastCreatedNote: MockNote | null = null;

  // Sorting state
  public sortState: SortState | null = null;
  public sortedRows: any[] = [];

  constructor(options: IWorldOptions) {
    super(options);
  }

  /**
   * Reset all state between scenarios
   */
  reset(): void {
    this.currentNote = null;
    this.notes.clear();
    this.folders.clear();
    this.relations.clear();
    this.dataviewInstalled = true;
    this.pluginInitialized = true;
    this.renderedSections.clear();
    this.renderedButtons.clear();
    this.tableRows = [];
    this.areaColumnVisible = false;
    this.lastAction = null;
    this.lastClick = null;
    this.openedFile = null;
    this.openedInNewTab = false;
    this.pendingCreation = null;
    this.lastCreatedNote = null;
    this.sortState = null;
    this.sortedRows = [];
  }

  /**
   * Create a mock file
   */
  createFile(path: string, frontmatter: MockFrontmatter = {}): MockNote {
    const parts = path.split("/");
    const filename = parts.pop() || "";
    const basename = filename.replace(/\.md$/, "");
    const folderPath = parts.join("/");

    const folder: MockFolder | null = folderPath
      ? { path: folderPath, name: parts[parts.length - 1] || "" }
      : null;

    const file: MockFile = {
      path,
      basename,
      name: filename,
      parent: folder,
      stat: {
        ctime: Date.now(),
        mtime: Date.now(),
      },
    };

    const note: MockNote = { file, frontmatter };
    this.notes.set(path, note);
    return note;
  }

  /**
   * Create a daily note for a specific date
   */
  createDailyNote(date: string): MockNote {
    const path = `Daily Notes/${date}.md`;
    return this.createFile(path, {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: `[[${date}]]`,
    });
  }

  /**
   * Create a task with specified properties
   */
  createTask(name: string, properties: MockFrontmatter = {}): MockNote {
    const path = `Tasks/${name.replace(/\s+/g, "-").toLowerCase()}.md`;
    return this.createFile(path, {
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_label: name,
      ...properties,
    });
  }

  /**
   * Simulate viewing a note
   */
  viewNote(note: MockNote): void {
    this.currentNote = note;
    this.simulateLayoutRendering();
  }

  /**
   * Simulate the layout rendering based on current note
   */
  private simulateLayoutRendering(): void {
    if (!this.currentNote) return;

    const fm = this.currentNote.frontmatter;

    // Check for DailyNote
    if (fm.exo__Instance_class === "[[pn__DailyNote]]") {
      // Always render Properties
      this.renderedSections.add("Properties");

      // Always render Relations
      this.renderedSections.add("Relations");
    } else {
      // Non-DailyNote assets
      this.renderedSections.add("Properties");
      this.renderedSections.add("Relations");
    }

    // Render buttons based on state
    this.updateAvailableButtons();
  }

  /**
   * Update available buttons based on current state
   */
  private updateAvailableButtons(): void {
    this.renderedButtons.clear();

    // Area column toggle
    this.renderedButtons.add("Show Effort Area");

    if (this.areaColumnVisible) {
      this.renderedButtons.delete("Show Effort Area");
      this.renderedButtons.add("Hide Effort Area");
    }
  }

  /**
   * Extract link target from wiki-link format
   */
  extractLinkTarget(link: string): string {
    if (!link) return "";
    const match = link.match(/\[\[(.*?)\]\]/);
    return match ? match[1] : link;
  }

  /**
   * Simulate clicking on an element
   */
  click(element: string, modifier?: string): void {
    this.lastClick = { element, modifier };

    // Handle specific button clicks
    if (element === "Show Effort Area") {
      this.areaColumnVisible = true;
      this.updateAvailableButtons();
    } else if (element === "Hide Effort Area") {
      this.areaColumnVisible = false;
      this.updateAvailableButtons();
    }

    // Handle file opening
    const taskRow = this.tableRows.find((r) => r.name === element);
    if (taskRow) {
      this.openedFile = taskRow.file;
      this.openedInNewTab = modifier === "Cmd";
    }
  }

  /**
   * Resolve area through inheritance chain
   */
  resolveAreaForTask(note: MockNote): string | null {
    // Direct area
    if (note.frontmatter.ems__Effort_area) {
      return this.extractLinkTarget(note.frontmatter.ems__Effort_area);
    }

    // Prototype area
    const protoLink = note.frontmatter.exo__Asset_prototype;
    if (protoLink) {
      const protoPath = this.findNotePath(this.extractLinkTarget(protoLink));
      if (protoPath) {
        const proto = this.notes.get(protoPath);
        if (proto) {
          const protoArea = this.resolveAreaForTask(proto);
          if (protoArea) return protoArea;
        }
      }
    }

    // Parent area
    const parentLink = note.frontmatter.ems__Effort_parent;
    if (parentLink) {
      const parentPath = this.findNotePath(this.extractLinkTarget(parentLink));
      if (parentPath) {
        const parent = this.notes.get(parentPath);
        if (parent && parent.frontmatter.ems__Effort_area) {
          return this.extractLinkTarget(parent.frontmatter.ems__Effort_area);
        }
      }
    }

    return null;
  }

  /**
   * Find a note path by name
   */
  private findNotePath(name: string): string | null {
    for (const [path, note] of this.notes.entries()) {
      if (note.file.basename === name || path.includes(name)) {
        return path;
      }
    }
    return null;
  }

  /**
   * Update buttons for effort workflow
   */
  updateButtonsForCurrentNote(): void {
    this.renderedButtons.clear();

    if (!this.currentNote) return;

    const fm = this.currentNote.frontmatter;
    const status = fm.ems__Effort_status;
    const instanceClass = fm.exo__Instance_class || "";

    // No status → Set Draft Status
    if (!status) {
      this.renderedButtons.add("Set Draft Status");
      return;
    }

    // Draft → To Backlog
    if (status.includes("EffortStatusDraft")) {
      this.renderedButtons.add("To Backlog");
      return;
    }

    // Backlog → Start Effort
    if (status.includes("EffortStatusBacklog")) {
      this.renderedButtons.add("Start Effort");
      return;
    }

    // Doing → Mark Done
    if (status.includes("EffortStatusDoing")) {
      this.renderedButtons.add("Mark Done");
      return;
    }

    // Area/Project → Create Task
    if (instanceClass.includes("ems__Area") || instanceClass.includes("ems__Project")) {
      this.renderedButtons.add("Create Task");
      return;
    }

    // Prototype → Create Instance
    if (instanceClass.includes("Prototype")) {
      this.renderedButtons.add("Create Instance");
      return;
    }
  }

  /**
   * Handle button action for effort workflow
   */
  handleButtonAction(buttonName: string): void {
    if (!this.currentNote) return;

    const fm = this.currentNote.frontmatter;

    switch (buttonName) {
      case "Set Draft Status":
        fm.ems__Effort_status = "[[ems__EffortStatusDraft]]";
        this.updateButtonsForCurrentNote();
        break;

      case "To Backlog":
        fm.ems__Effort_status = "[[ems__EffortStatusBacklog]]";
        this.updateButtonsForCurrentNote();
        break;

      case "Start Effort":
        fm.ems__Effort_status = "[[ems__EffortStatusDoing]]";
        fm.ems__Effort_startTimestamp = new Date().toISOString();
        this.updateButtonsForCurrentNote();
        break;

      case "Mark Done":
        fm.ems__Effort_status = "[[ems__EffortStatusDone]]";
        fm.ems__Effort_endTimestamp = new Date().toISOString();
        this.updateButtonsForCurrentNote();
        break;

      case "Create Task":
        this.pendingCreation = this.createTask("New Task", {
          ems__Effort_status: "[[ems__EffortStatusDraft]]",
          ems__Effort_parent: `[[${this.currentNote.frontmatter.exo__Asset_label}]]`,
          exo__Asset_uid: `uuid-${Date.now()}`,
          exo__Asset_createdAt: new Date().toISOString(),
        });
        this.lastCreatedNote = this.pendingCreation;
        break;

      case "Create Instance":
        const instanceClass = fm.exo__Instance_class?.includes("MeetingPrototype")
          ? "[[ems__Meeting]]"
          : "[[ems__Task]]";

        this.pendingCreation = this.createFile(`Instances/instance-${Date.now()}.md`, {
          exo__Instance_class: instanceClass,
          ems__Effort_status: "[[ems__EffortStatusDraft]]",
          exo__Asset_prototype: `[[${fm.exo__Asset_label}]]`,
          exo__Asset_uid: `uuid-${Date.now()}`,
          exo__Asset_createdAt: new Date().toISOString(),
        });
        this.lastCreatedNote = this.pendingCreation;
        break;

      case "Clean Empty Properties":
        const keysToRemove: string[] = [];
        for (const [key, value] of Object.entries(fm)) {
          if (this.isEmptyValue(value)) {
            keysToRemove.push(key);
          }
        }
        for (const key of keysToRemove) {
          delete fm[key];
        }
        this.renderedButtons.delete("Clean Empty Properties");
        break;
    }
  }

  /**
   * Check if a value is considered empty
   */
  isEmptyValue(value: any): boolean {
    if (value === null || value === undefined) return true;
    if (value === "") return true;
    if (typeof value === "string" && value.trim() === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (typeof value === "object" && Object.keys(value).length === 0) return true;
    return false;
  }

  /**
   * Handle command execution
   */
  handleCommand(commandName: string): void {
    if (!this.currentNote) return;

    if (commandName.includes("Set Draft Status")) {
      this.currentNote.frontmatter.ems__Effort_status = "[[ems__EffortStatusDraft]]";
    } else if (commandName.includes("Move to Backlog") || commandName.includes("To Backlog")) {
      this.currentNote.frontmatter.ems__Effort_status = "[[ems__EffortStatusBacklog]]";
    } else if (commandName.includes("Start Effort")) {
      this.currentNote.frontmatter.ems__Effort_status = "[[ems__EffortStatusDoing]]";
    } else if (commandName.includes("Mark Done")) {
      this.currentNote.frontmatter.ems__Effort_status = "[[ems__EffortStatusDone]]";
    }
  }

  /**
   * Sort table by column
   */
  sortColumn(column: string): void {
    if (this.sortState?.column === column) {
      // Toggle direction
      this.sortState.direction = this.sortState.direction === "asc" ? "desc" : "asc";
    } else {
      this.sortState = { column, direction: "asc" };
    }

    // Sort table rows
    this.sortedRows = [...this.tableRows].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (column) {
        case "Name":
          aVal = (a.name || "").toLowerCase();
          bVal = (b.name || "").toLowerCase();
          break;
        case "Instance Class":
          aVal = (a.instanceClass || "").toLowerCase();
          bVal = (b.instanceClass || "").toLowerCase();
          break;
        case "Status":
          aVal = (a.status || "").toLowerCase();
          bVal = (b.status || "").toLowerCase();
          break;
        case "Start":
          aVal = a.startTime || "";
          bVal = b.startTime || "";
          break;
        default:
          aVal = a[column.toLowerCase()] || "";
          bVal = b[column.toLowerCase()] || "";
      }

      const comparison = String(aVal).localeCompare(String(bVal));
      return this.sortState?.direction === "desc" ? -comparison : comparison;
    });

    this.tableRows = this.sortedRows;
  }
}

setWorldConstructor(ExocortexWorld);

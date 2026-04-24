/**
 * UiOntologyBootstrapper — installs the `ui__RelationColumnSet` ontology
 * (7 files) into a personal vault on plugin load.
 *
 * Closes #2943. Keeps vaults without starter-kit copies functional for
 * `ui__RelationColumnSet` configs — the feature would otherwise require a
 * manual 7-file copy from `kitelev/exocortex-starter-kit`.
 *
 * Idempotency: skip each file already present at its target path. The second
 * call after the first is a no-op. Errors on individual writes do not abort
 * the run; each failure is collected in `result.errors` and the remaining
 * files are still installed.
 */

export interface UiOntologyBootstrapperVault {
  fileExists(path: string): boolean;
  createFile(path: string, content: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}

export interface UiOntologyFile {
  readonly uid: string;
  readonly filename: string;
  readonly content: string;
}

export interface UiOntologyBootstrapResult {
  readonly created: string[];
  readonly skipped: string[];
  readonly errors: Array<{ path: string; error: Error }>;
}

export interface UiOntologyBootstrapperOptions {
  /** Vault-relative folder where the 7 ontology files will be installed. */
  targetFolder?: string;
}

const DEFAULT_TARGET_FOLDER = "_exocortex-ui-ontology";

const UI_ROOT_FILE: UiOntologyFile = {
  uid: "3ee15e1b-3725-4497-9946-df0b67b63f29",
  filename: "3ee15e1b-3725-4497-9946-df0b67b63f29.md",
  content: `---
exo__Asset_uid: 3ee15e1b-3725-4497-9946-df0b67b63f29
exo__Instance_class:
  - "[[829b9b3b-6fc3-4276-be6a-27d3398c012e|exo__Ontology]]"
exo__Asset_label: UI Ontology
aliases:
  - UI Ontology
  - "!ui"
---
`,
};

const CLASS_FILE: UiOntologyFile = {
  uid: "97fc9862-c886-4d86-9a60-e0cf9d778575",
  filename: "97fc9862-c886-4d86-9a60-e0cf9d778575.md",
  content: `---
exo__Asset_isDefinedBy: "[[3ee15e1b-3725-4497-9946-df0b67b63f29|!ui]]"
exo__Asset_uid: 97fc9862-c886-4d86-9a60-e0cf9d778575
exo__Instance_class:
  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9|exo__Class]]"
exo__Asset_label: ui__RelationColumnSet
aliases:
  - ui__RelationColumnSet
exo__Class_description: |
  Ordered set of columns that UniversalLayout should render for one specific
  combination of (row-asset class, referencing property) in the auto-backlinks
  table. Resolver matches via tiered priority ladder:
  (targetClass AND referencingProperty) > (targetClass only) > (referencingProperty only) > default.
  Tiebreaker: ui__RelationColumnSet_priority DESC → exo__Asset_uid ASC.
---
`,
};

const LABEL_PROPERTY_FILE: UiOntologyFile = {
  uid: "3382b5cd-5d4d-4aaa-b55f-d6af85c4ee13",
  filename: "3382b5cd-5d4d-4aaa-b55f-d6af85c4ee13.md",
  content: `---
exo__Asset_isDefinedBy: "[[3ee15e1b-3725-4497-9946-df0b67b63f29|!ui]]"
exo__Asset_uid: 3382b5cd-5d4d-4aaa-b55f-d6af85c4ee13
exo__Instance_class:
  - "[[30d63ce4-e574-456c-8de8-2bf1a53688c1|exo__StringProperty]]"
exo__Asset_label: "ui__RelationColumnSet_label"
rdfs__label: "Relation Column Set Label"
exo__Property_domain: "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]"
exo__Asset_description: "Optional human-readable label used for debugging and logs. Defaults to basename when absent."
---
`,
};

const PRIORITY_PROPERTY_FILE: UiOntologyFile = {
  uid: "7ca5816a-f95a-40bf-ba94-c00081ce3b9f",
  filename: "7ca5816a-f95a-40bf-ba94-c00081ce3b9f.md",
  content: `---
exo__Asset_isDefinedBy: "[[3ee15e1b-3725-4497-9946-df0b67b63f29|!ui]]"
exo__Asset_uid: 7ca5816a-f95a-40bf-ba94-c00081ce3b9f
exo__Instance_class:
  - "[[81c5d3c0-e2f2-4f7d-a19d-de91f414340e|exo__NumberProperty]]"
exo__Asset_label: "ui__RelationColumnSet_priority"
rdfs__label: "Relation Column Set Priority"
exo__Property_domain: "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]"
exo__Asset_description: "Numeric tiebreaker for configs matching on the same tier. Default 0 when absent. Sort order: priority DESC → exo__Asset_uid ASC."
---
`,
};

const TARGET_CLASS_PROPERTY_FILE: UiOntologyFile = {
  uid: "d0aa1baa-be37-4258-b3e7-9f6e5fd63722",
  filename: "d0aa1baa-be37-4258-b3e7-9f6e5fd63722.md",
  content: `---
exo__Asset_isDefinedBy: "[[3ee15e1b-3725-4497-9946-df0b67b63f29|!ui]]"
exo__Asset_uid: d0aa1baa-be37-4258-b3e7-9f6e5fd63722
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: "ui__RelationColumnSet_targetClass"
rdfs__label: "Relation Column Set Target Class"
exo__Property_domain: "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]"
exo__Property_range: "[[8619c4fc-64f1-4869-b17e-e34186cacca9|exo__Class]]"
exo__Asset_description: "Optional class (or array of classes) of row-assets this column set applies to. Multi-class rows — resolver walks declaration-order; first non-null match wins."
---
`,
};

const REFERENCING_PROPERTY_FILE: UiOntologyFile = {
  uid: "d0aa8c6a-dcc4-4c73-883a-9bd5c27a3a31",
  filename: "d0aa8c6a-dcc4-4c73-883a-9bd5c27a3a31.md",
  content: `---
exo__Asset_isDefinedBy: "[[3ee15e1b-3725-4497-9946-df0b67b63f29|!ui]]"
exo__Asset_uid: d0aa8c6a-dcc4-4c73-883a-9bd5c27a3a31
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: "ui__RelationColumnSet_referencingProperty"
rdfs__label: "Relation Column Set Referencing Property"
exo__Property_domain: "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]"
exo__Property_range: "[[38277bfa-d7f9-4a75-b856-b23276ab0db3|exo__Property]]"
exo__Asset_description: "Optional name of the referencing-property group this column set applies to. Normalisation rule: stored as wikilink [[name]], resolver compares normalized (bare identifier) form against raw property name from RelationsRenderer."
---
`,
};

const COLUMNS_PROPERTY_FILE: UiOntologyFile = {
  uid: "dc6da098-db18-4e75-8758-6a7779289d8a",
  filename: "dc6da098-db18-4e75-8758-6a7779289d8a.md",
  content: `---
exo__Asset_isDefinedBy: "[[3ee15e1b-3725-4497-9946-df0b67b63f29|!ui]]"
exo__Asset_uid: dc6da098-db18-4e75-8758-6a7779289d8a
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: "ui__RelationColumnSet_columns"
rdfs__label: "Relation Column Set Columns"
exo__Property_domain: "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]"
exo__Asset_description: "Ordered list of wikilink-references to exo__LayoutColumn assets. Order in frontmatter array IS the render order. Range is exo__LayoutColumn (TypeScript-level concept; no canonical class asset in ontology yet — canonicalisation deferred to Phase 3+ per ADR)."
---
`,
};

/**
 * Static manifest of the 7 ontology files bundled with the plugin.
 *
 * Source-of-truth: `kitelev/exocortex-starter-kit` `ui/` directory
 * (snapshot from PR #86, 2026-04-24 — snake_case labels per Task 3 fix).
 *
 * The `7e2d4e3e-...` MVG fixture (Task ← Project example) is intentionally
 * NOT bundled — it is example data, not ontology. Users create their own
 * `ui__RelationColumnSet` configs once the ontology is installed.
 */
export const UI_ONTOLOGY_FILES: readonly UiOntologyFile[] = [
  UI_ROOT_FILE,
  CLASS_FILE,
  LABEL_PROPERTY_FILE,
  PRIORITY_PROPERTY_FILE,
  TARGET_CLASS_PROPERTY_FILE,
  REFERENCING_PROPERTY_FILE,
  COLUMNS_PROPERTY_FILE,
];

export class UiOntologyBootstrapper {
  private readonly targetFolder: string;

  constructor(
    private readonly vault: UiOntologyBootstrapperVault,
    options: UiOntologyBootstrapperOptions = {},
  ) {
    this.targetFolder = options.targetFolder ?? DEFAULT_TARGET_FOLDER;
  }

  async bootstrap(): Promise<UiOntologyBootstrapResult> {
    const created: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ path: string; error: Error }> = [];

    const pending: Array<{ path: string; content: string }> = [];
    for (const file of UI_ONTOLOGY_FILES) {
      const path = `${this.targetFolder}/${file.filename}`;
      if (this.vault.fileExists(path)) {
        skipped.push(path);
      } else {
        pending.push({ path, content: file.content });
      }
    }

    if (pending.length > 0) {
      await this.vault.ensureFolder(this.targetFolder);
    }

    for (const entry of pending) {
      try {
        await this.vault.createFile(entry.path, entry.content);
        created.push(entry.path);
      } catch (error) {
        errors.push({
          path: entry.path,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return { created, skipped, errors };
  }
}

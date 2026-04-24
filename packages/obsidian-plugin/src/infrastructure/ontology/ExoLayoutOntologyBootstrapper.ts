/**
 * ExoLayoutOntologyBootstrapper — installs the `exo__Layout` ontology
 * (18 files: 4 classes + 14 properties) into a personal vault on plugin load.
 *
 * Phase 4 of RFC exo__Layout (6628d78a-78a9-473c-ace3-e9b6d28750d1).
 *
 * Without this bootstrap, a user who has not manually copied the 18 ontology
 * files from `kitelev/exocortex-starter-kit` `exo/` directory cannot create
 * `exo__Layout` / `exo__BacklinksTableBlock` / `exo__PropertiesBlock` assets —
 * the class and property wikilinks would dangle. The idempotent onLoad install
 * closes that friction point while preserving vaults that already carry the
 * ontology at a non-default folder (starter-kit convention `exo/`).
 *
 * Idempotency (two layers, UUID check first — stronger):
 * 1. `hasAssetWithUid(uid)` — true if a `<uid>.md` file exists anywhere in
 *    the vault. Catches users who have already copied the starter-kit `exo/`
 *    folder to a custom location, and prevents duplicate `exo__Asset_uid`
 *    assets which would break `ExoLayoutRepository` first-seen deduplication.
 * 2. `fileExists(path)` — fallback path-level check at the default target.
 *
 * Mirrors the `UiOntologyBootstrapper` pattern (v15.121.1, closes #2943) —
 * same API, same idempotency semantics, different ontology + different target
 * folder (`_exocortex-exo-layout-ontology`). See the memory entry
 * `reference_obsidian_metadataCache_getFirstLinkpathDest_onload.md` for the
 * O(1) early-onload UID lookup mechanism.
 *
 * Drift guard: the 18 string literals below are verbatim copies of
 * `exocortex-starter-kit/exo/<uid>.md` from PR #87 (commit 84101d3,
 * 2026-04-24). A unit test enforces structural invariants (UUID basename,
 * exo__Asset_isDefinedBy pointing at the !exo root, class/subclass/property
 * shape). Any manual edit to these literals must be mirrored in the
 * starter-kit repository — if a future change ships via starter-kit first,
 * regenerate this bundle.
 */

export interface ExoLayoutOntologyBootstrapperVault {
  /**
   * True iff a `.md` file whose basename equals this UUID exists anywhere
   * in the vault. Stronger than path-level `fileExists` — catches legacy
   * copies at non-default folders (starter-kit `exo/`, custom paths, etc.)
   * and prevents duplicate `exo__Asset_uid` assets on upgrade.
   */
  hasAssetWithUid(uid: string): boolean;
  fileExists(path: string): boolean;
  createFile(path: string, content: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}

export interface ExoLayoutOntologyFile {
  readonly uid: string;
  readonly filename: string;
  readonly content: string;
}

export interface ExoLayoutOntologyBootstrapResult {
  readonly created: string[];
  readonly skipped: string[];
  readonly errors: Array<{ path: string; error: Error }>;
}

export interface ExoLayoutOntologyBootstrapperOptions {
  /** Vault-relative folder where the 18 ontology files will be installed. */
  targetFolder?: string;
}

const DEFAULT_TARGET_FOLDER = "_exocortex-exo-layout-ontology";

// ----------------------------------------------------------------------------
// 4 classes
// ----------------------------------------------------------------------------

const LAYOUT_CLASS: ExoLayoutOntologyFile = {
  uid: "08d00289-a5c8-4df1-8885-40a00a014004",
  filename: "08d00289-a5c8-4df1-8885-40a00a014004.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 08d00289-a5c8-4df1-8885-40a00a014004
exo__Instance_class:
  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"
exo__Asset_label: exo__Layout
aliases:
  - exo__Layout
---
`,
};

const LAYOUT_BLOCK_CLASS: ExoLayoutOntologyFile = {
  uid: "6bca6f8d-2a2b-4f38-8e20-97727499009e",
  filename: "6bca6f8d-2a2b-4f38-8e20-97727499009e.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 6bca6f8d-2a2b-4f38-8e20-97727499009e
exo__Instance_class:
  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"
exo__Asset_label: exo__LayoutBlock
aliases:
  - exo__LayoutBlock
---
`,
};

const BACKLINKS_TABLE_BLOCK_CLASS: ExoLayoutOntologyFile = {
  uid: "2e868956-d81e-43fd-9817-1addde9cb311",
  filename: "2e868956-d81e-43fd-9817-1addde9cb311.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 2e868956-d81e-43fd-9817-1addde9cb311
exo__Instance_class:
  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"
exo__Asset_label: exo__BacklinksTableBlock
aliases:
  - exo__BacklinksTableBlock
rdfs__subClassOf: "[[6bca6f8d-2a2b-4f38-8e20-97727499009e|exo__LayoutBlock]]"
---
`,
};

const PROPERTIES_BLOCK_CLASS: ExoLayoutOntologyFile = {
  uid: "fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe",
  filename: "fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe
exo__Instance_class:
  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"
exo__Asset_label: exo__PropertiesBlock
aliases:
  - exo__PropertiesBlock
rdfs__subClassOf: "[[6bca6f8d-2a2b-4f38-8e20-97727499009e|exo__LayoutBlock]]"
---
`,
};

// ----------------------------------------------------------------------------
// 4 Layout_* properties
// ----------------------------------------------------------------------------

const LAYOUT_TARGET_CLASS: ExoLayoutOntologyFile = {
  uid: "c062eb14-e21a-44f9-a490-6f9773e0a93d",
  filename: "c062eb14-e21a-44f9-a490-6f9773e0a93d.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: c062eb14-e21a-44f9-a490-6f9773e0a93d
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: exo__Layout_targetClass
aliases:
  - exo__Layout_targetClass
  - Layout Target Class
---
`,
};

const LAYOUT_PRIORITY: ExoLayoutOntologyFile = {
  uid: "f39f69bb-24e4-4f21-aa4c-5fe6a69dd4e6",
  filename: "f39f69bb-24e4-4f21-aa4c-5fe6a69dd4e6.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: f39f69bb-24e4-4f21-aa4c-5fe6a69dd4e6
exo__Instance_class:
  - "[[81c5d3c0-e2f2-4f7d-a19d-de91f414340e|exo__NumberProperty]]"
exo__Asset_label: exo__Layout_priority
aliases:
  - exo__Layout_priority
  - Layout Priority
---
`,
};

const LAYOUT_BLOCKS: ExoLayoutOntologyFile = {
  uid: "d1d19227-937b-4761-89a6-e2f665716262",
  filename: "d1d19227-937b-4761-89a6-e2f665716262.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: d1d19227-937b-4761-89a6-e2f665716262
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: exo__Layout_blocks
aliases:
  - exo__Layout_blocks
  - Layout Blocks
---
`,
};

const LAYOUT_COEXISTS_WITH_DEFAULT: ExoLayoutOntologyFile = {
  uid: "11db753b-df28-46e1-91eb-acea7ca2f9c8",
  filename: "11db753b-df28-46e1-91eb-acea7ca2f9c8.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 11db753b-df28-46e1-91eb-acea7ca2f9c8
exo__Instance_class:
  - "[[30d63ce4-e574-456c-8de8-2bf1a53688c1|exo__StringProperty]]"
exo__Asset_label: exo__Layout_coexistsWithDefault
aliases:
  - exo__Layout_coexistsWithDefault
  - Layout Coexists With Default
---
`,
};

// ----------------------------------------------------------------------------
// 3 LayoutBlock_* properties
// ----------------------------------------------------------------------------

const LAYOUT_BLOCK_TITLE: ExoLayoutOntologyFile = {
  uid: "a3df1733-a66d-40ab-8a71-acca4886609a",
  filename: "a3df1733-a66d-40ab-8a71-acca4886609a.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: a3df1733-a66d-40ab-8a71-acca4886609a
exo__Instance_class:
  - "[[30d63ce4-e574-456c-8de8-2bf1a53688c1|exo__StringProperty]]"
exo__Asset_label: exo__LayoutBlock_title
aliases:
  - exo__LayoutBlock_title
  - Layout Block Title
---
`,
};

const LAYOUT_BLOCK_TYPE: ExoLayoutOntologyFile = {
  uid: "5f48b45b-fdc7-44ef-8846-f3ffd70665fc",
  filename: "5f48b45b-fdc7-44ef-8846-f3ffd70665fc.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 5f48b45b-fdc7-44ef-8846-f3ffd70665fc
exo__Instance_class:
  - "[[30d63ce4-e574-456c-8de8-2bf1a53688c1|exo__StringProperty]]"
exo__Asset_label: exo__LayoutBlock_type
aliases:
  - exo__LayoutBlock_type
  - Layout Block Type
---
`,
};

const LAYOUT_BLOCK_COLLAPSED: ExoLayoutOntologyFile = {
  uid: "5b52a2aa-f5ea-48bb-a1c5-728d59bb805f",
  filename: "5b52a2aa-f5ea-48bb-a1c5-728d59bb805f.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 5b52a2aa-f5ea-48bb-a1c5-728d59bb805f
exo__Instance_class:
  - "[[30d63ce4-e574-456c-8de8-2bf1a53688c1|exo__StringProperty]]"
exo__Asset_label: exo__LayoutBlock_collapsed
aliases:
  - exo__LayoutBlock_collapsed
  - Layout Block Collapsed
---
`,
};

// ----------------------------------------------------------------------------
// 7 BacklinksTableBlock_* properties
// ----------------------------------------------------------------------------

const BACKLINKS_ROW_CLASS: ExoLayoutOntologyFile = {
  uid: "07bc2f29-abde-43ed-9b7a-72b67114cf54",
  filename: "07bc2f29-abde-43ed-9b7a-72b67114cf54.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 07bc2f29-abde-43ed-9b7a-72b67114cf54
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: exo__BacklinksTableBlock_rowClass
aliases:
  - exo__BacklinksTableBlock_rowClass
  - Backlinks Row Class
---
`,
};

const BACKLINKS_REFERENCING_PROPERTY: ExoLayoutOntologyFile = {
  uid: "76bb0bde-d692-41c4-88ab-7637bf0c7e54",
  filename: "76bb0bde-d692-41c4-88ab-7637bf0c7e54.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 76bb0bde-d692-41c4-88ab-7637bf0c7e54
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: exo__BacklinksTableBlock_referencingProperty
aliases:
  - exo__BacklinksTableBlock_referencingProperty
  - Backlinks Referencing Property
---
`,
};

const BACKLINKS_COLUMNS: ExoLayoutOntologyFile = {
  uid: "42c32853-c8e4-462d-b927-6d16d962aa3e",
  filename: "42c32853-c8e4-462d-b927-6d16d962aa3e.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 42c32853-c8e4-462d-b927-6d16d962aa3e
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: exo__BacklinksTableBlock_columns
aliases:
  - exo__BacklinksTableBlock_columns
  - Backlinks Columns
---
`,
};

const BACKLINKS_SORT_BY: ExoLayoutOntologyFile = {
  uid: "05a5f768-298f-4561-aad5-31c8c326eece",
  filename: "05a5f768-298f-4561-aad5-31c8c326eece.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 05a5f768-298f-4561-aad5-31c8c326eece
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"
exo__Asset_label: exo__BacklinksTableBlock_sortBy
aliases:
  - exo__BacklinksTableBlock_sortBy
  - Backlinks Sort By
---
`,
};

const BACKLINKS_SORT_ORDER: ExoLayoutOntologyFile = {
  uid: "cb70ba11-6e07-4fbb-a38f-afd0c6ecff02",
  filename: "cb70ba11-6e07-4fbb-a38f-afd0c6ecff02.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: cb70ba11-6e07-4fbb-a38f-afd0c6ecff02
exo__Instance_class:
  - "[[30d63ce4-e574-456c-8de8-2bf1a53688c1|exo__StringProperty]]"
exo__Asset_label: exo__BacklinksTableBlock_sortOrder
aliases:
  - exo__BacklinksTableBlock_sortOrder
  - Backlinks Sort Order
---
`,
};

const BACKLINKS_LIMIT: ExoLayoutOntologyFile = {
  uid: "498a804d-e925-4cec-a392-1b1a6d4bd3d1",
  filename: "498a804d-e925-4cec-a392-1b1a6d4bd3d1.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 498a804d-e925-4cec-a392-1b1a6d4bd3d1
exo__Instance_class:
  - "[[81c5d3c0-e2f2-4f7d-a19d-de91f414340e|exo__NumberProperty]]"
exo__Asset_label: exo__BacklinksTableBlock_limit
aliases:
  - exo__BacklinksTableBlock_limit
  - Backlinks Limit
---
`,
};

const BACKLINKS_SHOW_ARCHIVED: ExoLayoutOntologyFile = {
  uid: "3ef3ddca-560e-4b6c-9e1f-deb8a28f9438",
  filename: "3ef3ddca-560e-4b6c-9e1f-deb8a28f9438.md",
  content: `---
exo__Asset_isDefinedBy: "[[ca97bb2f-99bd-4ceb-b51e-c386b9231ae3]]"
exo__Asset_uid: 3ef3ddca-560e-4b6c-9e1f-deb8a28f9438
exo__Instance_class:
  - "[[30d63ce4-e574-456c-8de8-2bf1a53688c1|exo__StringProperty]]"
exo__Asset_label: exo__BacklinksTableBlock_showArchived
aliases:
  - exo__BacklinksTableBlock_showArchived
  - Backlinks Show Archived
---
`,
};

/**
 * Static manifest of the 18 `exo__Layout` ontology files bundled with the
 * plugin.
 *
 * Source-of-truth: `kitelev/exocortex-starter-kit` `exo/` directory
 * (snapshot from PR #87 / commit 84101d3, 2026-04-24).
 *
 * Layout: 4 classes + 14 properties. Classes carry `exo__Class` instance
 * (8619c4fc); subclasses (BacklinksTableBlock, PropertiesBlock) also carry
 * `rdfs__subClassOf: [[6bca6f8d|exo__LayoutBlock]]`. Properties carry one
 * of `exo__ObjectProperty` / `exo__StringProperty` / `exo__NumberProperty`
 * via `exo__Instance_class`. All 18 reference the `!exo` ontology root
 * `ca97bb2f-99bd-4ceb-b51e-c386b9231ae3` via `exo__Asset_isDefinedBy`.
 */
export const EXO_LAYOUT_ONTOLOGY_FILES: readonly ExoLayoutOntologyFile[] = [
  // 4 classes
  LAYOUT_CLASS,
  LAYOUT_BLOCK_CLASS,
  BACKLINKS_TABLE_BLOCK_CLASS,
  PROPERTIES_BLOCK_CLASS,
  // 4 Layout_* properties
  LAYOUT_TARGET_CLASS,
  LAYOUT_PRIORITY,
  LAYOUT_BLOCKS,
  LAYOUT_COEXISTS_WITH_DEFAULT,
  // 3 LayoutBlock_* properties
  LAYOUT_BLOCK_TITLE,
  LAYOUT_BLOCK_TYPE,
  LAYOUT_BLOCK_COLLAPSED,
  // 7 BacklinksTableBlock_* properties
  BACKLINKS_ROW_CLASS,
  BACKLINKS_REFERENCING_PROPERTY,
  BACKLINKS_COLUMNS,
  BACKLINKS_SORT_BY,
  BACKLINKS_SORT_ORDER,
  BACKLINKS_LIMIT,
  BACKLINKS_SHOW_ARCHIVED,
];

export class ExoLayoutOntologyBootstrapper {
  private readonly targetFolder: string;

  constructor(
    private readonly vault: ExoLayoutOntologyBootstrapperVault,
    options: ExoLayoutOntologyBootstrapperOptions = {},
  ) {
    this.targetFolder = options.targetFolder ?? DEFAULT_TARGET_FOLDER;
  }

  async bootstrap(): Promise<ExoLayoutOntologyBootstrapResult> {
    const created: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ path: string; error: Error }> = [];

    const pending: Array<{ path: string; content: string }> = [];
    for (const file of EXO_LAYOUT_ONTOLOGY_FILES) {
      const path = `${this.targetFolder}/${file.filename}`;
      if (this.vault.hasAssetWithUid(file.uid) || this.vault.fileExists(path)) {
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

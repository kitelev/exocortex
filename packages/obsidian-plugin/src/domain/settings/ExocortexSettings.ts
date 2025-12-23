export interface ExocortexSettings {
  showPropertiesSection: boolean;
  layoutVisible: boolean;
  showArchivedAssets: boolean;
  activeFocusArea: string | null;
  showEffortArea: boolean;
  showEffortVotes: boolean;
  defaultOntologyAsset: string | null;
  showFullDateInEffortTimes: boolean;
  showDailyNoteProjects: boolean;
  useDynamicPropertyFields: boolean;
  showLabelsInFileExplorer: boolean;
  showLabelsInTabTitles: boolean;
  displayNameTemplate: string;
  sortByDisplayName: boolean;
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: ExocortexSettings = {
  showPropertiesSection: true,
  layoutVisible: true,
  showArchivedAssets: false,
  activeFocusArea: null,
  showEffortArea: false,
  showEffortVotes: false,
  defaultOntologyAsset: null,
  showFullDateInEffortTimes: false,
  showDailyNoteProjects: true,
  useDynamicPropertyFields: false,
  showLabelsInFileExplorer: true,
  showLabelsInTabTitles: true,
  displayNameTemplate: "{{exo__Asset_label}}",
  sortByDisplayName: false,
};

export enum LayoutSection {
  BUTTONS = "buttons",
  DAILY_TASKS = "daily-tasks",
  AREA_TREE = "area-tree",
  RELATIONS = "relations",
}

export class PropertyDependencyResolver {
  private static PROPERTY_DEPENDENCIES: Record<string, LayoutSection[]> = {
    "exo__Asset_label": [
      LayoutSection.RELATIONS,
      LayoutSection.AREA_TREE,
    ],
    "exo__Instance_class": [
      LayoutSection.BUTTONS,
      LayoutSection.RELATIONS,
    ],
    "exo__Asset_isArchived": [
      LayoutSection.BUTTONS,
      LayoutSection.DAILY_TASKS,
      LayoutSection.RELATIONS,
    ],
    "exo__Asset_prototype": [LayoutSection.RELATIONS],

    "ems__Effort_status": [
      LayoutSection.BUTTONS,
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_votes": [
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_day": [
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_area": [
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_parent": [
      LayoutSection.RELATIONS,
    ],

    "ems__Area_parent": [
      LayoutSection.AREA_TREE,
    ],

    "ems__Task_size": [
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Task_blockedBy": [
      LayoutSection.DAILY_TASKS,
      LayoutSection.RELATIONS,
    ],
    "ems__Task_blocks": [
      LayoutSection.RELATIONS,
    ],

    "ems__Project_blockedBy": [
      LayoutSection.RELATIONS,
    ],
    "ems__Project_blocks": [
      LayoutSection.RELATIONS,
    ],

    "pn__DailyNote_day": [
      LayoutSection.DAILY_TASKS,
    ],

    "ims__Concept_broader": [
      LayoutSection.RELATIONS,
    ],
    "ims__Concept_narrower": [
      LayoutSection.RELATIONS,
    ],
    "ims__Concept_related": [
      LayoutSection.RELATIONS,
    ],

    aliases: [
      LayoutSection.RELATIONS,
      LayoutSection.AREA_TREE,
    ],
  };

  getAffectedSections(changedProperties: string[]): LayoutSection[] {
    const affectedSections = new Set<LayoutSection>();

    for (const prop of changedProperties) {
      const sections = PropertyDependencyResolver.PROPERTY_DEPENDENCIES[prop];
      if (sections) {
        sections.forEach((section) => affectedSections.add(section));
      }
    }

    return Array.from(affectedSections);
  }
}

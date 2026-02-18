export enum LayoutSection {
  PROPERTIES = "properties",
  BUTTONS = "buttons",
  DAILY_TASKS = "daily-tasks",
  AREA_TREE = "area-tree",
  RELATIONS = "relations",
}

export class PropertyDependencyResolver {
  private static PROPERTY_DEPENDENCIES: Record<string, LayoutSection[]> = {
    "exo__Asset_label": [
      LayoutSection.PROPERTIES,
      LayoutSection.RELATIONS,
      LayoutSection.AREA_TREE,
    ],
    "exo__Instance_class": [
      LayoutSection.PROPERTIES,
      LayoutSection.BUTTONS,
      LayoutSection.RELATIONS,
    ],
    "exo__Asset_isArchived": [
      LayoutSection.PROPERTIES,
      LayoutSection.BUTTONS,
      LayoutSection.DAILY_TASKS,
      LayoutSection.RELATIONS,
    ],
    "exo__Asset_createdAt": [LayoutSection.PROPERTIES],
    "exo__Asset_uid": [LayoutSection.PROPERTIES],
    "exo__Asset_prototype": [LayoutSection.PROPERTIES, LayoutSection.RELATIONS],

    "ems__Effort_status": [
      LayoutSection.PROPERTIES,
      LayoutSection.BUTTONS,
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_votes": [
      LayoutSection.PROPERTIES,
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_day": [
      LayoutSection.PROPERTIES,
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_area": [
      LayoutSection.PROPERTIES,
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_parent": [
      LayoutSection.PROPERTIES,
      LayoutSection.RELATIONS,
    ],
    "ems__Effort_startTimestamp": [LayoutSection.PROPERTIES],
    "ems__Effort_endTimestamp": [LayoutSection.PROPERTIES],
    "ems__Effort_resolutionTimestamp": [LayoutSection.PROPERTIES],
    "ems__Effort_lastModified": [LayoutSection.PROPERTIES],
    "ems__Effort_originDate": [LayoutSection.PROPERTIES],

    "ems__Area_parent": [
      LayoutSection.PROPERTIES,
      LayoutSection.AREA_TREE,
    ],

    "ems__Task_size": [
      LayoutSection.PROPERTIES,
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Task_blockedBy": [
      LayoutSection.PROPERTIES,
      LayoutSection.DAILY_TASKS,
      LayoutSection.RELATIONS,
    ],
    "ems__Task_blocks": [
      LayoutSection.PROPERTIES,
      LayoutSection.RELATIONS,
    ],

    "ems__Project_blockedBy": [
      LayoutSection.PROPERTIES,
      LayoutSection.RELATIONS,
    ],
    "ems__Project_blocks": [
      LayoutSection.PROPERTIES,
      LayoutSection.RELATIONS,
    ],

    "pn__DailyNote_day": [
      LayoutSection.PROPERTIES,
      LayoutSection.DAILY_TASKS,
    ],

    "ims__Concept_broader": [
      LayoutSection.PROPERTIES,
      LayoutSection.RELATIONS,
    ],
    "ims__Concept_narrower": [
      LayoutSection.PROPERTIES,
      LayoutSection.RELATIONS,
    ],
    "ims__Concept_related": [
      LayoutSection.PROPERTIES,
      LayoutSection.RELATIONS,
    ],

    aliases: [
      LayoutSection.PROPERTIES,
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
      } else {
        affectedSections.add(LayoutSection.PROPERTIES);
      }
    }

    return Array.from(affectedSections);
  }
}

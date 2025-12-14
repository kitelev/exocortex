import { injectable } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { DateFormatter } from "../utilities/DateFormatter";
import { WikiLinkHelpers } from "../utilities/WikiLinkHelpers";
import { MetadataExtractor } from "../utilities/MetadataExtractor";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import { AssetClass } from "../domain/constants";
import { isPrototypeClass } from "../domain/commands/visibility/helpers";

const EFFORT_PROPERTY_MAP: Record<string, string> = {
  [AssetClass.AREA]: "ems__Effort_area",
  [AssetClass.PROJECT]: "ems__Effort_parent",
  [AssetClass.TASK_PROTOTYPE]: "exo__Asset_prototype",
  [AssetClass.MEETING_PROTOTYPE]: "exo__Asset_prototype",
  [AssetClass.EVENT_PROTOTYPE]: "exo__Asset_prototype",
  [AssetClass.PROJECT_PROTOTYPE]: "exo__Asset_prototype",
};

const INSTANCE_CLASS_MAP: Record<string, string> = {
  [AssetClass.AREA]: AssetClass.TASK,
  [AssetClass.PROJECT]: AssetClass.TASK,
  [AssetClass.TASK_PROTOTYPE]: AssetClass.TASK,
  [AssetClass.MEETING_PROTOTYPE]: AssetClass.MEETING,
  [AssetClass.EVENT_PROTOTYPE]: AssetClass.EVENT,
  [AssetClass.PROJECT_PROTOTYPE]: AssetClass.PROJECT,
};

@injectable()
export class TaskFrontmatterGenerator {
  generateTaskFrontmatter(
    sourceMetadata: Record<string, any>,
    sourceName: string,
    sourceClass: string,
    label?: string,
    uid?: string,
    taskSize?: string | null,
    plannedStartTimestamp?: string,
  ): Record<string, any> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const isDefinedBy = MetadataExtractor.extractIsDefinedBy(sourceMetadata);

    const cleanSourceClass = WikiLinkHelpers.normalize(sourceClass);
    const effortProperty = EFFORT_PROPERTY_MAP[cleanSourceClass];
    const instanceClass =
      INSTANCE_CLASS_MAP[cleanSourceClass] || AssetClass.TASK;

    const frontmatter: Record<string, any> = {};
    frontmatter["exo__Asset_isDefinedBy"] =
      MetadataHelpers.ensureQuoted(isDefinedBy);
    frontmatter["exo__Asset_uid"] = uid || uuidv4();
    frontmatter["exo__Asset_createdAt"] = timestamp;
    frontmatter["exo__Instance_class"] = [`"[[${instanceClass}]]"`];
    frontmatter["ems__Effort_status"] = '"[[ems__EffortStatusDraft]]"';

    if (effortProperty) {
      frontmatter[effortProperty] = `"[[${sourceName}]]"`;
    } else if (isPrototypeClass(sourceClass, sourceMetadata)) {
      // For custom prototype classes that inherit from exo__Prototype,
      // set exo__Asset_prototype to link instance back to its prototype
      frontmatter["exo__Asset_prototype"] = `"[[${sourceName}]]"`;
    }

    let finalLabel = label;
    if (
      instanceClass === AssetClass.MEETING &&
      (!label || label.trim() === "")
    ) {
      const baseLabel = sourceMetadata.exo__Asset_label || sourceName;
      const dateStr = DateFormatter.toDateString(now);
      finalLabel = `${baseLabel} ${dateStr}`;
    }

    if (finalLabel && finalLabel.trim() !== "") {
      const trimmedLabel = finalLabel.trim();
      frontmatter["exo__Asset_label"] = trimmedLabel;
      frontmatter["aliases"] = [trimmedLabel];
    }

    if (taskSize) {
      frontmatter["ems__Task_size"] = taskSize;
    }

    if (plannedStartTimestamp) {
      frontmatter["ems__Effort_plannedStartTimestamp"] = plannedStartTimestamp;
    }

    return frontmatter;
  }

  generateRelatedTaskFrontmatter(
    sourceMetadata: Record<string, any>,
    sourceName: string,
    label?: string,
    uid?: string,
    taskSize?: string | null,
  ): Record<string, any> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const isDefinedBy = MetadataExtractor.extractIsDefinedBy(sourceMetadata);

    const frontmatter: Record<string, any> = {};
    frontmatter["exo__Asset_isDefinedBy"] =
      MetadataHelpers.ensureQuoted(isDefinedBy);
    frontmatter["exo__Asset_uid"] = uid || uuidv4();
    frontmatter["exo__Asset_createdAt"] = timestamp;
    frontmatter["exo__Instance_class"] = [`"[[${AssetClass.TASK}]]"`];
    frontmatter["ems__Effort_status"] = '"[[ems__EffortStatusDraft]]"';
    frontmatter["exo__Asset_relates"] = [`"[[${sourceName}]]"`];

    if (label && label.trim() !== "") {
      const trimmedLabel = label.trim();
      frontmatter["exo__Asset_label"] = trimmedLabel;
      frontmatter["aliases"] = [trimmedLabel];
    }

    if (taskSize) {
      frontmatter["ems__Task_size"] = taskSize;
    }

    return frontmatter;
  }
}

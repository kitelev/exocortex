import { ActionButton } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  canCreateTask,
  canCreateProject,
  canCreateChildArea,
  canCreateInstance,
  canCreateRelatedTask,
  canCreateNarrowerConcept,
  canCreateSubclass,
  canCreateTaskForDailyNote,
  WikiLinkHelpers,
  AssetClass,
  DateFormatter,
} from "exocortex";
import {
  NarrowerConceptModal,
  type NarrowerConceptModalResult,
} from '@plugin/presentation/modals/NarrowerConceptModal';
import {
  SubclassCreationModal,
  type SubclassCreationModalResult,
} from '@plugin/presentation/modals/SubclassCreationModal';
import {
  IButtonGroupBuilder,
  ButtonBuilderContext,
  ButtonBuilderServices,
} from "./ButtonBuilderTypes";
import { openCreatedFile, promptForLabel } from "./FileCreationHelper";

/**
 * Builds creation-related buttons (Create Task, Create Project, etc.)
 */
export class CreationButtonGroupBuilder implements IButtonGroupBuilder {
  constructor(private services: ButtonBuilderServices) {}

  getGroupId(): string {
    return "creation";
  }

  getGroupTitle(): string {
    return "Creation";
  }

  build(context: ButtonBuilderContext): ActionButton[] {
    const { app, file, metadata, instanceClass, visibilityContext, logger } = context;
    const { taskCreationService, projectCreationService, areaCreationService,
            classCreationService, conceptCreationService } = this.services;

    return [
      // Create Task
      {
        id: "create-task",
        label: "Create Task",
        variant: "primary",
        visible: canCreateTask(visibilityContext),
        onClick: async () => {
          const result = await promptForLabel(app);
          if (result.label === null) return;
          const sourceClass = this.normalizeClass(instanceClass);
          const created = await taskCreationService.createTask(
            file, metadata, sourceClass, result.label, result.taskSize);
          await openCreatedFile(app, created, { openInNewTab: result.openInNewTab },
            logger, `Created Task from ${sourceClass}: ${created.path}`);
        },
      },
      // Create Project
      {
        id: "create-project",
        label: "Create Project",
        variant: "primary",
        visible: canCreateProject(visibilityContext),
        onClick: async () => {
          const result = await promptForLabel(app);
          if (result.label === null) return;
          const sourceClass = this.normalizeClass(instanceClass);
          const created = await projectCreationService.createProject(
            file, metadata, sourceClass, result.label);
          await openCreatedFile(app, created, { openInNewTab: result.openInNewTab },
            logger, `Created Project from ${sourceClass}: ${created.path}`);
        },
      },
      // Create Area
      {
        id: "create-area",
        label: "Create Area",
        variant: "primary",
        visible: canCreateChildArea(visibilityContext),
        onClick: async () => {
          const result = await promptForLabel(app);
          if (result.label === null) return;
          const created = await areaCreationService.createChildArea(file, metadata, result.label);
          await openCreatedFile(app, created, { openInNewTab: result.openInNewTab },
            logger, `Created child Area: ${created.path}`);
        },
      },
      // Create Instance (from prototype)
      {
        id: "create-instance",
        label: "Create Instance",
        variant: "primary",
        visible: canCreateInstance(visibilityContext),
        onClick: async () => {
          const sourceClass = this.normalizeClass(instanceClass);
          const isMeeting = sourceClass === AssetClass.MEETING_PROTOTYPE;
          const defaultValue = isMeeting || sourceClass === AssetClass.TASK_PROTOTYPE
            ? this.generateDefaultLabel(metadata, file.basename)
            : "";
          const result = await promptForLabel(app, defaultValue, !isMeeting);
          if (result.label === null) return;
          const created = await taskCreationService.createTask(
            file, metadata, sourceClass, result.label, result.taskSize);
          await openCreatedFile(app, created, { openInNewTab: result.openInNewTab },
            logger, `Created Instance from prototype: ${created.path}`);
        },
      },
      // Create Related Task
      {
        id: "create-related-task",
        label: "Create Related Task",
        variant: "primary",
        visible: canCreateRelatedTask(visibilityContext),
        onClick: async () => {
          const result = await promptForLabel(app);
          if (result.label === null) return;
          const created = await taskCreationService.createRelatedTask(
            file, metadata, result.label, result.taskSize);
          await openCreatedFile(app, created, { openInNewTab: result.openInNewTab },
            logger, `Created Related Task: ${created.path}`);
        },
      },
      // Create Narrower Concept
      {
        id: "create-narrower-concept",
        label: "Create Narrower Concept",
        variant: "primary",
        visible: canCreateNarrowerConcept(visibilityContext),
        onClick: async () => {
          const result = await new Promise<NarrowerConceptModalResult>((resolve) => {
            new NarrowerConceptModal(app, resolve).open();
          });
          if (result.fileName === null || result.definition === null) return;
          const created = await conceptCreationService.createNarrowerConcept(
            file, result.fileName, result.definition, result.aliases);
          await openCreatedFile(app, created, { openInNewTab: true },
            logger, `Created Narrower Concept: ${created.path}`);
        },
      },
      // Create Subclass
      {
        id: "create-subclass",
        label: "Create Subclass",
        variant: "primary",
        visible: canCreateSubclass(visibilityContext),
        onClick: async () => {
          const result = await new Promise<SubclassCreationModalResult>((resolve) => {
            new SubclassCreationModal(app, resolve).open();
          });
          if (result.label === null) return;
          const created = await classCreationService.createSubclass(file, result.label, metadata);
          await openCreatedFile(app, created, { openInNewTab: true },
            logger, `Created Subclass: ${created.path}`);
        },
      },
      // Create Task for DailyNote
      {
        id: "create-task-for-dailynote",
        label: "Create Task",
        variant: "primary",
        visible: canCreateTaskForDailyNote(visibilityContext),
        onClick: async () => {
          const result = await promptForLabel(app);
          if (result.label === null) return;
          const dailyNoteDate = this.extractDailyNoteDate(metadata);
          if (!dailyNoteDate) {
            logger.error("Failed to extract DailyNote date");
            return;
          }
          const plannedStartTimestamp = DateFormatter.toTimestampAtStartOfDay(dailyNoteDate);
          const sourceClass = this.normalizeClass(instanceClass);
          const created = await taskCreationService.createTask(
            file, metadata, sourceClass, result.label, result.taskSize, plannedStartTimestamp);
          await openCreatedFile(app, created, { openInNewTab: result.openInNewTab },
            logger, `Created Task for DailyNote: ${created.path}`);
        },
      },
    ];
  }

  private normalizeClass(instanceClass: string | string[] | null): string {
    if (!instanceClass) return "";
    return WikiLinkHelpers.normalize(
      Array.isArray(instanceClass) ? instanceClass[0] : instanceClass
    );
  }

  private generateDefaultLabel(metadata: Record<string, unknown>, fileName: string): string {
    const baseLabel = String(metadata.exo__Asset_label || fileName);
    return `${baseLabel} ${DateFormatter.toDateString(new Date())}`;
  }

  private extractDailyNoteDate(metadata: Record<string, unknown>): string | null {
    const dayProperty = metadata.pn__DailyNote_day;
    if (!dayProperty) return null;

    if (typeof dayProperty === "string") {
      const match = dayProperty.match(/\[\[(.+?)\]\]/);
      return match ? match[1] : dayProperty;
    }

    if (Array.isArray(dayProperty) && dayProperty.length > 0) {
      const firstValue = String(dayProperty[0]);
      const match = firstValue.match(/\[\[(.+?)\]\]/);
      return match ? match[1] : firstValue;
    }

    return null;
  }
}

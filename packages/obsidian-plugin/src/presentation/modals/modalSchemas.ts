import { App } from "obsidian";
import type { InputSchemaField } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { DynamicFormModal, type UserInput } from "./DynamicFormModal";

export interface LabelInputModalResult {
  label: string | null;
  taskSize: string | null;
  openInNewTab: boolean;
}

export interface SubclassCreationModalResult {
  label: string | null;
}

export interface TrashReasonModalResult {
  confirmed: boolean;
  reason: string | null;
}

export interface NarrowerConceptModalResult {
  fileName: string | null;
  definition: string | null;
  aliases: string[];
}

export interface SupervisionFormData {
  situation: string;
  emotions: string;
  thoughts: string;
  behavior: string;
  shortTermConsequences: string;
  longTermConsequences: string;
  desiredBehavior: string;
}

export interface ClassSelectionModalResult<T extends ClassOption = ClassOption> {
  selectedClass: T | null;
}

export interface ClassOption {
  className: string;
  label: string;
  description?: string;
}

function buildModal(
  app: App,
  schema: InputSchemaField[],
  title: string,
  submitLabel?: string,
): Promise<UserInput | null> {
  const modal = new DynamicFormModal(app, schema, { title, submitLabel });
  return modal.waitForResult();
}

export async function showSubclassCreationModal(
  app: App,
): Promise<SubclassCreationModalResult> {
  const schema: InputSchemaField[] = [
    { name: "label", type: "text", label: "Subclass label", required: true },
  ];
  const result = await buildModal(app, schema, "Create subclass", "Create");
  if (!result) return { label: null };
  return { label: result["label"]?.trim() || null };
}

export async function showTrashReasonModal(
  app: App,
): Promise<TrashReasonModalResult> {
  const schema: InputSchemaField[] = [
    {
      name: "reason",
      type: "multiline",
      label: "Reason for trashing (optional)",
      required: false,
      rows: 3,
    },
  ];
  const result = await buildModal(app, schema, "Trash effort", "Confirm");
  if (!result) return { confirmed: false, reason: null };
  return {
    confirmed: true,
    reason: result["reason"]?.trim() || null,
  };
}

export async function showSupervisionModal(
  app: App,
): Promise<SupervisionFormData | null> {
  const schema: InputSchemaField[] = [
    { name: "situation", type: "text", label: "Ситуация/триггер" },
    { name: "emotions", type: "text", label: "Эмоции" },
    { name: "thoughts", type: "text", label: "Мысли" },
    { name: "behavior", type: "text", label: "Поведение" },
    { name: "shortTermConsequences", type: "text", label: "Краткосрочные последствия поведения" },
    { name: "longTermConsequences", type: "text", label: "Долгосрочные последствия поведения" },
    { name: "desiredBehavior", type: "text", label: "Желательное поведение" },
  ];
  const result = await buildModal(app, schema, "Добавить супервизию", "Создать");
  if (!result) return null;
  return {
    situation: result["situation"] || "",
    emotions: result["emotions"] || "",
    thoughts: result["thoughts"] || "",
    behavior: result["behavior"] || "",
    shortTermConsequences: result["shortTermConsequences"] || "",
    longTermConsequences: result["longTermConsequences"] || "",
    desiredBehavior: result["desiredBehavior"] || "",
  };
}

export async function showNarrowerConceptModal(
  app: App,
): Promise<NarrowerConceptModalResult> {
  const schema: InputSchemaField[] = [
    { name: "fileName", type: "text", label: "File name", required: true },
    { name: "definition", type: "multiline", label: "Definition", required: true, rows: 3 },
    { name: "aliases", type: "text", label: "Aliases (comma-separated, optional)" },
  ];
  const result = await buildModal(app, schema, "Create narrower concept", "Create");
  if (!result) return { fileName: null, definition: null, aliases: [] };
  const aliasesStr = result["aliases"]?.trim() || "";
  const aliases = aliasesStr
    ? aliasesStr.split(",").map((a) => a.trim()).filter((a) => a.length > 0)
    : [];
  return {
    fileName: result["fileName"]?.trim() || null,
    definition: result["definition"]?.trim() || null,
    aliases,
  };
}

export async function showLabelInputModal(
  app: App,
  defaultValue = "",
  showTaskSize = true,
): Promise<LabelInputModalResult> {
  const schema: InputSchemaField[] = [
    {
      name: "label",
      type: "text",
      label: "Asset label (optional)",
      defaultValue,
    },
  ];

  if (showTaskSize) {
    schema.push({
      name: "taskSize",
      type: "enum",
      label: "Task size",
      options: [
        { value: "", label: "Not specified" },
        { value: '"[[ems__TaskSize_XXS]]"', label: "XXS" },
        { value: '"[[ems__TaskSize_XS]]"', label: "XS" },
        { value: '"[[ems__TaskSize_S]]"', label: "S" },
        { value: '"[[ems__TaskSize_M]]"', label: "M" },
      ],
    });
  }

  schema.push({
    name: "openInNewTab",
    type: "enum",
    label: "Open created asset in a new tab",
    options: [
      { value: "true", label: "Yes - open in new tab" },
      { value: "false", label: "No - use current tab" },
    ],
    defaultValue: "false",
  });

  const result = await buildModal(app, schema, "Create asset", "Create");
  if (!result) return { label: null, taskSize: null, openInNewTab: false };
  return {
    label: result["label"]?.trim() || null,
    taskSize: result["taskSize"] || null,
    openInNewTab: result["openInNewTab"] === "true",
  };
}

export async function showClassSelectionModal<T extends ClassOption>(
  app: App,
  classes: T[],
): Promise<ClassSelectionModalResult<T>> {
  const options = classes.map((cls) => ({
    value: cls.className,
    label: cls.label,
  }));

  const schema: InputSchemaField[] = [
    {
      name: "selectedClass",
      type: "enum",
      label: "Select the type of asset to create",
      required: true,
      options,
    },
  ];

  const result = await buildModal(app, schema, "Create asset", "Next");
  if (!result || !result["selectedClass"]) return { selectedClass: null } as ClassSelectionModalResult<T>;

  const selected = classes.find((c) => c.className === result["selectedClass"]);
  return { selectedClass: selected ?? null } as ClassSelectionModalResult<T>;
}

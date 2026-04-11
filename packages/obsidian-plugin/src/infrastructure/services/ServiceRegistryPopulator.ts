import type { App } from "obsidian";
import {
  ServiceRegistry,
  FrontmatterService,
  TaskStatusService,
  EffortVotingService,
  LabelToAliasService,
  EffortStatusWorkflow,
  StatusTimestampService,
  GenericAssetCreationService,
  DateFormatter,
  type IGroundingService,
  type UserInput,
  type IFile,
} from "exocortex";
import type { SPARQLApi } from "../../application/api/SPARQLApi";
import type { ObsidianFileSystemAdapter } from "../../adapters/ObsidianFileSystemAdapter";
import type { ObsidianVaultAdapter } from "../../adapters/ObsidianVaultAdapter";

export interface ServiceRegistryDeps {
  app: App;
  fileSystemAdapter: ObsidianFileSystemAdapter;
  sparqlApi: SPARQLApi;
  vaultAdapter?: ObsidianVaultAdapter;
}

function wrapService(
  fn: (targetIRI: string, userInput?: UserInput) => Promise<void>,
): IGroundingService {
  return { execute: fn };
}

export function populateServiceRegistry(
  registry: ServiceRegistry,
  deps: ServiceRegistryDeps,
): void {
  const { app, fileSystemAdapter, sparqlApi, vaultAdapter } = deps;
  const frontmatterService = new FrontmatterService();

  registry.register(
    "updateProperty",
    wrapService(async (targetIRI: string, userInput?: UserInput) => {
      const property = userInput?.property as string | undefined;
      const value = userInput?.value;
      if (!property) throw new Error("updateProperty requires userInput.property");
      if (value === undefined) throw new Error("updateProperty requires userInput.value");

      const filePath = resolveFilePath(app, targetIRI);
      const content = await fileSystemAdapter.readFile(filePath);
      const updated = frontmatterService.updateProperty(content, property, value);
      await fileSystemAdapter.updateFile(filePath, updated);
    }),
  );

  registry.register(
    "removeProperty",
    wrapService(async (targetIRI: string, userInput?: UserInput) => {
      const property = userInput?.property as string | undefined;
      if (!property) throw new Error("removeProperty requires userInput.property");

      const filePath = resolveFilePath(app, targetIRI);
      const content = await fileSystemAdapter.readFile(filePath);
      const updated = frontmatterService.removeProperty(content, property);
      await fileSystemAdapter.updateFile(filePath, updated);
    }),
  );

  registry.register(
    "setStatus",
    wrapService(async (targetIRI: string, userInput?: UserInput) => {
      const statusUID = userInput?.statusUID as string | undefined;
      if (!statusUID) throw new Error("setStatus requires userInput.statusUID");

      const filePath = resolveFilePath(app, targetIRI);
      const content = await fileSystemAdapter.readFile(filePath);
      const updated = frontmatterService.updateProperty(
        content,
        "ems__Effort_status",
        `"[[${statusUID}]]"`,
      );
      await fileSystemAdapter.updateFile(filePath, updated);
    }),
  );

  registry.register(
    "createAsset",
    wrapService(async (targetIRI: string, userInput?: UserInput) => {
      const prototypeUID = userInput?.prototypeUID as string | undefined;
      const label = userInput?.label as string | undefined;
      let folder = userInput?.folder as string | undefined;
      if (!prototypeUID) throw new Error("createAsset requires userInput.prototypeUID");
      if (!label) throw new Error("createAsset requires userInput.label");
      // Default to current file's folder when not specified
      if (!folder && targetIRI) {
        try {
          const currentPath = resolveFilePath(app, targetIRI);
          const lastSlash = currentPath.lastIndexOf("/");
          folder = lastSlash >= 0 ? currentPath.substring(0, lastSlash) : "";
        } catch {
          // IRI resolution failed — folder stays undefined
        }
      }
      if (!folder && folder !== "") throw new Error("createAsset requires userInput.folder");

      const uid = crypto.randomUUID();
      const fileName = `${uid}.md`;
      const filePath = `${folder}/${fileName}`;
      const frontmatter = [
        "---",
        `exo__Asset_uid: ${uid}`,
        `exo__Asset_label: ${label}`,
        `exo__Asset_prototype: "[[${prototypeUID}]]"`,
        "---",
        "",
      ].join("\n");
      await fileSystemAdapter.createFile(filePath, frontmatter);
    }),
  );

  registry.register(
    "openFile",
    wrapService(async (_targetIRI: string, userInput?: UserInput) => {
      const path = userInput?.path as string | undefined;
      if (!path) throw new Error("openFile requires userInput.path");
      await app.workspace.openLinkText(path, "");
    }),
  );

  registry.register(
    "sparqlSelect",
    wrapService(async (_targetIRI: string, userInput?: UserInput) => {
      const query = userInput?.query as string | undefined;
      if (!query) throw new Error("sparqlSelect requires userInput.query");
      await sparqlApi.query(query);
    }),
  );

  registry.register(
    "getActiveFileIRI",
    wrapService(async () => {
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) return;
      const cache = app.metadataCache.getFileCache(activeFile);
      const uid = cache?.frontmatter?.exo__Asset_uid as string | undefined;
      if (!uid) return;
    }),
  );

  registry.register(
    "getActiveFilePath",
    wrapService(async () => {
      app.workspace.getActiveFile();
    }),
  );

  registry.register(
    "trashFile",
    wrapService(async (targetIRI: string) => {
      const filePath = resolveFilePath(app, targetIRI);
      await app.vault.adapter.trashLocal(filePath);
    }),
  );

  registry.register(
    "duplicateFile",
    wrapService(async (targetIRI: string, userInput?: UserInput) => {
      const newLabel = userInput?.label as string | undefined;
      if (!newLabel) throw new Error("duplicateFile requires userInput.label");

      const filePath = resolveFilePath(app, targetIRI);
      const content = await fileSystemAdapter.readFile(filePath);
      const uid = crypto.randomUUID();
      const updated = frontmatterService.updateProperty(
        frontmatterService.updateProperty(content, "exo__Asset_uid", uid),
        "exo__Asset_label",
        newLabel,
      );
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      const newPath = `${dir}/${uid}.md`;
      await fileSystemAdapter.createFile(newPath, updated);
    }),
  );

  if (vaultAdapter) {
    const effortStatusWorkflow = new EffortStatusWorkflow();
    const statusTimestampService = new StatusTimestampService(vaultAdapter);
    const taskStatusService = new TaskStatusService(
      vaultAdapter,
      effortStatusWorkflow,
      statusTimestampService,
    );
    const effortVotingService = new EffortVotingService(vaultAdapter);
    const labelToAliasService = new LabelToAliasService(vaultAdapter);
    const genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);

    registry.register(
      "rollbackStatus",
      wrapService(async (targetIRI: string) => {
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        await taskStatusService.rollbackStatus(iFile);
      }),
    );

    registry.register(
      "planOnToday",
      wrapService(async (targetIRI: string) => {
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        await taskStatusService.planOnToday(iFile);
      }),
    );

    registry.register(
      "planForEvening",
      wrapService(async (targetIRI: string) => {
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        await taskStatusService.planForEvening(iFile);
      }),
    );

    registry.register(
      "shiftDay",
      wrapService(async (targetIRI: string, userInput?: UserInput) => {
        const direction = userInput?.direction as string | undefined;
        if (!direction) throw new Error("shiftDay requires userInput.direction");
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        if (direction === "forward") {
          await taskStatusService.shiftDayForward(iFile);
        } else if (direction === "backward") {
          await taskStatusService.shiftDayBackward(iFile);
        } else {
          throw new Error(`shiftDay: unknown direction "${direction}". Use "forward" or "backward"`);
        }
      }),
    );

    registry.register(
      "incrementVotes",
      wrapService(async (targetIRI: string) => {
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        await effortVotingService.incrementEffortVotes(iFile);
      }),
    );

    registry.register(
      "copyLabelToAliases",
      wrapService(async (targetIRI: string) => {
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        await labelToAliasService.copyLabelToAliases(iFile);
      }),
    );

    registry.register(
      "createRelatedTask",
      wrapService(async (targetIRI: string, userInput?: UserInput) => {
        const label = userInput?.label as string | undefined;
        if (!label) throw new Error("createRelatedTask requires userInput.label");
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        const frontmatter = vaultAdapter.getFrontmatter(iFile);
        const folderPath = iFile.parent?.path || "";
        await genericAssetCreationService.createAsset({
          className: "ems__Task",
          label,
          folderPath,
          propertyValues: {
            "ems__Effort_parent": iFile.basename ? `"[[${iFile.basename}]]"` : undefined,
          },
          parentFile: iFile,
          parentMetadata: (frontmatter as Record<string, unknown>) ?? {},
        });
      }),
    );

    registry.register(
      "createTaskForDailyNote",
      wrapService(async (targetIRI: string, userInput?: UserInput) => {
        const label = userInput?.label as string | undefined;
        if (!label) throw new Error("createTaskForDailyNote requires userInput.label");
        const iFile = resolveIFile(app, targetIRI, vaultAdapter);
        const folderPath = iFile.parent?.path || "";
        const today = DateFormatter.toISOTimestamp(new Date()).substring(0, 10);
        await genericAssetCreationService.createAsset({
          className: "ems__Task",
          label,
          folderPath,
          propertyValues: {
            "ems__Effort_plannedStartTimestamp": today,
          },
        });
      }),
    );
  }
}

function resolveFilePath(app: App, targetIRI: string): string {
  // Handle obsidian://vault/ IRIs by decoding to vault-relative path
  if (targetIRI.startsWith("obsidian://vault/")) {
    const decoded = decodeURIComponent(targetIRI.replace("obsidian://vault/", ""));
    const file = app.vault.getAbstractFileByPath(decoded);
    if (file) return decoded;
  }

  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.exo__Asset_uid === targetIRI) {
      return file.path;
    }
    const iri = cache?.frontmatter?.["@id"];
    if (iri === targetIRI) {
      return file.path;
    }
  }
  throw new Error(`No file found for IRI: ${targetIRI}`);
}

function resolveIFile(app: App, targetIRI: string, vaultAdapter: { getAbstractFileByPath(path: string): IFile | { path: string; name: string } | null }): IFile {
  const filePath = resolveFilePath(app, targetIRI);
  const iFileOrFolder = vaultAdapter.getAbstractFileByPath(filePath);
  if (!iFileOrFolder || !("basename" in iFileOrFolder)) {
    throw new Error(`Cannot resolve IFile for path: ${filePath}`);
  }
  return iFileOrFolder as IFile;
}

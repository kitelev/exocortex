import type { App, Plugin } from "obsidian";
import { ICommand } from "./ICommand";
import { SPARQLQueryBuilderModal } from '@plugin/presentation/modals/SPARQLQueryBuilderModal';

export class OpenQueryBuilderCommand implements ICommand {
  id = "open-sparql-query-builder";
  name = "open sparql query builder";

  constructor(
    private app: App,
    private plugin: Plugin,
  ) {}

  callback = async (): Promise<void> => {
    const modal = new SPARQLQueryBuilderModal(this.app, this.plugin);
    modal.open();
  };
}

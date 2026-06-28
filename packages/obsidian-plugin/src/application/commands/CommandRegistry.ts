import { ICommand } from "./ICommand";
import { CommandResolver, ResolvedCommand } from "@kitelev/exocortex-core";

/**
 * Thin registry that provides global (UI-only) commands and delegates
 * asset-specific command resolution to CommandResolver (RFC-009 §5.3).
 *
 * All per-asset commands (status transitions, creation, voting, etc.)
 * are defined as vault command assets and resolved via SPARQL.
 * Only global commands that require plugin/app UI dependencies remain.
 */
export class CommandRegistry {
  private commandResolver: CommandResolver | null = null;

  constructor(private readonly globalCommands: ICommand[]) {}

  getGlobalCommands(): ICommand[] {
    return this.globalCommands;
  }

  getAllCommands(): ICommand[] {
    return this.globalCommands;
  }

  // NOTE: currently unused (no live caller). If revived, `assetClass` MUST be a
  // wikilink-alias-stripped class string (the TARGET before any `|`) — pass the
  // output of `DynamicCommandButtonGroupBuilder.extractAssetClasses`, never a raw
  // `exo__Instance_class` frontmatter value — otherwise an aliased instance class
  // (`[[uid|Display]]`) would silently resolve no class-targeted bindings (the
  // alias-suppresses-buttons bug this fix repaired at the builder surface).
  async getCommandsForAsset(
    subjectIRI: string,
    assetClass: string,
    prototypeIRI?: string,
  ): Promise<ResolvedCommand[]> {
    if (!this.commandResolver) return [];
    return this.commandResolver.resolveForAsset(subjectIRI, assetClass, prototypeIRI);
  }

  setCommandResolver(resolver: CommandResolver): void {
    this.commandResolver = resolver;
  }
}

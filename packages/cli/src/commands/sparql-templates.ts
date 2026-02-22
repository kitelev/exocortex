import { Command } from "commander";
import { TemplateRegistry } from "../templates/TemplateRegistry.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { ResponseBuilder } from "../responses/index.js";

export interface SparqlTemplatesOptions {
  output?: OutputFormat;
}

/**
 * Command to list available SPARQL query templates.
 *
 * Usage:
 *   exocortex sparql templates
 *   exocortex sparql templates --output json
 */
export function sparqlTemplatesCommand(): Command {
  return new Command("templates")
    .description("List available SPARQL query templates")
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .action(async (options: SparqlTemplatesOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const registry = new TemplateRegistry();
        const templates = registry.listTemplates();

        if (outputFormat === "json") {
          const response = ResponseBuilder.success({
            templates,
            count: templates.length,
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          console.log(registry.formatList("text"));
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

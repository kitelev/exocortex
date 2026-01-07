/**
 * Validate CLI Command
 *
 * Validates ontology data against SHACL shapes and displays results
 * in table or JSON format.
 *
 * @see https://github.com/kitelev/exocortex/issues/1448
 */

import { Command } from "commander";
import fs from "fs";
import { ShaclValidator, ValidationErrorFormatter } from "exocortex";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { FileNotFoundError } from "../utils/errors/index.js";

export interface ValidateOptions {
  ontology: string;
  shapes: string;
  format: "table" | "json";
}

/**
 * Creates the 'validate' command for validating ontology against SHACL shapes.
 *
 * @example
 * exocortex validate --ontology ems-ui.ttl --shapes shapes.ttl
 * exocortex validate --ontology ems-ui.ttl --shapes shapes.ttl --format json
 */
export function validateCommand(): Command {
  return new Command("validate")
    .description("Validate ontology against SHACL shapes")
    .requiredOption("--ontology <path>", "Path to ontology file (Turtle format)")
    .requiredOption("--shapes <path>", "Path to SHACL shapes file (Turtle format)")
    .option("--format <type>", "Output format: table|json", "table")
    .action(async (options: ValidateOptions) => {
      const format = (options.format || "table") as OutputFormat;
      ErrorHandler.setFormat(format);

      try {
        // Validate file existence
        if (!fs.existsSync(options.ontology)) {
          throw new FileNotFoundError(options.ontology, "Ontology file not found");
        }
        if (!fs.existsSync(options.shapes)) {
          throw new FileNotFoundError(options.shapes, "SHACL shapes file not found");
        }

        // Read files
        const ontologyData = fs.readFileSync(options.ontology, "utf-8");
        const shapesData = fs.readFileSync(options.shapes, "utf-8");

        // Validate
        const validator = new ShaclValidator();
        const result = await validator.validate(ontologyData, shapesData);

        // Format output
        const formatter = new ValidationErrorFormatter();

        if (options.format === "json") {
          console.log(formatter.formatAsJson(result));
        } else {
          console.log(formatter.formatForConsole(result));
        }

        // Exit with appropriate code
        if (!result.conforms) {
          process.exit(ExitCodes.VALIDATION_ERROR);
        }

        process.exit(ExitCodes.SUCCESS);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

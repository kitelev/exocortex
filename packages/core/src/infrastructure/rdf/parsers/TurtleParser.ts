import { Triple } from "../../../domain/models/rdf/Triple";
import { Namespace } from "../../../domain/models/rdf/Namespace";
import { NTriplesParseOptions, NTriplesParser } from "./NTriplesParser";

export interface TurtleParseOptions extends NTriplesParseOptions {}

const DEFAULT_PREFIXES: Record<string, string> = {
  rdf: Namespace.RDF.iri.value,
  rdfs: Namespace.RDFS.iri.value,
  owl: Namespace.OWL.iri.value,
  xsd: Namespace.XSD.iri.value,
  exo: Namespace.EXO.iri.value,
  ems: Namespace.EMS.iri.value,
};

const PREFIX_STATEMENT =
  /^@prefix\s+([a-zA-Z_][\w-]*):\s*<([^>]+)>\s*\.$/;

export class TurtleParser {
  private readonly nTriplesParser = new NTriplesParser();

  parse(input: string, options: TurtleParseOptions = {}): Triple[] {
    const prefixes: Record<string, string> = {
      ...DEFAULT_PREFIXES,
      ...(options.prefixes ?? {}),
    };

    const statements = this.collectStatements(input);
    const triples: Triple[] = [];

    statements.forEach(({ statement, lineNumber }) => {
      if (this.isPrefixStatement(statement)) {
        const match = statement.match(PREFIX_STATEMENT);

        if (!match) {
          throw new Error(`Invalid prefix declaration at line ${lineNumber}`);
        }

        const [, prefix, iri] = match;
        prefixes[prefix] = iri;
        return;
      }

      if (statement.includes(";") || statement.includes(",")) {
        throw new Error(
          `Complex Turtle statements with ';' or ',' are not supported (line ${lineNumber})`
        );
      }

      const normalized = this.normalizeShortcuts(statement);
      triples.push(
        this.nTriplesParser.parseLine(
          normalized,
          lineNumber,
          {
            prefixes,
            strict: false,
          }
        )
      );
    });

    return triples;
  }

  private collectStatements(input: string): Array<{ statement: string; lineNumber: number }> {
    const lines = input.split(/\r?\n/);
    const statements: Array<{ statement: string; lineNumber: number }> = [];
    let buffer = "";
    let statementStartLine = 0;

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      if (!buffer) {
        statementStartLine = index + 1;
      }

      buffer = buffer ? `${buffer} ${trimmed}` : trimmed;

      if (trimmed.endsWith(".")) {
        statements.push({
          statement: buffer,
          lineNumber: statementStartLine,
        });
        buffer = "";
      }
    });

    if (buffer) {
      throw new Error(`Unterminated Turtle statement near line ${statementStartLine}`);
    }

    return statements;
  }

  private isPrefixStatement(statement: string): boolean {
    return statement.startsWith("@prefix");
  }

  private normalizeShortcuts(statement: string): string {
    if (!statement.includes(" a ")) {
      return statement;
    }

    return statement.replace(/\sa\s/g, " rdf:type ");
  }
}

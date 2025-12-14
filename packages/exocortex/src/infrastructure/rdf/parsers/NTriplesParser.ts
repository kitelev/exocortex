import { Triple, Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import { Namespace } from "../../../domain/models/rdf/Namespace";

export type RDFNode = Subject | Predicate | RDFObject;

export interface NTriplesParseOptions {
  prefixes?: Record<string, string>;
  strict?: boolean;
}

interface ParseContext {
  prefixes: Record<string, string>;
  strict: boolean;
}

interface ParseResult<T extends RDFNode> {
  node: T;
  rest: string;
}

const DEFAULT_PREFIXES: Record<string, string> = {
  rdf: Namespace.RDF.iri.value,
  rdfs: Namespace.RDFS.iri.value,
  owl: Namespace.OWL.iri.value,
  xsd: Namespace.XSD.iri.value,
  exo: Namespace.EXO.iri.value,
  ems: Namespace.EMS.iri.value,
};

export class NTriplesParser {
  parse(input: string, options: NTriplesParseOptions = {}): Triple[] {
    const context: ParseContext = {
      prefixes: {
        ...DEFAULT_PREFIXES,
        ...(options.prefixes ?? {}),
      },
      strict: options.strict ?? false,
    };

    const triples: Triple[] = [];
    const lines = input.split(/\r?\n/);

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      triples.push(this.parseLine(trimmed, index + 1, context));
    });

    return triples;
  }

  parseLine(line: string, lineNumber: number, context: ParseContext): Triple {
    if (!line.endsWith(".")) {
      throw new Error(`Invalid RDF statement at line ${lineNumber}: missing '.' terminator`);
    }

    const statement = line.slice(0, -1).trim();
    let remainder = statement;

    const subjectResult = this.parseSubject(remainder, lineNumber, context);
    remainder = subjectResult.rest.trim();

    const predicateResult = this.parsePredicate(remainder, lineNumber, context);
    remainder = predicateResult.rest.trim();

    const objectResult = this.parseObject(remainder, lineNumber, context);
    remainder = objectResult.rest.trim();

    if (remainder.length > 0) {
      throw new Error(`Unexpected tokens after object at line ${lineNumber}`);
    }

    return new Triple(
      subjectResult.node as Subject,
      predicateResult.node as Predicate,
      objectResult.node as RDFObject
    );
  }

  private parseSubject(remainder: string, lineNumber: number, context: ParseContext): ParseResult<Subject> {
    if (remainder.startsWith("<")) {
      return this.consumeIRI(remainder, lineNumber, context);
    }

    if (remainder.startsWith("_:")) {
      return this.consumeBlankNode(remainder, lineNumber);
    }

    return this.consumePrefixedName(remainder, lineNumber, context) as ParseResult<Subject>;
  }

  private parsePredicate(remainder: string, lineNumber: number, context: ParseContext): ParseResult<Predicate> {
    if (remainder.startsWith("<")) {
      return this.consumeIRI(remainder, lineNumber, context) as ParseResult<Predicate>;
    }

    return this.consumePrefixedName(remainder, lineNumber, context) as ParseResult<Predicate>;
  }

  private parseObject(remainder: string, lineNumber: number, context: ParseContext): ParseResult<RDFObject> {
    if (remainder.startsWith("<")) {
      return this.consumeIRI(remainder, lineNumber, context);
    }

    if (remainder.startsWith("_:")) {
      return this.consumeBlankNode(remainder, lineNumber);
    }

    if (remainder.startsWith("\"")) {
      return this.consumeLiteral(remainder, lineNumber, context);
    }

    return this.consumePrefixedName(remainder, lineNumber, context);
  }

  private consumePrefixedName(remainder: string, lineNumber: number, context: ParseContext): ParseResult<IRI> {
    const match = remainder.match(/^([a-zA-Z_][\w-]*):([^\s]+)(?:\s+(.*))?$/);
    if (!match) {
      throw new Error(`Invalid token at line ${lineNumber}: ${remainder}`);
    }

    const [, prefix, localName, rest] = match;
    const expansion = context.prefixes[prefix];

    if (!expansion) {
      throw new Error(`Unknown prefix "${prefix}" at line ${lineNumber}`);
    }

    const iri = new IRI(`${expansion}${localName}`);
    return {
      node: iri,
      rest: (rest ?? "").trimStart(),
    };
  }

  private consumeIRI(remainder: string, lineNumber: number, _context: ParseContext): ParseResult<IRI> {
    const endIndex = this.findClosingBracket(remainder, "<", ">");
    if (endIndex === -1) {
      throw new Error(`Invalid IRI at line ${lineNumber}`);
    }

    const iriValue = remainder.slice(1, endIndex);
    const iri = new IRI(iriValue);

    const rest = remainder.slice(endIndex + 1).trimStart();
    return {
      node: iri,
      rest,
    };
  }

  private consumeBlankNode(remainder: string, lineNumber: number): ParseResult<BlankNode> {
    const match = remainder.match(/^_:(\w+)(?:\s+(.*))?$/);
    if (!match) {
      throw new Error(`Invalid blank node identifier at line ${lineNumber}`);
    }

    const [, id, rest] = match;
    return {
      node: new BlankNode(id),
      rest: (rest ?? "").trimStart(),
    };
  }

  private consumeLiteral(remainder: string, lineNumber: number, context: ParseContext): ParseResult<Literal> {
    const { value, rest: afterValue } = this.consumeQuotedString(remainder, lineNumber);
    let rest = afterValue.trimStart();

    if (rest.startsWith("^^")) {
      rest = rest.slice(2).trimStart();
      const datatypeResult = rest.startsWith("<")
        ? this.consumeIRI(rest, lineNumber, context)
        : this.consumePrefixedName(rest, lineNumber, context);

      return {
        node: new Literal(value, datatypeResult.node as IRI),
        rest: datatypeResult.rest,
      };
    }

    if (rest.startsWith("@")) {
      const match = rest.match(/^@([a-zA-Z-]+)(?:\s+(.*))?$/);
      if (!match) {
        throw new Error(`Invalid language tag at line ${lineNumber}`);
      }

      const [, language, remainder] = match;
      return {
        node: new Literal(value, undefined, language),
        rest: (remainder ?? "").trimStart(),
      };
    }

    return {
      node: new Literal(value),
      rest,
    };
  }

  private consumeQuotedString(input: string, lineNumber: number): { value: string; rest: string } {
    if (!input.startsWith("\"")) {
      throw new Error(`Expected quoted string at line ${lineNumber}`);
    }

    let value = "";

    for (let i = 1; i < input.length; i++) {
      const char = input[i];

      if (char === "\\") {
        if (i + 1 >= input.length) {
          throw new Error(`Invalid escape sequence at line ${lineNumber}`);
        }

        const escapeType = input[i + 1];

        switch (escapeType) {
          case "t":
            value += "\t";
            i += 1;
            break;
          case "b":
            value += "\b";
            i += 1;
            break;
          case "n":
            value += "\n";
            i += 1;
            break;
          case "r":
            value += "\r";
            i += 1;
            break;
          case "f":
            value += "\f";
            i += 1;
            break;
          case "\"":
            value += "\"";
            i += 1;
            break;
          case "\\":
            value += "\\";
            i += 1;
            break;
          case "u": {
            const hex = input.slice(i + 2, i + 6);
            if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new Error(`Invalid \\u escape at line ${lineNumber}`);
            }
            value += String.fromCharCode(parseInt(hex, 16));
            i += 5;
            break;
          }
          case "U": {
            const hex = input.slice(i + 2, i + 10);
            if (hex.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(hex)) {
              throw new Error(`Invalid \\U escape at line ${lineNumber}`);
            }
            value += String.fromCodePoint(parseInt(hex, 16));
            i += 9;
            break;
          }
          default:
            throw new Error(`Unknown escape sequence \\${escapeType} at line ${lineNumber}`);
        }

        continue;
      }

      if (char === "\"") {
        const rest = input.slice(i + 1);
        return { value, rest };
      }

      value += char;
    }

    throw new Error(`Unterminated string literal at line ${lineNumber}`);
  }

  private findClosingBracket(input: string, open: string, close: string): number {
    let depth = 0;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (char === open) {
        depth++;
        continue;
      }

      if (char === close) {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }
}

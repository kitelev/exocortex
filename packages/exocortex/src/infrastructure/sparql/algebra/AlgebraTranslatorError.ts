/**
 * Error thrown by the AlgebraTranslator and its sub-translators when
 * an invalid or unsupported SPARQL construct is encountered.
 */
export class AlgebraTranslatorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "AlgebraTranslatorError";
  }
}

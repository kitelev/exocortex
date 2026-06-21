export class IRI {
  private readonly _value: string;

  constructor(value: string) {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw new Error("IRI cannot be empty");
    }

    if (!IRI.isValidIRI(trimmed)) {
      throw new Error("Invalid IRI format");
    }

    this._value = trimmed;
  }

  get value(): string {
    return this._value;
  }

  equals(other: IRI): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  static isValidIRI(value: string): boolean {
    if (!value || value.trim().length === 0) {
      return false;
    }

    if (/\s/.test(value)) {
      return false;
    }

    const iriPattern = /^[a-z][a-z0-9+.-]*:/i;
    if (!iriPattern.test(value)) {
      return false;
    }

    const validSchemes = ["http", "https", "ftp", "ftps", "file", "mailto", "tel", "data", "ws", "wss", "urn", "obsidian"];
    const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*?):/i);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (!validSchemes.includes(scheme)) {
        return false;
      }
    }

    try {
      new URL(value);
      return true;
    } catch {
      const urnPattern = /^urn:[a-z0-9][a-z0-9-]{0,31}:[^\s]+$/i;
      return urnPattern.test(value);
    }
  }
}

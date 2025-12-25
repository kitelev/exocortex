/**
 * StringTable - Efficient String Interning for Graph Data
 *
 * Provides deduplication of strings (URIs, labels, predicates) to reduce
 * memory usage in large graphs. Each unique string is stored once and
 * referenced by a numeric index.
 *
 * @module infrastructure/memory
 * @since 1.0.0
 */

/**
 * Efficient string interning table.
 *
 * Features:
 * - O(1) lookup by string or index
 * - Automatic deduplication
 * - Memory-efficient storage
 * - Fast iteration
 */
export class StringTable {
  /** Map from string to index */
  private stringToIndex: Map<string, number> = new Map();

  /** Array of interned strings (index to string) */
  private strings: string[] = [];

  /** Approximate memory usage tracking */
  private memoryBytes = 0;

  /**
   * Create a new StringTable.
   *
   * @param initialStrings - Optional array of strings to pre-populate
   */
  constructor(initialStrings?: string[]) {
    if (initialStrings) {
      for (const str of initialStrings) {
        this.intern(str);
      }
    }
  }

  /**
   * Intern a string and return its index.
   *
   * If the string already exists, returns the existing index.
   * Otherwise, adds the string and returns a new index.
   *
   * @param str - The string to intern
   * @returns The index of the interned string
   */
  public intern(str: string): number {
    const existing = this.stringToIndex.get(str);
    if (existing !== undefined) {
      return existing;
    }

    const index = this.strings.length;
    this.strings.push(str);
    this.stringToIndex.set(str, index);

    // Track approximate memory (string bytes + Map entry overhead)
    this.memoryBytes += str.length * 2 + 50; // UTF-16 + overhead estimate

    return index;
  }

  /**
   * Get the index of a string without interning it.
   *
   * @param str - The string to look up
   * @returns The index if found, or -1 if not interned
   */
  public getIndex(str: string): number {
    return this.stringToIndex.get(str) ?? -1;
  }

  /**
   * Get the string at a given index.
   *
   * @param index - The index to look up
   * @returns The string at that index
   * @throws RangeError if index is out of bounds
   */
  public getString(index: number): string {
    if (index < 0 || index >= this.strings.length) {
      throw new RangeError(`StringTable index out of bounds: ${index}`);
    }
    return this.strings[index];
  }

  /**
   * Check if a string exists in the table.
   *
   * @param str - The string to check
   * @returns true if the string is interned
   */
  public has(str: string): boolean {
    return this.stringToIndex.has(str);
  }

  /**
   * Check if an index is valid.
   *
   * @param index - The index to check
   * @returns true if the index is valid
   */
  public hasIndex(index: number): boolean {
    return index >= 0 && index < this.strings.length;
  }

  /**
   * Get the number of interned strings.
   *
   * @returns The count of unique strings
   */
  public get size(): number {
    return this.strings.length;
  }

  /**
   * Get approximate memory usage in bytes.
   *
   * @returns Estimated memory usage
   */
  public getMemoryBytes(): number {
    return this.memoryBytes;
  }

  /**
   * Iterate over all interned strings.
   *
   * @yields [index, string] pairs
   */
  public *entries(): IterableIterator<[number, string]> {
    for (let i = 0; i < this.strings.length; i++) {
      yield [i, this.strings[i]];
    }
  }

  /**
   * Iterate over all string values.
   *
   * @yields string values
   */
  public *values(): IterableIterator<string> {
    for (const str of this.strings) {
      yield str;
    }
  }

  /**
   * Get all strings as an array (copy).
   *
   * @returns Array of all interned strings
   */
  public toArray(): string[] {
    return [...this.strings];
  }

  /**
   * Clear all interned strings.
   */
  public clear(): void {
    this.stringToIndex.clear();
    this.strings = [];
    this.memoryBytes = 0;
  }

  /**
   * Create a StringTable from a JSON-serialized format.
   *
   * @param data - Array of strings to restore
   * @returns New StringTable with the given strings
   */
  public static fromJSON(data: string[]): StringTable {
    return new StringTable(data);
  }

  /**
   * Serialize to JSON format (just the array of strings).
   *
   * @returns Array of strings for JSON serialization
   */
  public toJSON(): string[] {
    return this.strings;
  }

  /**
   * Intern multiple strings at once.
   *
   * @param strings - Array of strings to intern
   * @returns Array of indices corresponding to each string
   */
  public internAll(strings: string[]): number[] {
    return strings.map((str) => this.intern(str));
  }

  /**
   * Get multiple strings by their indices.
   *
   * @param indices - Array of indices to look up
   * @returns Array of strings corresponding to each index
   */
  public getStrings(indices: number[]): string[] {
    return indices.map((index) => this.getString(index));
  }

  /**
   * Find strings matching a pattern.
   *
   * @param pattern - Regular expression or substring to match
   * @returns Array of [index, string] pairs that match
   */
  public search(pattern: string | RegExp): Array<[number, string]> {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    const results: Array<[number, string]> = [];

    for (let i = 0; i < this.strings.length; i++) {
      if (regex.test(this.strings[i])) {
        results.push([i, this.strings[i]]);
      }
    }

    return results;
  }

  /**
   * Get statistics about the StringTable.
   *
   * @returns Object with size and memory stats
   */
  public getStats(): {
    count: number;
    memoryBytes: number;
    avgStringLength: number;
  } {
    const totalLength = this.strings.reduce((sum, s) => sum + s.length, 0);
    return {
      count: this.strings.length,
      memoryBytes: this.memoryBytes,
      avgStringLength:
        this.strings.length > 0 ? totalLength / this.strings.length : 0,
    };
  }
}

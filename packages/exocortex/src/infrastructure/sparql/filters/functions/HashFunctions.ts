export class HashFunctions {

  /**
   * SPARQL 1.1 MD5 function.
   * Returns the MD5 checksum, as a hex digit string.
   *
   * WARNING: MD5 is cryptographically weak. This function exists ONLY for
   * SPARQL 1.1 specification compliance. Do NOT use for security purposes.
   * https://www.w3.org/TR/sparql11-query/#func-md5
   *
   * @param str - String to hash
   * @returns Lowercase hex string of MD5 hash
   *
   * Example: MD5("test") = "098f6bcd4621d373cade4e832627b4f6"
   */
  static md5(str: string): string {
    // codeql[js/weak-cryptographic-algorithm] SPARQL 1.1 spec-mandated function
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const crypto = require("crypto");
    return crypto.createHash("md5").update(str).digest("hex"); // nosec - SPARQL spec compliance
  }

  /**
   * SPARQL 1.1 SHA1 function.
   * Returns the SHA1 checksum, as a hex digit string.
   *
   * WARNING: SHA1 is cryptographically weak. This function exists ONLY for
   * SPARQL 1.1 specification compliance. Do NOT use for security purposes.
   * https://www.w3.org/TR/sparql11-query/#func-sha1
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA1 hash
   *
   * Example: SHA1("test") = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
   */
  static sha1(str: string): string {
    // codeql[js/weak-cryptographic-algorithm] SPARQL 1.1 spec-mandated function
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const crypto = require("crypto");
    return crypto.createHash("sha1").update(str).digest("hex"); // nosec - SPARQL spec compliance
  }

  /**
   * SPARQL 1.1 SHA256 function.
   * Returns the SHA256 checksum, as a hex digit string.
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA256 hash
   *
   * Example: SHA256("test") = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
   */
  static sha256(str: string): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(str).digest("hex");
  }

  /**
   * SPARQL 1.1 SHA384 function.
   * Returns the SHA384 checksum, as a hex digit string.
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA384 hash
   */
  static sha384(str: string): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const crypto = require("crypto");
    return crypto.createHash("sha384").update(str).digest("hex");
  }

  /**
   * SPARQL 1.1 SHA512 function.
   * Returns the SHA512 checksum, as a hex digit string.
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA512 hash
   */
  static sha512(str: string): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const crypto = require("crypto");
    return crypto.createHash("sha512").update(str).digest("hex");
  }
}

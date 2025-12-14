import { FilenameValidator } from "../../../src/utilities/FilenameValidator";

describe("FilenameValidator", () => {
  describe("validate", () => {
    it("should return valid for a normal filename", () => {
      const result = FilenameValidator.validate("my-document");

      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("my-document");
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid for filename with spaces", () => {
      const result = FilenameValidator.validate("my document name");

      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("my document name");
      expect(result.errors).toHaveLength(0);
    });

    it("should detect invalid characters", () => {
      const result = FilenameValidator.validate("file/with/slashes");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename contains invalid characters: / \\ : * ? \" < > |",
      );
    });

    it("should detect backslash as invalid", () => {
      const result = FilenameValidator.validate("file\\with\\backslash");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename contains invalid characters: / \\ : * ? \" < > |",
      );
    });

    it("should detect colon as invalid", () => {
      const result = FilenameValidator.validate("file:with:colons");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename contains invalid characters: / \\ : * ? \" < > |",
      );
    });

    it("should detect pipe as invalid", () => {
      const result = FilenameValidator.validate("file|with|pipes");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename contains invalid characters: / \\ : * ? \" < > |",
      );
    });

    it("should detect question mark as invalid", () => {
      const result = FilenameValidator.validate("file?with?questions");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename contains invalid characters: / \\ : * ? \" < > |",
      );
    });

    it("should detect asterisk as invalid", () => {
      const result = FilenameValidator.validate("file*with*asterisks");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename contains invalid characters: / \\ : * ? \" < > |",
      );
    });

    it("should detect double quotes as invalid", () => {
      const result = FilenameValidator.validate('file"with"quotes');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename contains invalid characters: / \\ : * ? \" < > |",
      );
    });

    it("should detect angle brackets as invalid", () => {
      const result = FilenameValidator.validate("file<with>brackets");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename contains invalid characters: / \\ : * ? \" < > |",
      );
    });

    it("should detect empty filename as invalid", () => {
      const result = FilenameValidator.validate("");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Filename cannot be empty");
    });

    it("should detect whitespace-only filename as invalid", () => {
      const result = FilenameValidator.validate("   ");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Filename cannot be empty");
    });

    it("should allow empty filename when allowEmpty is true", () => {
      const result = FilenameValidator.validate("", { allowEmpty: true });

      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("");
      expect(result.errors).toHaveLength(0);
    });

    it("should detect filename exceeding max length", () => {
      const longName = "a".repeat(250);
      const result = FilenameValidator.validate(longName);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename exceeds maximum length of 200 characters",
      );
    });

    it("should use custom max length", () => {
      const result = FilenameValidator.validate("toolong", { maxLength: 5 });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Filename exceeds maximum length of 5 characters",
      );
    });

    it("should detect reserved Windows filenames", () => {
      const reservedNames = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"];

      for (const name of reservedNames) {
        const result = FilenameValidator.validate(name);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          `"${name}" is a reserved filename on Windows`,
        );
      }
    });

    it("should detect reserved Windows filenames case-insensitively", () => {
      const result = FilenameValidator.validate("con");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`"con" is a reserved filename on Windows`);
    });

    it("should detect leading dot", () => {
      const result = FilenameValidator.validate(".hidden");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Filename should not start with a dot");
    });

    it("should detect trailing dot", () => {
      const result = FilenameValidator.validate("filename.");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Filename should not end with a dot");
    });

    it("should detect trailing space", () => {
      const result = FilenameValidator.validate("filename ");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Filename should not end with a space");
    });

    it("should provide sanitized version even when invalid", () => {
      const result = FilenameValidator.validate("file/with:invalid*chars");

      expect(result.valid).toBe(false);
      expect(result.sanitized).toBe("file_with_invalid_chars");
    });
  });

  describe("sanitize", () => {
    it("should return empty string for empty input", () => {
      expect(FilenameValidator.sanitize("")).toBe("");
    });

    it("should return empty string for whitespace-only input", () => {
      expect(FilenameValidator.sanitize("   ")).toBe("");
    });

    it("should trim whitespace", () => {
      expect(FilenameValidator.sanitize("  filename  ")).toBe("filename");
    });

    it("should replace forward slash with underscore", () => {
      expect(FilenameValidator.sanitize("file/name")).toBe("file_name");
    });

    it("should replace backslash with underscore", () => {
      expect(FilenameValidator.sanitize("file\\name")).toBe("file_name");
    });

    it("should replace colon with underscore", () => {
      expect(FilenameValidator.sanitize("file:name")).toBe("file_name");
    });

    it("should replace all invalid characters at once", () => {
      expect(FilenameValidator.sanitize('f/i\\l:e*n?a"m<e>|')).toBe("f_i_l_e_n_a_m_e");
    });

    it("should use custom replacement character", () => {
      expect(
        FilenameValidator.sanitize("file/name", { replacementChar: "-" }),
      ).toBe("file-name");
    });

    it("should collapse multiple replacement characters", () => {
      expect(FilenameValidator.sanitize("file//name")).toBe("file_name");
    });

    it("should remove leading replacement characters", () => {
      expect(FilenameValidator.sanitize("/leading")).toBe("leading");
    });

    it("should remove trailing replacement characters", () => {
      expect(FilenameValidator.sanitize("trailing/")).toBe("trailing");
    });

    it("should remove leading dots", () => {
      expect(FilenameValidator.sanitize(".hidden")).toBe("hidden");
    });

    it("should remove multiple leading dots", () => {
      expect(FilenameValidator.sanitize("...hidden")).toBe("hidden");
    });

    it("should remove trailing dots", () => {
      expect(FilenameValidator.sanitize("filename.")).toBe("filename");
    });

    it("should remove trailing spaces", () => {
      expect(FilenameValidator.sanitize("filename ")).toBe("filename");
    });

    it("should truncate to max length", () => {
      const longName = "a".repeat(250);
      expect(FilenameValidator.sanitize(longName).length).toBe(200);
    });

    it("should truncate to custom max length", () => {
      expect(FilenameValidator.sanitize("toolongname", { maxLength: 5 })).toBe(
        "toolo",
      );
    });

    it("should handle reserved Windows names by appending underscore", () => {
      expect(FilenameValidator.sanitize("CON")).toBe("CON_");
    });

    it("should handle reserved Windows names case-insensitively", () => {
      expect(FilenameValidator.sanitize("con")).toBe("con_");
    });

    it("should preserve extension when handling reserved names", () => {
      expect(FilenameValidator.sanitize("CON.txt")).toBe("CON_.txt");
    });

    it("should handle complex case with multiple issues", () => {
      const result = FilenameValidator.sanitize("  ../path/to/file:name*test?   ");
      expect(result).toBe("path_to_file_name_test");
    });
  });

  describe("hasInvalidChars", () => {
    it("should return false for valid filename", () => {
      expect(FilenameValidator.hasInvalidChars("valid-filename")).toBe(false);
    });

    it("should return true for filename with slash", () => {
      expect(FilenameValidator.hasInvalidChars("file/name")).toBe(true);
    });

    it("should return true for filename with multiple invalid chars", () => {
      expect(FilenameValidator.hasInvalidChars("file:name*test")).toBe(true);
    });

    it("should return false for filename with only spaces", () => {
      expect(FilenameValidator.hasInvalidChars("file name")).toBe(false);
    });

    it("should return false for filename with special but valid chars", () => {
      expect(FilenameValidator.hasInvalidChars("file-name_v1.2.3")).toBe(false);
    });
  });

  describe("getInvalidChars", () => {
    it("should return empty array for valid filename", () => {
      expect(FilenameValidator.getInvalidChars("valid-filename")).toEqual([]);
    });

    it("should return array of invalid chars found", () => {
      const result = FilenameValidator.getInvalidChars("file/name:test");
      expect(result).toContain("/");
      expect(result).toContain(":");
    });

    it("should return unique invalid chars only", () => {
      const result = FilenameValidator.getInvalidChars("file/name/path/test");
      expect(result).toEqual(["/"]);
    });

    it("should detect all types of invalid chars", () => {
      const result = FilenameValidator.getInvalidChars('a/b\\c:d*e?f"g<h>i|j');
      expect(result).toContain("/");
      expect(result).toContain("\\");
      expect(result).toContain(":");
      expect(result).toContain("*");
      expect(result).toContain("?");
      expect(result).toContain('"');
      expect(result).toContain("<");
      expect(result).toContain(">");
      expect(result).toContain("|");
    });
  });

  describe("edge cases", () => {
    it("should handle unicode characters correctly", () => {
      const result = FilenameValidator.validate("файл-документ");
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("файл-документ");
    });

    it("should handle emoji in filename", () => {
      const result = FilenameValidator.validate("📄 document");
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("📄 document");
    });

    it("should handle filename with only extension", () => {
      const result = FilenameValidator.validate(".md");
      // Starts with dot so invalid, but sanitized removes leading dot
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBe("md");
    });

    it("should preserve internal dots in filename", () => {
      const result = FilenameValidator.sanitize("file.name.txt");
      expect(result).toBe("file.name.txt");
    });

    it("should handle single character filename", () => {
      const result = FilenameValidator.validate("a");
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("a");
    });

    it("should handle max length boundary", () => {
      const exactMaxLength = "a".repeat(200);
      const result = FilenameValidator.validate(exactMaxLength);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(exactMaxLength);
    });

    it("should handle filename that becomes empty after sanitization", () => {
      // All invalid characters
      const result = FilenameValidator.validate("///");
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBe("");
    });

    it("should handle null byte character", () => {
      const result = FilenameValidator.validate("file\x00name");
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBe("file_name");
    });

    it("should handle control characters", () => {
      const result = FilenameValidator.validate("file\x01\x02name");
      expect(result.valid).toBe(false);
      expect(result.sanitized).toBe("file_name");
    });
  });
});

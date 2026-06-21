import { injectable } from "tsyringe";

@injectable()
export class AlgorithmExtractor {
  extractH2Section(content: string, heading: string): string | null {
    const lines = content.split("\n");
    const targetHeading = `## ${heading}`;
    let inSection = false;
    const sectionContent: string[] = [];

    for (const line of lines) {
      if (line.trim() === targetHeading) {
        inSection = true;
        continue;
      }

      if (inSection) {
        if (line.startsWith("## ") || line.startsWith("# ")) {
          break;
        }
        sectionContent.push(line);
      }
    }

    if (sectionContent.length === 0) {
      return null;
    }

    const content_text = sectionContent.join("\n").trim();
    return content_text || null;
  }
}

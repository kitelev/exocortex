import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { EXO_LAYOUT_ONTOLOGY_FILES } from "../../../../src/infrastructure/ontology/ExoLayoutOntologyBootstrapper";

/**
 * Drift-guard: ensures the 18 bundled `exo__Layout` ontology literals in
 * `ExoLayoutOntologyBootstrapper.ts` remain byte-identical to the starter-kit
 * source-of-truth (`exocortex-starter-kit/exo/<uid>.md`, PR #87 / commit
 * 84101d3).
 *
 * This test is **local-only** — CI runners do not have the starter-kit repo
 * on disk, so the suite short-circuits cleanly when the starter-kit path is
 * not present. Developers can run this before opening a PR (or after pulling
 * starter-kit changes) to catch accidental drift before it ships.
 *
 * Why a separate test file: the main `ExoLayoutOntologyBootstrapper.test.ts`
 * suite is pure in-memory and must stay hermetic. Mixing filesystem reads
 * would make the primary unit tests non-portable.
 */

const STARTER_KIT_EXO_DIR = "/Users/kitelev/Developer/exocortex-development/exocortex-starter-kit/exo";

const canDrive = existsSync(STARTER_KIT_EXO_DIR);
const describeLocal = canDrive ? describe : describe.skip;

describeLocal("ExoLayoutOntologyBootstrapper — starter-kit drift-guard", () => {
  it("each bundled file matches the starter-kit source verbatim", () => {
    const mismatches: Array<{
      uid: string;
      mismatch: string;
    }> = [];
    for (const file of EXO_LAYOUT_ONTOLOGY_FILES) {
      const starterKitPath = resolve(
        STARTER_KIT_EXO_DIR,
        `${file.uid}.md`,
      );
      if (!existsSync(starterKitPath)) {
        mismatches.push({ uid: file.uid, mismatch: "file missing in starter-kit" });
        continue;
      }
      const starterKitContent = readFileSync(starterKitPath, "utf-8");
      if (starterKitContent !== file.content) {
        mismatches.push({
          uid: file.uid,
          mismatch: `content differs — bundle (${file.content.length} bytes) vs starter-kit (${starterKitContent.length} bytes)`,
        });
      }
    }

    if (mismatches.length > 0) {
      const summary = mismatches
        .map((m) => `  - ${m.uid}: ${m.mismatch}`)
        .join("\n");
      throw new Error(
        `Drift detected between bundled exo__Layout ontology and starter-kit ` +
          `source-of-truth (exocortex-starter-kit/exo/<uid>.md):\n${summary}\n\n` +
          `Fix: either update the string literals in ExoLayoutOntologyBootstrapper.ts ` +
          `to match starter-kit, OR revert the starter-kit change. Both must agree.`,
      );
    }
  });
});

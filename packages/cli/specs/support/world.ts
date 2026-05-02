import { setWorldConstructor, World, IWorldOptions } from "@cucumber/cucumber";

/**
 * Result of a CLI-style helper invocation.
 *
 * T6.2 will replace `helperResult` with a real `dyncommand exec` runner that
 * captures exit code, stdout, stderr and frontmatter mutations against a test
 * vault. This minimal shape is the contract the step layer relies on.
 */
export interface CliHelperResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CliBddWorld extends World {
  initialized = false;
  recordedValue: string | null = null;
  helperResult: CliHelperResult | null = null;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(CliBddWorld);

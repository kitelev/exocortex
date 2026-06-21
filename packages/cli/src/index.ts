#!/usr/bin/env node

import { createProgram } from "./program.js";

// Re-export for backwards-compatible imports.
export { createProgram } from "./program.js";

createProgram().parse();

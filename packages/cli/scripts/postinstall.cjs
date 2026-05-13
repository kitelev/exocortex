#!/usr/bin/env node
'use strict';
// Idempotent postinstall: copies ai-task-{runner,worker} to ~/.exocortex/bin/

const fs = require('fs');
const path = require('path');
const os = require('os');

const BIN_SRC = path.join(__dirname, '..', 'bin');
const BIN_DST = path.join(os.homedir(), '.exocortex', 'bin');

const SCRIPTS = ['ai-task-runner', 'ai-task-worker'];

try {
  fs.mkdirSync(BIN_DST, { recursive: true });
  for (const name of SCRIPTS) {
    const src = path.join(BIN_SRC, name);
    const dst = path.join(BIN_DST, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
    console.log(`[postinstall] installed ${name} → ${dst}`);
  }
} catch (err) {
  // Non-fatal: CI environments may not have HOME
  console.error(`[postinstall] skipped (${err.message})`);
  process.exit(0);
}

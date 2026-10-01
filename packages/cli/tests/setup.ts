import "reflect-metadata";
import os from "node:os";
import path from "node:path";

// req 086df113 — the immutable-object cache is ON by default in production and
// its store is DEVICE-wide (`~/.cache/exocortex/…`). A test run must never
// touch that store: it would both pollute the developer's real cache and make
// one suite's network-call counts depend on what an earlier suite fetched.
// Default OFF here, pinned to a throwaway root for any suite that opts back in.
process.env.EXOCORTEX_EXOSYNC_CACHE ??= "0";
process.env.EXOCORTEX_EXOSYNC_CACHE_DIR ??= path.join(
  os.tmpdir(),
  `exocortex-test-objcache-${process.pid}`,
);

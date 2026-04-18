# Desktop smoke vault

Minimal vault used by `e2e-desktop.yml` to launch Obsidian on macOS and Windows
GitHub-hosted runners and verify the Exocortex plugin loads.

The plugin payload (`main.js`, `manifest.json`, `styles.css` if present) is
copied into `.obsidian/plugins/exocortex/` by the workflow before launch.

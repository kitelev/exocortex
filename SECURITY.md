# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/kitelev/exocortex/security) of this repository.
2. Click **"Report a vulnerability"** to open a private advisory visible only to the maintainers.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a minimal vault / command sequence is ideal).
- Affected version(s) — plugin version (`manifest.json`) and/or CLI version (`npx @kitelev/exocortex-cli --version`).
- Any relevant logs (with secrets redacted).

We aim to acknowledge reports within a few days and will keep you informed of progress.

## Scope

Exocortex is **local-first**: your data lives in your own Obsidian vault and git
repositories — there is no Exocortex server. The most security-relevant surfaces are:

- **GitHub Personal Access Tokens (PATs)** used by Profile/ExoSync. By design, PATs are stored only in `data.local.json` (`LocalSecretsStore`), are excluded from Obsidian Sync via the `.local.` infix, and are **never** committed or written to the vault. ExoSync additionally scans every push payload for tokens/keys and refuses the push on a finding. See [docs/exosync.md](docs/how-to/exosync.md#security).
- **Vault file handling** — tarball extraction (AssetSpace bootstrap), path traversal guards, and RDF/frontmatter parsing.
- **The CLI** operating on untrusted vaults.

Reports about the above are in scope. The published AssetSpace ontology repositories
(`exoas-*`) are public data, not secrets.

## Supported versions

Only the **latest released version** (via BRAT for the plugin, latest npm for the CLI)
is supported. Please update before reporting — many issues are fixed in newer releases.

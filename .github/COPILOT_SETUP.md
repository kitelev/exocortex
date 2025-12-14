# GitHub Copilot Configuration

This document explains the GitHub Copilot setup for the Exocortex Obsidian Plugin repository.

## Overview

The repository is configured to work with GitHub Copilot using the Model Context Protocol (MCP), providing the AI coding assistant with comprehensive context about the project structure, coding standards, and development workflow.

## Configuration Files

### `.github/copilot-instructions.md`

The primary configuration file that provides GitHub Copilot with:

- **Project Overview**: Description of Exocortex, its purpose, and technical architecture
- **Code Style Standards**: TypeScript, React, and organizational guidelines
- **Development Commands**: npm scripts for building, testing, and linting
- **Testing Requirements**: Coverage thresholds and quality gates
- **Common Patterns**: Result pattern, Service pattern, Adapter pattern used in the codebase
- **Property Schema**: Frontmatter property definitions and usage
- **Performance Guidelines**: Optimization standards and benchmarks
- **Workflow Instructions**: Step-by-step guides for common development tasks

This file is automatically read by GitHub Copilot and used to provide context-aware code suggestions, completions, and automated coding assistance.

## How It Works

### For Developers

When you use GitHub Copilot in this repository:

1. **Context-Aware Suggestions**: Copilot understands the monorepo structure, Clean Architecture layers, and project-specific patterns
2. **Style Compliance**: Code suggestions follow the established TypeScript and React conventions
3. **Pattern Recognition**: Copilot suggests code that aligns with Result pattern, Service pattern, and other established patterns
4. **Testing Awareness**: Copilot knows the coverage thresholds and test requirements
5. **Command Awareness**: Copilot can suggest the correct npm scripts for common tasks

### For GitHub Copilot Coding Agent

When using the GitHub Copilot coding agent (available for Copilot Business and Enterprise):

1. The agent reads `.github/copilot-instructions.md` to understand the project
2. It can automatically create pull requests that follow the repository's conventions
3. It respects the testing requirements and quality standards
4. It understands the monorepo structure and makes changes to the appropriate packages

## Usage

### In VS Code

1. Install the GitHub Copilot extension
2. Open the repository
3. Copilot will automatically read the instructions file
4. Start coding - suggestions will be context-aware

### With Copilot Chat

Ask questions about the codebase, and Copilot Chat will use the instructions to provide accurate, project-specific answers:

- "How do I create a new service in this project?"
- "What's the pattern for error handling in this codebase?"
- "How do I run the tests?"

### With Copilot Coding Agent

Assign issues to the Copilot coding agent, and it will:

1. Read the instructions to understand the project structure
2. Make changes following the established patterns and conventions
3. Run the appropriate tests and quality checks
4. Create a pull request with properly formatted code

## Maintenance

### Updating Instructions

When project standards or conventions change:

1. Update `.github/copilot-instructions.md`
2. Keep it synchronized with `AGENTS.md`, `ARCHITECTURE.md`, and `CLAUDE.md`
3. Commit the changes - Copilot will use the updated instructions immediately

### Best Practices

- **Keep it concise**: Copilot works best with clear, actionable instructions
- **Update regularly**: Keep instructions in sync with actual project conventions
- **Be specific**: Provide concrete examples and patterns rather than vague guidelines
- **Reference docs**: Link to other documentation files for detailed information

## Advanced Configuration (Optional)

### Scoped Instructions

For more granular control, you can create additional instruction files:

```
.github/
  instructions/
    core.instructions.md        # Instructions for exocortex package
    obsidian-plugin.instructions.md  # Instructions for UI layer
    testing.instructions.md     # Testing-specific guidelines
```

Each file can use YAML frontmatter to target specific paths:

```markdown
---
paths:
  - packages/exocortex/**
---
# Core Package Instructions

Business logic should be storage-agnostic...
```

### MCP Servers

For local development with MCP servers (VS Code):

1. Create `.vscode/mcp.json` (not tracked in git)
2. Configure MCP servers for additional context (file system, database, etc.)
3. See [VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)

Example `.vscode/mcp.json`:

```json
{
  "servers": [
    {
      "name": "file-server",
      "command": "node",
      "args": ["path/to/mcp-server.js"]
    }
  ]
}
```

Note: MCP server configuration is optional and primarily useful for VS Code users who want enhanced local context.

## Troubleshooting

### Copilot suggestions don't follow project conventions

1. Check that `.github/copilot-instructions.md` is up to date
2. Restart your IDE to reload the configuration
3. Clear Copilot cache if available

### Agent creates PRs that don't pass CI

1. Verify the instructions file includes testing requirements
2. Ensure coverage thresholds are documented
3. Check that build and lint commands are listed

## Resources

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [Model Context Protocol (MCP)](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp)
- [Custom Instructions Guide](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
- [Copilot Best Practices](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results)

## Version History

- **2025-10-29**: Initial setup with `.github/copilot-instructions.md`
  - Configured for Exocortex Obsidian Plugin v0.0.0-dev
  - Based on GitHub's MCP and Copilot best practices
  - Includes comprehensive project context for TypeScript/React monorepo

---

For questions or improvements to the Copilot configuration, please open an issue or PR.

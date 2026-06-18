# Plugin Development Guide

**Extending Exocortex with custom functionality.**

---

## Quick Start

### Project Setup

Exocortex is developed in a monorepo (npm workspaces) — not inside a vault's `.obsidian/plugins/` folder:

```bash
git clone git@github.com:kitelev/exocortex.git
cd exocortex
npm install
npm run dev  # Watch mode for @exocortex/obsidian-plugin (root script: npm run dev -w @exocortex/obsidian-plugin)
```

### Package Structure

```
packages/
├── exocortex/          # Core: domain models, RDF, SPARQL, services (storage-agnostic)
├── obsidian-plugin/    # @exocortex/obsidian-plugin — Obsidian UI integration
├── cli/                # @kitelev/exocortex-cli — command-line tools
├── services/           # @kitelev/exocortex-services — shared grounding-service factories
└── test-utils/         # @exocortex/test-utils — shared test infrastructure
```

> `packages/exoas-exo` and `packages/exoas-exocmd` are data submodules (ontology assets), not code packages.

---

## Adding a New Command

There are two paths, depending on what the command does:

| Path | Use for |
| --- | --- |
| **(a) Global UI command** — TypeScript `ICommand` | Plugin-level UI actions that need app/plugin dependencies (reload layout, open a modal, toggle a view) |
| **(b) Homoiconic exocmd command** — vault asset | Domain commands that operate on assets (status transitions, creation, planning). **Preferred path** — no plugin code change required |

### (a) Global UI command

#### 1. Create the command class

`packages/obsidian-plugin/src/application/commands/MyCustomCommand.ts`:

```typescript
import { ICommand } from './ICommand';

export class MyCustomCommand implements ICommand {
  id = 'my-custom-command';
  name = 'My Custom Command';

  callback = async (): Promise<void> => {
    // Your logic here
  };
}
```

`ICommand` (`src/application/commands/ICommand.ts`) accepts either a plain `callback` or a `checkCallback(checking, file, context)` for commands that should only be offered on certain notes.

#### 2. Register it

`CommandRegistry` receives the global commands through its constructor (`CommandRegistry.ts`); the array is assembled in `CommandManager.registerAllCommands` (`src/application/services/CommandManager.ts`):

```typescript
const globalCommands = [
  new ReloadLayoutCommand(reloadLayoutCallback, notifier),
  // ... existing commands
  new MyCustomCommand(),
];

this.commandRegistry = new CommandRegistry(globalCommands);
```

`CommandManager` then registers each entry with Obsidian (`plugin.addCommand`), wiring `checkCallback` to the active file's context automatically.

### (b) Homoiconic exocmd command (preferred for domain commands)

Per-asset commands are **not** defined in TypeScript. They are declared as `exocmd__Command` assets in the vault (the exocmd AssetSpace) and resolved at runtime by `CommandResolver` via SPARQL. Per-asset visibility is controlled by vault-declared preconditions (`exocmd__Command_precondition` — SPARQL ASK or registered host function); the former `CommandVisibility.ts` module has been removed.

To add a domain command, create a command asset plus a grounding asset in your exocmd AssetSpace — use the existing assets in [exoas-exocmd](https://github.com/kitelev/exoas-exocmd) as templates. No plugin rebuild is needed: the plugin picks the new command up from the vault.

---

## Creating a Renderer

### 1. Create Renderer Class

Renderers are standalone classes that accept dependencies via constructor and expose
a `render` method. There is no `BaseRenderer` base class to extend.

`src/presentation/renderers/layout/MyCustomRenderer.ts`:

```typescript
import { App } from 'obsidian';
import { IVaultAdapter } from 'exocortex';

export class MyCustomRenderer {
  constructor(
    private app: App,
    private vault: IVaultAdapter,
  ) {}

  async render(
    container: HTMLElement,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const section = container.createDiv({ cls: 'my-custom-section' });
    section.createEl('h3', { text: 'My Custom Section' });

    // Render logic using this.app, this.vault, metadata
  }
}
```

### 2. Register Renderer

`src/presentation/renderers/UniversalLayoutRenderer.ts`:

```typescript
private async renderCustomSection(container: HTMLElement): Promise<void> {
  const renderer = new MyCustomRenderer(this.app, this.vault);
  await renderer.render(container, this.metadata);
}
```

---

## Adding a Modal

### 1. Create Modal Class

```typescript
import { App, Modal } from 'obsidian';

export class MyCustomModal extends Modal {
  private onSubmit: (result: MyResult) => void;

  constructor(app: App, onSubmit: (result: MyResult) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'My custom modal' });

    // Form elements
    const input = contentEl.createEl('input', { type: 'text' });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    const okButton = buttonContainer.createEl('button', { text: 'OK', cls: 'mod-cta' });
    okButton.addEventListener('click', () => this.submit());
  }

  private submit(): void {
    this.onSubmit({ /* result */ });
    this.close();
  }
}
```

### 2. Use Modal in Command

```typescript
callback = async (): Promise<void> => {
  const modal = new MyCustomModal(
    this.plugin.app,
    async (result) => {
      // Handle result
    }
  );
  modal.open();
};
```

---

## Testing

### Unit Tests

`tests/unit/MyCustomCommand.test.ts`:

```typescript
import { MyCustomCommand } from '../../src/application/commands/MyCustomCommand';

describe('MyCustomCommand', () => {
  let command: MyCustomCommand;

  beforeEach(() => {
    command = new MyCustomCommand();
  });

  it('should execute successfully', async () => {
    await command.callback();
    // Assertions
  });
});
```

### Run Tests

```bash
npm run test:all  # All tests
npm run test:unit  # Unit tests only
```

---

## Build and Release

```bash
npm run build  # Production build
npm run dev    # Development watch mode
```

Before publishing a major release, run the mobile smoke checklist on a real
device — GitHub Actions does not cover iOS/Android WebView:

- [Mobile Smoke Release Checklist](../../packages/obsidian-plugin/docs/release-checklist-mobile.md)

---

**See also:**
- [Core API Reference](../reference/Core-API.md)
- [Testing Guide](../../TESTING.md)
- [Mobile Smoke Release Checklist](../../packages/obsidian-plugin/docs/release-checklist-mobile.md)

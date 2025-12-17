# Plugin Development Guide

**Extending Exocortex with custom functionality.**

---

## Quick Start

### Project Setup

```bash
cd /your/vault/.obsidian/plugins/exocortex
npm install
npm run dev  # Watch mode
```

### Package Structure

```
packages/
├── core/                    # Business logic (storage-agnostic)
├── obsidian-plugin/         # Obsidian UI integration
└── cli/                     # Command-line tools
```

---

## Adding a New Command

### 1. Create Command Class

`src/application/commands/MyCustomCommand.ts`:

```typescript
import { ICommand } from '../interfaces/ICommand';
import type ExocortexPlugin from '../../main';

export class MyCustomCommand implements ICommand {
  id = 'my-custom-command';
  name = 'My Custom Command';

  constructor(private plugin: ExocortexPlugin) {}

  callback = async (): Promise<void> => {
    const { workspace } = this.plugin.app;
    const activeFile = workspace.getActiveFile();

    if (!activeFile) {
      return;
    }

    // Your logic here
  };
}
```

### 2. Register Command

`src/application/commands/CommandRegistry.ts`:

```typescript
import { MyCustomCommand } from './MyCustomCommand';

export class CommandRegistry {
  constructor(private plugin: ExocortexPlugin) {
    // Add to commands array
    this.commands = [
      // ... existing commands
      new MyCustomCommand(plugin),
    ];
  }
}
```

### 3. Add Visibility Rules

`packages/exocortex/src/domain/commands/CommandVisibility.ts`:

```typescript
export function canExecuteMyCustomCommand(metadata: Record<string, any>): boolean {
  return metadata.exo__Instance_class === 'ems__Task';
}
```

---

## Creating a Renderer

### 1. Create Renderer Class

`src/presentation/renderers/layout/MyCustomRenderer.ts`:

```typescript
import { BaseRenderer } from './BaseRenderer';

export class MyCustomRenderer extends BaseRenderer {
  async render(
    container: HTMLElement,
    metadata: Record<string, any>
  ): Promise<void> {
    const section = container.createDiv({ cls: 'my-custom-section' });
    section.createEl('h3', { text: 'My Custom Section' });

    // Render logic
  }
}
```

### 2. Register Renderer

`src/presentation/renderers/layout/UniversalLayoutRenderer.ts`:

```typescript
private renderCustomSection(container: HTMLElement): void {
  const renderer = new MyCustomRenderer(this.app, this.plugin);
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
  let mockPlugin: any;

  beforeEach(() => {
    mockPlugin = {
      app: { workspace: { getActiveFile: jest.fn() } }
    };
    command = new MyCustomCommand(mockPlugin);
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

---

**See also:**
- [Core API Reference](api/Core-API.md)
- [Testing Guide](Testing-Guide.md)

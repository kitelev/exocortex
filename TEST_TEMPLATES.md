# Test Implementation Templates
## Ready-to-Use Patterns for Issue #156

---

## Template 1: Utility Class Tests (FrontmatterService, DateFormatter)

### Example: FrontmatterService.test.ts

```typescript
/**
 * Tests for FrontmatterService
 * Target: 80% coverage (242/303 statements)
 */

import { FrontmatterService, FrontmatterParseResult } from '../../src/utilities/FrontmatterService';

describe('FrontmatterService', () => {
  let service: FrontmatterService;

  beforeEach(() => {
    service = new FrontmatterService();
  });

  describe('parseFrontmatter', () => {
    it('should parse existing frontmatter', () => {
      const content = `---
title: Test
status: draft
---
# Content`;

      const result: FrontmatterParseResult = service.parseFrontmatter(content);

      expect(result.exists).toBe(true);
      expect(result.content).toContain('title: Test');
      expect(result.content).toContain('status: draft');
    });

    it('should handle missing frontmatter', () => {
      const content = `# Content without frontmatter`;

      const result = service.parseFrontmatter(content);

      expect(result.exists).toBe(false);
      expect(result.content).toBe('');
    });

    it('should handle empty frontmatter block', () => {
      const content = `---
---
# Content`;

      const result = service.parseFrontmatter(content);

      expect(result.exists).toBe(true);
      expect(result.content).toBe('');
    });

    it('should handle malformed frontmatter', () => {
      const content = `---
invalid yaml: [missing bracket
---`;

      // Should not throw, should handle gracefully
      expect(() => service.parseFrontmatter(content)).not.toThrow();
    });
  });

  describe('updateProperty', () => {
    it('should update existing property', () => {
      const content = `---
status: draft
---
# Content`;

      const result = service.updateProperty(content, 'status', 'done');

      expect(result).toContain('status: done');
      expect(result).not.toContain('status: draft');
    });

    it('should add property if missing', () => {
      const content = `---
title: Test
---
# Content`;

      const result = service.updateProperty(content, 'status', 'draft');

      expect(result).toContain('title: Test');
      expect(result).toContain('status: draft');
    });

    it('should create frontmatter if missing', () => {
      const content = `# Content without frontmatter`;

      const result = service.updateProperty(content, 'status', 'draft');

      expect(result).toContain('---');
      expect(result).toContain('status: draft');
      expect(result).toContain('# Content without frontmatter');
    });

    it('should handle special characters in property name', () => {
      const content = `---
---
# Content`;

      const result = service.updateProperty(content, 'ems__Effort_status', 'value');

      expect(result).toContain('ems__Effort_status: value');
    });

    it('should handle quoted values with brackets', () => {
      const content = `---
---
# Content`;

      const result = service.updateProperty(content, 'status', '"[[StatusDone]]"');

      expect(result).toContain('status: "[[StatusDone]]"');
    });

    it('should preserve other properties', () => {
      const content = `---
title: Test
author: John
status: draft
---
# Content`;

      const result = service.updateProperty(content, 'status', 'done');

      expect(result).toContain('title: Test');
      expect(result).toContain('author: John');
      expect(result).toContain('status: done');
    });

    it('should handle multiline property values', () => {
      const content = `---
description: |
  Line 1
  Line 2
---
# Content`;

      const result = service.updateProperty(content, 'status', 'draft');

      expect(result).toContain('description: |');
      expect(result).toContain('status: draft');
    });
  });

  describe('addProperty', () => {
    it('should add new property to existing frontmatter', () => {
      const content = `---
title: Test
---
# Content`;

      const result = service.addProperty(content, 'status', 'draft');

      expect(result).toContain('title: Test');
      expect(result).toContain('status: draft');
    });

    it('should not overwrite existing property', () => {
      const content = `---
status: done
---
# Content`;

      const result = service.addProperty(content, 'status', 'draft');

      expect(result).toContain('status: done');
      expect(result).not.toContain('status: draft');
    });

    it('should create frontmatter if missing', () => {
      const content = `# Content`;

      const result = service.addProperty(content, 'status', 'draft');

      expect(result).toContain('---');
      expect(result).toContain('status: draft');
    });
  });

  describe('removeProperty', () => {
    it('should remove existing property', () => {
      const content = `---
title: Test
status: draft
author: John
---
# Content`;

      const result = service.removeProperty(content, 'status');

      expect(result).toContain('title: Test');
      expect(result).toContain('author: John');
      expect(result).not.toContain('status');
    });

    it('should handle missing property gracefully', () => {
      const content = `---
title: Test
---
# Content`;

      const result = service.removeProperty(content, 'status');

      expect(result).toEqual(content);
    });

    it('should handle missing frontmatter gracefully', () => {
      const content = `# Content`;

      const result = service.removeProperty(content, 'status');

      expect(result).toEqual(content);
    });

    it('should remove property with special characters', () => {
      const content = `---
ems__Effort_status: draft
---
# Content`;

      const result = service.removeProperty(content, 'ems__Effort_status');

      expect(result).not.toContain('ems__Effort_status');
    });
  });

  describe('hasProperty', () => {
    it('should return true for existing property', () => {
      const content = `---
status: draft
---`;

      expect(service.hasProperty(content, 'status')).toBe(true);
    });

    it('should return false for missing property', () => {
      const content = `---
title: Test
---`;

      expect(service.hasProperty(content, 'status')).toBe(false);
    });

    it('should return false when no frontmatter', () => {
      const content = `# Content`;

      expect(service.hasProperty(content, 'status')).toBe(false);
    });
  });

  describe('getProperty', () => {
    it('should return property value', () => {
      const content = `---
status: draft
---`;

      expect(service.getProperty(content, 'status')).toBe('draft');
    });

    it('should return null for missing property', () => {
      const content = `---
title: Test
---`;

      expect(service.getProperty(content, 'status')).toBeNull();
    });

    it('should return null when no frontmatter', () => {
      const content = `# Content`;

      expect(service.getProperty(content, 'status')).toBeNull();
    });

    it('should handle quoted values', () => {
      const content = `---
status: "[[StatusDone]]"
---`;

      expect(service.getProperty(content, 'status')).toBe('"[[StatusDone]]"');
    });
  });
});
```

---

## Template 2: Service Tests with Mocked Dependencies

### Example: StatusTimestampService.test.ts

```typescript
import { StatusTimestampService } from '../../src/services/StatusTimestampService';
import { IVaultAdapter, IFile } from '../../src/interfaces/IVaultAdapter';

// Mock helper
function createMockVault(): jest.Mocked<IVaultAdapter> {
  return {
    read: jest.fn(),
    modify: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getFiles: jest.fn(),
    getAbstractFileByPath: jest.fn(),
  } as any;
}

function createMockFile(path: string): IFile {
  return {
    path,
    basename: path.split('/').pop()?.replace('.md', '') || '',
    extension: 'md',
  } as IFile;
}

describe('StatusTimestampService', () => {
  let service: StatusTimestampService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = createMockVault();
    service = new StatusTimestampService(mockVault);
  });

  describe('recordStatusChange', () => {
    it('should add timestamp property for new status', async () => {
      const file = createMockFile('task.md');
      mockVault.read.mockResolvedValue(`---
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
# Task`);

      await service.recordStatusChange(file, 'todo', 'doing');

      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining('ems__doing_timestamp')
      );
    });

    it('should not overwrite existing timestamp', async () => {
      const existingTimestamp = '2025-01-15T10:00:00';
      const file = createMockFile('task.md');
      mockVault.read.mockResolvedValue(`---
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__doing_timestamp: ${existingTimestamp}
---
# Task`);

      await service.recordStatusChange(file, 'doing', 'done');

      const modifiedContent = mockVault.modify.mock.calls[0][1] as string;
      expect(modifiedContent).toContain(`ems__doing_timestamp: ${existingTimestamp}`);
    });

    it('should handle missing frontmatter', async () => {
      const file = createMockFile('task.md');
      mockVault.read.mockResolvedValue('# Task without frontmatter');

      await service.recordStatusChange(file, 'todo', 'doing');

      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining('---')
      );
    });
  });

  describe('getStatusTimestamps', () => {
    it('should return all status timestamps', async () => {
      const file = createMockFile('task.md');
      mockVault.read.mockResolvedValue(`---
ems__todo_timestamp: 2025-01-15T10:00:00
ems__doing_timestamp: 2025-01-15T11:00:00
ems__done_timestamp: 2025-01-15T12:00:00
---`);

      const timestamps = await service.getStatusTimestamps(file);

      expect(timestamps).toEqual({
        todo: '2025-01-15T10:00:00',
        doing: '2025-01-15T11:00:00',
        done: '2025-01-15T12:00:00',
      });
    });

    it('should return empty object when no timestamps', async () => {
      const file = createMockFile('task.md');
      mockVault.read.mockResolvedValue('# Task');

      const timestamps = await service.getStatusTimestamps(file);

      expect(timestamps).toEqual({});
    });
  });
});
```

---

## Template 3: UI Component Tests (UniversalLayoutRenderer)

### Example: UniversalLayoutRenderer.test.ts

```typescript
import { UniversalLayoutRenderer } from '../../src/presentation/renderers/UniversalLayoutRenderer';
import { App, TFile, MetadataCache } from 'obsidian';
import { ExocortexSettings } from '../../src/domain/settings/ExocortexSettings';

// Mock Obsidian App
function createMockApp(): jest.Mocked<App> {
  return {
    vault: {
      getFiles: jest.fn(),
      read: jest.fn(),
      getAbstractFileByPath: jest.fn(),
    },
    metadataCache: {
      getFileCache: jest.fn(),
      getCache: jest.fn(),
    },
  } as any;
}

function createMockFile(path: string, metadata: Record<string, any> = {}): TFile {
  return {
    path,
    basename: path.split('/').pop()?.replace('.md', '') || '',
    extension: 'md',
    stat: { mtime: Date.now(), ctime: Date.now(), size: 100 },
  } as TFile;
}

describe('UniversalLayoutRenderer', () => {
  let renderer: UniversalLayoutRenderer;
  let mockApp: jest.Mocked<App>;
  let mockSettings: ExocortexSettings;

  beforeEach(() => {
    mockApp = createMockApp();
    mockSettings = {
      layoutVisible: true,
      propertiesVisible: true,
      showArchivedAssets: false,
    };
    renderer = new UniversalLayoutRenderer(mockApp, mockSettings);
  });

  describe('extractAssetRelations', () => {
    it('should extract relations from frontmatter links', () => {
      const file = createMockFile('project.md');
      const metadata = {
        frontmatter: {
          ems__Area: '[[Area1]]',
          ems__Effort_responsible: '[[Person1]]',
        },
      };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(metadata);
      (mockApp.vault.getFiles as jest.Mock).mockReturnValue([
        createMockFile('Area1.md'),
        createMockFile('Person1.md'),
      ]);

      const relations = renderer.extractAssetRelations(file);

      expect(relations).toHaveLength(2);
      expect(relations[0].title).toBe('Area1');
      expect(relations[1].title).toBe('Person1');
    });

    it('should filter archived assets when setting disabled', () => {
      mockSettings.showArchivedAssets = false;
      const file = createMockFile('project.md');

      // Test filtering logic
      // ...
    });

    it('should handle missing metadata gracefully', () => {
      const file = createMockFile('project.md');
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);

      const relations = renderer.extractAssetRelations(file);

      expect(relations).toEqual([]);
    });
  });

  describe('shouldRenderLayout', () => {
    it('should return true when layout is visible', () => {
      mockSettings.layoutVisible = true;

      expect(renderer.shouldRenderLayout()).toBe(true);
    });

    it('should return false when layout is hidden', () => {
      mockSettings.layoutVisible = false;

      expect(renderer.shouldRenderLayout()).toBe(false);
    });
  });

  // Focus on DATA TRANSFORMATION, not DOM rendering
  describe('prepareTableData', () => {
    it('should sort assets by title', () => {
      const assets = [
        { title: 'C-Asset', path: 'c.md' },
        { title: 'A-Asset', path: 'a.md' },
        { title: 'B-Asset', path: 'b.md' },
      ];

      const sorted = renderer.prepareTableData(assets, { sortBy: 'title', sortOrder: 'asc' });

      expect(sorted[0].title).toBe('A-Asset');
      expect(sorted[1].title).toBe('B-Asset');
      expect(sorted[2].title).toBe('C-Asset');
    });

    it('should filter by asset class', () => {
      // Test filtering logic
    });
  });
});
```

---

## Template 4: Command Tests (CreateInstanceCommand)

### Example: CreateInstanceCommand.test.ts

```typescript
import { CreateInstanceCommand } from '../../src/application/commands/CreateInstanceCommand';
import { App, TFile } from 'obsidian';
import { ConceptCreationService } from 'exocortex';

describe('CreateInstanceCommand', () => {
  let command: CreateInstanceCommand;
  let mockApp: jest.Mocked<App>;
  let mockService: jest.Mocked<ConceptCreationService>;

  beforeEach(() => {
    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(),
      },
      workspace: {
        getActiveFile: jest.fn(),
      },
    } as any;

    mockService = {
      createInstance: jest.fn(),
    } as any;

    command = new CreateInstanceCommand(mockApp, mockService);
  });

  describe('canExecute', () => {
    it('should return true when active file is a Class', () => {
      const classFile = createMockFile('MyClass.md', {
        ems__Asset_hasInstanceClass: '[[ems__OwlClass]]',
      });
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(classFile);

      expect(command.canExecute()).toBe(true);
    });

    it('should return false when no active file', () => {
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(null);

      expect(command.canExecute()).toBe(false);
    });

    it('should return false when file is not a Class', () => {
      const nonClassFile = createMockFile('Note.md', {});
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(nonClassFile);

      expect(command.canExecute()).toBe(false);
    });
  });

  describe('execute', () => {
    it('should create instance with modal input', async () => {
      const classFile = createMockFile('MyClass.md');
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(classFile);

      // Mock modal input
      const instanceName = 'MyInstance';
      mockService.createInstance.mockResolvedValue(createMockFile('MyInstance.md'));

      await command.execute();

      expect(mockService.createInstance).toHaveBeenCalledWith(
        classFile,
        expect.stringContaining(instanceName)
      );
    });

    it('should handle service errors gracefully', async () => {
      const classFile = createMockFile('MyClass.md');
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(classFile);

      mockService.createInstance.mockRejectedValue(new Error('Creation failed'));

      // Should not throw
      await expect(command.execute()).resolves.not.toThrow();
    });
  });
});
```

---

## Template 5: Visibility Function Tests (CommandVisibility)

### Example: CommandVisibility.test.ts (enhance existing)

```typescript
import {
  canCreateInstance,
  canCreateProject,
  canVoteOnEffort,
  canArchiveTask,
  // ... other functions
} from '../../src/domain/commands/CommandVisibility';

describe('CommandVisibility', () => {
  describe('canCreateInstance', () => {
    it('should return true for Class asset', () => {
      const metadata = {
        ems__Asset_hasInstanceClass: '[[ems__OwlClass]]',
      };

      expect(canCreateInstance(metadata)).toBe(true);
    });

    it('should return false for non-Class asset', () => {
      const metadata = {};

      expect(canCreateInstance(metadata)).toBe(false);
    });

    it('should return false for archived Class', () => {
      const metadata = {
        ems__Asset_hasInstanceClass: '[[ems__OwlClass]]',
        ems__Asset_archived: 'true',
      };

      expect(canCreateInstance(metadata)).toBe(false);
    });
  });

  describe('canVoteOnEffort', () => {
    it('should return true for unvoted Effort', () => {
      const metadata = {
        ems__Asset_hasInstanceClass: '[[ems__Effort]]',
      };

      expect(canVoteOnEffort(metadata)).toBe(true);
    });

    it('should return false for already voted Effort', () => {
      const metadata = {
        ems__Asset_hasInstanceClass: '[[ems__Effort]]',
        ems__Effort_votes: ['vote1', 'vote2'],
      };

      expect(canVoteOnEffort(metadata)).toBe(false);
    });

    it('should return false for archived Effort', () => {
      const metadata = {
        ems__Asset_hasInstanceClass: '[[ems__Effort]]',
        ems__Asset_archived: '[[ems__ArchivalStatusArchived]]',
      };

      expect(canVoteOnEffort(metadata)).toBe(false);
    });

    it('should return false for non-Effort asset', () => {
      const metadata = {
        ems__Asset_hasInstanceClass: '[[ems__Project]]',
      };

      expect(canVoteOnEffort(metadata)).toBe(false);
    });
  });

  // ... test all visibility functions (40-50 test cases total)
});
```

---

## Mock Helpers Library

### Create: packages/exocortex/tests/helpers/mockFactory.ts

```typescript
import { IVaultAdapter, IFile } from '../../src/interfaces/IVaultAdapter';

export function createMockVault(): jest.Mocked<IVaultAdapter> {
  return {
    read: jest.fn(),
    modify: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getFiles: jest.fn(),
    getAbstractFileByPath: jest.fn(),
  } as any;
}

export function createMockFile(
  path: string,
  metadata: Record<string, any> = {}
): IFile {
  return {
    path,
    basename: path.split('/').pop()?.replace('.md', '') || '',
    extension: 'md',
    stat: { mtime: Date.now(), ctime: Date.now(), size: 100 },
    metadata,
  } as IFile;
}

export function createMockContent(
  frontmatter: Record<string, any>,
  body: string = '# Content'
): string {
  const yamlLines = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  return `---\n${yamlLines}\n---\n${body}`;
}
```

---

## Running Tests

### Individual File
```bash
npx jest packages/exocortex/tests/utilities/FrontmatterService.test.ts
```

### All Core Tests
```bash
npx jest --config packages/exocortex/jest.config.js
```

### With Coverage
```bash
COVERAGE=true CI=true npx jest --config packages/obsidian-plugin/jest.config.js --coverage --runInBand
```

### Watch Mode (Development)
```bash
npx jest --watch packages/exocortex/tests/utilities/FrontmatterService.test.ts
```

---

## Coverage Verification

After implementing tests, verify:

```bash
# Run full test suite with coverage
COVERAGE=true CI=true npx jest --config packages/obsidian-plugin/jest.config.js --coverage --runInBand | grep "All files"

# Should show:
# All files | 70.XX% | ...
```

---

## Common Pitfalls to Avoid

1. **Don't test implementation details** - Test behavior, not internals
2. **Mock at boundaries** - Mock external dependencies (Vault), not internal services
3. **Keep tests focused** - One concept per test
4. **Use descriptive names** - "should update property when frontmatter exists"
5. **Test edge cases** - Empty strings, null, undefined, malformed input
6. **Avoid test interdependence** - Each test should run independently
7. **Clean up after tests** - Use `afterEach` to reset mocks

---

## Quick Reference: Test Count Estimates

| File | Lines | Target % | Est. Tests |
|------|-------|----------|------------|
| FrontmatterService.ts | 303 | 80% | 25-30 |
| DateFormatter.ts | 209 | 85% | 15-20 |
| CommandVisibility.ts | 515 | 70% | 40-50 |
| StatusTimestampService.ts | 113 | 75% | 10-12 |
| MetadataHelpers.ts | 113 | 80% | 12-15 |
| UniversalLayoutRenderer.ts | 683 | 50% | 20-25 |
| ExocortexPlugin.ts | 225 | 50% | 10-12 |
| ButtonGroupsBuilder.ts | 580 | 60% | 15-20 |

**Total New Tests:** ~160-200 test cases across 15 days

---

**Ready to start? Begin with:**
```bash
touch packages/exocortex/tests/utilities/FrontmatterService.test.ts
# Copy Template 1 above and start implementing!
```

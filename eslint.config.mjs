import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidianPlugin from 'eslint-plugin-obsidianmd';
import prettierConfig from 'eslint-config-prettier';
// #4232 — `obsidianmd/ui/sentence-case` options REPLACE the plugin's default
// brand/acronym lists (`options?.brands ?? DEFAULT_BRANDS`), they do not extend
// them. Import the defaults (deep path — the package has no `exports` map) so
// our additions come ON TOP of GitHub/Obsidian/macOS/HTTP/… A plugin upgrade that
// moves these files fails config loading LOUDLY, which beats silently losing 120
// default entries.
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import { DEFAULT_ACRONYMS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...obsidianPlugin.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // ESLint-only TS project that re-includes test files (build tsconfig.json
        // excludes packages/**/tests/**/*). Enables type-aware linting of the test
        // corpus — `eslint packages/core/tests/**` otherwise errors 'file not found
        // in provided project(s)'. Build/typecheck (tsc --noEmit) still uses
        // tsconfig.json and never compiles tests. See task d7f89d46.
        project: './tsconfig.eslint.json',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',

      'no-console': 'error',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'off',
      'no-control-regex': 'warn',
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-regex-spaces': 'error',

      'obsidianmd/commands/no-default-hotkeys': 'warn',
      'obsidianmd/vault/iterate': 'warn',
      'obsidianmd/prefer-file-manager-trash-file': 'warn',
      'obsidianmd/platform': 'warn',
      'obsidianmd/regex-lookbehind': 'error',
      'obsidianmd/no-sample-code': 'warn',
      // #4232 — brands / acronyms / literal placeholders that the sentence-case
      // rule must preserve, configured ONCE here instead of per-call-site
      // `eslint-disable` directives (eslint-plugin-obsidianmd 0.4.1 forbids
      // disabling any obsidianmd/* rule inline).
      'obsidianmd/ui/sentence-case': ['warn', {
        // Defaults first (GitHub, Obsidian, macOS, …), then the product's own
        // proper nouns. ⛔ Every addition changes what the rule DEMANDS elsewhere
        // («Copy uid» would become «Copy UID» if UID were listed) — add only
        // what a real UI string needs and re-run the whole-src config diff.
        brands: [...DEFAULT_BRANDS, 'Exocortex', 'ExoSync', 'BRAT', 'AssetSpace', 'EKA'],
        acronyms: [...DEFAULT_ACRONYMS, 'PAT', 'SHACL', 'SPARQL', 'RDF'],
        // ⚠ A match ANYWHERE exempts the WHOLE string (plugin semantics) — the
        // prose around a matched path is not checked. Accepted trade-off: the
        // plugin cannot exempt a substring, and every current match is a bare
        // placeholder or a path-bearing sentence already in sentence case.
        ignoreRegex: [
          '^github_pat_',          // literal token placeholder
          '^\\d{2} [^\\n]*/',        // vault folder placeholders («09 templates/\n10 drafts/»)
          '"\\d{2} \\w+/"',          // quoted folder example inside prose («(e.g. "09 Templates/")»)
          '^assetspaces/',         // vault-relative path placeholders
          '\\.exocortex/',           // literal `.exocortex/…` paths (the brand «Exocortex» must not re-case them)
          '^\\[\\[',                 // wikilink placeholders («[[Note name]]»)
          '^Step \\d+:',           // a11y step prefix in the onboarding panel
          '^✓',                    // decorative completion glyph
        ],
      }],

      'no-restricted-syntax': ['error', {
        selector: 'NewExpression[callee.name="Notice"]',
        message: 'Use INotificationService instead of direct new Notice(). Only ObsidianNotificationService may call new Notice().',
      }],

      // Block Node.js built-ins in plugin/core src for mobile compatibility.
      // manifest.json sets "isDesktopOnly": false → plugin targets mobile
      // Obsidian (WKWebView/WebView without a Node.js runtime). Importing
      // fs/child_process/os/path would crash the plugin on mobile load.
      // Tests and scripts may use Node APIs (see overrides below).
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              'fs', 'fs/*',
              'node:fs', 'node:fs/*',
              'child_process',
              'node:child_process',
              'os',
              'node:os',
              'path', 'path/*',
              'node:path', 'node:path/*',
            ],
            message: 'Node.js built-ins (fs/child_process/os/path) are forbidden in plugin/core src — plugin is mobile-compatible (manifest isDesktopOnly=false) and would crash on Obsidian mobile (WebView without Node runtime). Use Obsidian Vault/FileSystemAdapter APIs instead.',
          },
        ],
      }],
    },
  },
  {
    files: ['**/ObsidianNotificationService.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/TestUtils.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-restricted-imports': 'off',
    },
  },
  // E2E spec timing-flake guard (RFC 3cc77ba2 v2 §Phase 1.1).
  // Blocks `page.waitForTimeout()`, `setTimeout()`, `new Promise(r => setTimeout(r, N))`
  // (the inner setTimeout is caught) and `setInterval()` in E2E specs.
  // Launcher (`tests/e2e/utils/obsidian-launcher.ts:190`) is exempt because the
  // glob is `*.spec.ts` only; launcher is infrastructure `.ts`, not a spec.
  {
    files: ['packages/obsidian-plugin/tests/e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="waitForTimeout"]',
          message:
            'waitForTimeout creates Category A timing flakes (RFC 3cc77ba2 v2 §Phase 1.1). Use expect(locator).toBeVisible({timeout}), expect.poll(() => condition, {timeout}), or page.waitForFunction() instead.',
        },
        {
          selector: 'CallExpression[callee.name="setTimeout"]',
          message:
            'setTimeout (including inside `new Promise(r => setTimeout(r, N))`) creates Category A timing flakes. Use Playwright web-first assertions with explicit timeouts.',
        },
        {
          selector: 'CallExpression[callee.name="setInterval"]',
          message:
            'setInterval creates Category A timing flakes. Use expect.poll({intervals, timeout}) instead.',
        },
      ],
    },
  },
  // packages/req-audit is a Node-only, repo-internal DEV TOOL (the RFC 0003
  // requirements-traceability checker run by the `requirements-trace` CI job,
  // RFC 7c7859d1 W-req). It is not plugin/core source and never ships to a
  // mobile runtime, so the three mobile-safety/plugin-hygiene rules below do not
  // apply to it — exactly as they do not apply to packages/cli (which lint-staged
  // excludes via its `packages/!(cli)/src/**` glob):
  //   - no-console        — stdout IS this tool's interface; the CI job captures
  //                         the JSON report by redirecting stdout to a file.
  //   - no-nodejs-modules / no-restricted-imports — the tool's whole job is to
  //                         walk the filesystem; it runs under Node, never in a
  //                         WebView.
  // Scoped to this package only; every other rule stays in force.
  {
    files: ['packages/req-audit/**/*.ts'],
    rules: {
      'no-console': 'off',
      'import/no-nodejs-modules': 'off',
      'no-restricted-imports': 'off',
    },
  },
  // M5a package rename (packages/exocortex -> packages/core) git-mv's every core
  // file, so lint-staged now lints all of them and surfaces lint debt that
  // PRE-DATES rule tightening and is NOT gated by CI (`npm run lint` covers only
  // packages/obsidian-plugin/src). These violations existed dormant on main; the
  // behavior-preserving rename is not their cause. Suppress only the surfaced
  // rules for exactly the affected debt files so the rename can land green.
  // ⛔ Do NOT extend this list — fix the debt and remove the entry instead.
  // Follow-up cleanup tracked separately (M5a morning report).
  {
    files: [
      'packages/core/src/domain/commands/visibility/helpers.ts',
      'packages/core/src/infrastructure/memory/MemoryPool.ts',
      'packages/core/src/infrastructure/rdf/InMemoryTripleStore.ts',
      'packages/core/src/infrastructure/rdf/RDFSInferenceEngine.ts',
      'packages/core/src/infrastructure/rdf/RDFSerializer.ts',
      'packages/core/src/infrastructure/rdf/parsers/TurtleParser.ts',
      'packages/core/src/infrastructure/sparql/algebra/AlgebraSerializer.ts',
      'packages/core/src/infrastructure/sparql/executors/AggregateExecutor.ts',
      'packages/core/src/infrastructure/sparql/executors/ConstructExecutor.ts',
      'packages/core/src/infrastructure/sparql/executors/ServiceExecutor.ts',
      'packages/core/src/infrastructure/sparql/serializers/ResultSerializer.ts',
      'packages/core/src/services/DynamicFrontmatterGenerator.ts',
      'packages/core/src/utilities/FilenameValidator.ts',
      'packages/test-utils/src/helpers/async.helpers.ts',
      'packages/test-utils/src/reporters/flaky-reporter.ts',
      'packages/test-utils/src/reporters/quarantine.ts',
    ],
    rules: {
      'no-console': 'off',
      'no-case-declarations': 'off',
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-imports': 'off',
      'import/no-nodejs-modules': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  // #4232 — `obsidianmd/settings-tab/prefer-setting-definitions` asks for the
  // obsidian ≥ 1.13 declarative `getSettingDefinitions()` API. The settings
  // tab is a ~950-line imperative `display()`; migrating it is a feature-size
  // refactor tracked separately, not lint hygiene. Every other rule that the
  // eslint-plugin-obsidianmd 0.4.1 bump surfaced for this file is now
  // satisfied at the source (sentence-case configured above, directives
  // removed, deprecated `display()` no longer called from code).
  {
    files: ['packages/obsidian-plugin/src/presentation/settings/ExocortexSettingTab.ts'],
    rules: {
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
    },
  },
  // #4232 — the ONE deliberate deviation from `no-tfile-tfolder-cast`: the
  // adapter narrows a resolved link target by duck-typing (`"children" in
  // file`) instead of `instanceof TFile`, because `instanceof` silently
  // tightens the blocker path (req 5cd9fffe — a test with a plain-object mock
  // proves it) and breaks whenever two copies of the `obsidian` module are
  // loaded. The rule is right in general; here its demand is refuted by a
  // test, so the exception lives in config (inline `eslint-disable` of any
  // obsidianmd/* rule is an error since eslint-plugin-obsidianmd 0.4.1).
  {
    files: ['packages/obsidian-plugin/src/domain/display-name/ObsidianVaultMetadataAdapter.ts'],
    rules: {
      'obsidianmd/no-tfile-tfolder-cast': 'off',
    },
  },
  // 2026-09-17, ticket 7d91d13a (relations-picker symbolic range, req e084627c)
  // — PropertyEditorModal.tsx carries PRE-EXISTING lint debt that the `lint` CI
  // job never gates (continue-on-error; main carries 62 errors) but lint-staged
  // (`eslint --fix --max-warnings=0`) surfaces on ANY commit touching the file:
  // 5 errors (3× no-console in catch handlers, 2× `FileManager.trashFile` vs
  // minAppVersion 1.5.0) and 4 auto-FIXABLE warnings (3× prefer-create-el,
  // 1× no-global-this in `generateStatementUid`, req d8ac0a94) that `--fix`
  // would silently rewrite into an unrelated commit. Config-only, scoped to
  // that one file and exactly these rules, so a one-line bug-fix does not
  // widen into a logging-channel / API-guard / DOM-helper / crypto-lookup
  // change. The debt fix (console → Logger, trashFile →
  // requireApiVersion("1.6.6") guard as in ObsidianVaultAdapter, createDiv,
  // window/activeWindow) is ticket 7c02970c-57b6-4dd0-8bae-7c1801a1a3c8.
  // ⛔ Remove this block with that ticket; do not add files or rules to it.
  {
    files: ['packages/obsidian-plugin/src/presentation/modals/PropertyEditorModal.tsx'],
    rules: {
      'no-console': 'off',
      'obsidianmd/no-unsupported-api': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/no-global-this': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'main.js',
      '*.js',
      'coverage/',
      'dist/',
      'features/',
      'scripts/',
      '.obsidian/',
      'src/infrastructure/agents/__tests__/**',
      'eslint.config.js',
      '**/*.d.ts',
    ],
  }
);

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidianPlugin from 'eslint-plugin-obsidianmd';
import prettierConfig from 'eslint-config-prettier';

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
        project: './tsconfig.json',
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

      'no-restricted-syntax': ['error', {
        selector: 'NewExpression[callee.name="Notice"]',
        message: 'Use INotificationService instead of direct new Notice(). Only ObsidianNotificationService may call new Notice().',
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

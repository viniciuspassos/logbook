// Flat ESLint config, independent of the frontend's eslint.config.js (no React
// rules here). Mirrors the repo-wide "no any" policy from CLAUDE.md.
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const tsParser = require('@typescript-eslint/parser')

module.exports = [
  {
    ignores: ['dist', 'node_modules', 'uploads'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Strict complexity limits — keep in sync with the root eslint.config.js
      // (server/ is deliberately kept a standalone package, so the numbers are repeated).
      complexity: ['error', 10],
      'max-depth': ['error', 3], // nested ifs/loops
      'max-params': ['error', 4],
      'max-nested-callbacks': ['error', 3],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // describe/it nesting and long suites are the shape of a test file, not a smell.
    files: ['src/**/*.test.ts'],
    rules: {
      'max-nested-callbacks': 'off',
      'max-lines-per-function': 'off',
    },
  },
]

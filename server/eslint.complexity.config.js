// Strict complexity limits, run on their own (`npm run lint:complexity`, the
// `server-complexity` CI job) so a failure names the rule instead of hiding in a
// generic lint failure. Keep in sync with the root eslint.complexity.config.js
// (server/ is deliberately a standalone package, so the numbers are repeated).
const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')

module.exports = [
  {
    ignores: ['dist', 'node_modules', 'uploads'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsParser, parserOptions: { sourceType: 'module' } },
    // Registered (no rules enabled) only so `eslint-disable @typescript-eslint/...`
    // comments still resolve here instead of erroring as unknown rules.
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
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

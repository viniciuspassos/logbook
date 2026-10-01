import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Strict complexity limits, run on their own (`npm run lint:complexity`, the
// `frontend-complexity` CI job) so a failure names the rule instead of hiding in
// a generic lint failure. See docs/INFRASTRUCTURE.md → "Complexity gate".
// Keep in sync with server/eslint.complexity.config.js (server/ is deliberately a
// standalone package, so the numbers are repeated rather than shared).
export default defineConfig([
  globalIgnores(['dist', 'dist-ssr', 'dev-dist', 'coverage', '.claude', 'server']),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    // Directives for rules this config doesn't run are `npm run lint`'s business.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    // Registered (no rules enabled) only so `eslint-disable` comments for rules that
    // `npm run lint` runs still resolve here instead of erroring as unknown rules.
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      '@typescript-eslint': tseslint.plugin,
    },
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
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'max-nested-callbacks': 'off',
      'max-lines-per-function': 'off',
    },
  },
])

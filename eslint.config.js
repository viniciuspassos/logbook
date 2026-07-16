import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `.claude` holds agent scratch space, including git worktrees that contain
  // full copies of this repo — linting those would double-report every file
  // and confuse typescript-eslint's tsconfig root detection.
  // `server` is a standalone NestJS package with its own eslint.config.js,
  // tsconfig, and `npm run lint` script (see server/package.json) —
  // deliberately not part of this project's tsconfig project references, so
  // this root config's `**/*.{ts,tsx}` glob must not pick its files up (they
  // fail to parse against tsconfig.app.json/tsconfig.node.json otherwise).
  globalIgnores(['dist', '.claude', 'server']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])

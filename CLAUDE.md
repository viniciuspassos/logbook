# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Logbook is an offline-first Progressive Web App (PWA) for mountaineers and skydivers to record their adventures, even in places with little or no internet connectivity (see `package.json` description). The codebase is currently a freshly scaffolded Vite + React + TypeScript app (`src/App.tsx` still contains the default Vite template content) — offline/PWA functionality and the actual logbook features have not been implemented yet.

## Commands

- `npm run dev` — start the Vite dev server with HMR
- `npm run build` — type-check via `tsc -b` (project references: `tsconfig.app.json` + `tsconfig.node.json`), then production build via `vite build`
- `npm run lint` — run ESLint over the whole repo
- `npm run preview` — serve the production build locally

There is no test runner configured yet (no Jest, no test script in `package.json`). Per project convention (see Testing below), one must be set up before/alongside adding functions.

## Testing

Every function, both backend and frontend, must have a unit test written with Jest. When adding a function, add or update its corresponding Jest test in the same change.

## Architecture

- Build tooling: Vite (`vite.config.ts`) with `@vitejs/plugin-react`.
- TypeScript is split via project references from the root `tsconfig.json` into:
  - `tsconfig.app.json` — app code under `src/`, bundler module resolution, `noEmit`, strict unused-locals/params checks.
  - `tsconfig.node.json` — Node-side config (`vite.config.ts` itself).
- Linting: flat ESLint config (`eslint.config.js`) combining `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh` (Vite variant). `dist` is ignored.
- Entry point: `index.html` → `src/main.tsx` mounts `<App />` from `src/App.tsx` into `#root` under `React.StrictMode`.
- Static assets referenced by `<use href="/icons.svg#...">` and `favicon.svg` live in `public/`; component-local assets (images, logos) live in `src/assets/`.

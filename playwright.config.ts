import { defineConfig } from '@playwright/test'

// Les e2e pilotent le binaire Electron via `_electron.launch` : aucun navigateur à installer.
// Ils lancent l'app buildée (`out/main/index.js`), d'où `electron-vite build` dans `npm run test:e2e`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list'
})

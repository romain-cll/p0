import { defineConfig } from '@playwright/test'

// The e2e tests drive the Electron binary through `_electron.launch`: no browser to install.
// They launch the built app (`out/main/index.js`), hence `electron-vite build` in `npm run test:e2e`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list'
})

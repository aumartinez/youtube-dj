import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// GitHub Pages serves a project site from https://<user>.github.io/<repo>/,
// so production assets need that prefix. Local dev and preview stay at "/".
// Set VITE_BASE to force a value (custom domain, user/organization page).
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.VITE_BASE ?? (repositoryName ? `/${repositoryName}/` : '/')

export default defineConfig({
  base,
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
})

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sdkRoot = path.resolve(__dirname, '..')

/**
 * Point @1sat/react and @1sat/connect at local package sources so we can
 * exercise unpublished session/polling changes without an npm publish.
 * package.json still lists registry versions as fallbacks for non-aliased installs.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@1sat/react': path.resolve(sdkRoot, 'packages/react/src'),
      '@1sat/connect': path.resolve(sdkRoot, 'packages/connect/src'),
    },
    dedupe: ['react', 'react-dom', '@bsv/sdk'],
  },
  server: {
    fs: {
      allow: [sdkRoot],
    },
  },
  optimizeDeps: {
    exclude: ['@1sat/react', '@1sat/connect'],
  },
})

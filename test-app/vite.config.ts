import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sdkRoot = path.resolve(__dirname, '..')
const pkg = (name: string) => path.resolve(sdkRoot, `packages/${name}/src`)

/**
 * Point @1sat/* at local package sources so we exercise unpublished
 * permission + action changes without an npm publish.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@1sat/react': pkg('react'),
      '@1sat/connect': pkg('connect'),
      '@1sat/actions': pkg('actions'),
      '@1sat/client': pkg('client'),
      '@1sat/types': pkg('types'),
      '@1sat/templates': pkg('templates'),
      '@1sat/permission-module': pkg('permission-module'),
      '@1sat/permission-module-ui': pkg('permission-module-ui'),
      '@1sat/wallet': pkg('wallet'),
      '@1sat/wallet-browser': pkg('wallet-browser'),
    },
    dedupe: ['react', 'react-dom', '@bsv/sdk'],
  },
  server: {
    fs: {
      allow: [sdkRoot],
    },
  },
  optimizeDeps: {
    exclude: [
      '@1sat/react',
      '@1sat/connect',
      '@1sat/actions',
      '@1sat/permission-module',
      '@1sat/permission-module-ui',
      '@1sat/wallet',
      '@1sat/wallet-browser',
    ],
  },
})

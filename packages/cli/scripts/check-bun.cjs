#!/usr/bin/env node
const { spawnSync } = require('node:child_process')

const result = spawnSync('bun', ['--version'], { stdio: 'ignore' })
if (result.error || result.status !== 0) {
	console.error('')
	console.error('@1sat/cli requires the Bun runtime (https://bun.sh).')
	console.error('')
	console.error('Install Bun:')
	console.error('  curl -fsSL https://bun.sh/install | bash')
	console.error('')
	console.error('Then retry:')
	console.error('  bunx @1sat/cli            # run without installing')
	console.error('  bun add -g @1sat/cli      # install globally')
	console.error('')
	process.exit(1)
}

/**
 * Post-build hook: copies the Secure Enclave binary into MacOS/
 * so Electrobun's codesign step signs it with the other binaries.
 */
import { cpSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const buildDir = process.env.ELECTROBUN_BUILD_DIR
const appName = process.env.ELECTROBUN_APP_NAME

if (!buildDir || !appName) {
	console.log('[post-build] Skipping — not in Electrobun build context')
	process.exit(0)
}

// Electrobun sets cwd to projectRoot (packages/wallet-desktop)
const enclaveSrc = resolve('..', 'wallet-mac', 'swift', 'enclave')
const macOSDir = join(buildDir, `${appName}.app`, 'Contents', 'MacOS')
const enclaveDest = join(macOSDir, 'enclave')

console.log(`[post-build] Looking for enclave at: ${enclaveSrc}`)
console.log(`[post-build] Build dir: ${buildDir}, app name: ${appName}`)

if (!existsSync(enclaveSrc)) {
	console.error(`[post-build] Enclave binary not found at ${enclaveSrc}`)
	console.error('[post-build] The app will work but Secure Enclave (Touch ID) will be unavailable')
	process.exit(0) // Non-fatal — app can still run without Touch ID
}

cpSync(enclaveSrc, enclaveDest)
console.log(`[post-build] Copied enclave to ${enclaveDest}`)

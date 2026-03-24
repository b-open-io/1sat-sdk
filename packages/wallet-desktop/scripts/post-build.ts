/**
 * Post-build hook: copies the Secure Enclave binary into the app's MacOS/
 * directory so Electrobun's codesign step signs it alongside other binaries.
 */
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const buildDir = process.env.ELECTROBUN_BUILD_DIR
const appName = process.env.ELECTROBUN_APP_NAME

if (!buildDir || !appName) {
	console.log('[post-build] Skipping — not running inside Electrobun build')
	process.exit(0)
}

const enclaveSrc = join(import.meta.dir, '..', '..', 'wallet-mac', 'swift', 'enclave')
const macOSDir = join(buildDir, `${appName}.app`, 'Contents', 'MacOS')
const enclaveDest = join(macOSDir, 'enclave')

if (!existsSync(enclaveSrc)) {
	console.error(`[post-build] Enclave binary not found at ${enclaveSrc}`)
	process.exit(1)
}

cpSync(enclaveSrc, enclaveDest)
console.log(`[post-build] Copied enclave binary to ${enclaveDest}`)

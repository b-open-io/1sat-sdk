/**
 * Post-build hook: copies the Secure Enclave binary into MacOS/
 * so Electrobun's codesign step signs it with the other binaries.
 */
import { chmodSync, cpSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const buildDir = process.env.ELECTROBUN_BUILD_DIR
const appName = process.env.ELECTROBUN_APP_NAME

console.log(`[post-build] cwd=${process.cwd()} __dirname=${__dirname}`)
console.log(
	`[post-build] ELECTROBUN_BUILD_DIR=${buildDir ?? '(unset)'} ELECTROBUN_APP_NAME=${appName ?? '(unset)'}`,
)

if (!buildDir || !appName) {
	console.error(
		'[post-build] Missing ELECTROBUN_BUILD_DIR or ELECTROBUN_APP_NAME — not in Electrobun build context',
	)
	process.exit(1)
}

// Use __dirname (this script's location) for reliable path resolution
// regardless of CWD. Script is at packages/wallet-desktop/scripts/post-build.ts
const enclaveSrc = resolve(
	__dirname,
	'..',
	'..',
	'wallet-mac',
	'swift',
	'enclave',
)
const macOSDir = join(buildDir, `${appName}.app`, 'Contents', 'MacOS')
const enclaveDest = join(macOSDir, 'enclave')

console.log(`[post-build] Looking for enclave at: ${enclaveSrc}`)
console.log(`[post-build] Target: ${enclaveDest}`)

if (!existsSync(enclaveSrc)) {
	console.error(`[post-build] FATAL: Enclave binary not found at ${enclaveSrc}`)
	console.error(
		'[post-build] Wallet creation requires the Secure Enclave binary.',
	)
	console.error(
		'[post-build] Build it: cd packages/wallet-mac/swift && sh build.sh',
	)
	process.exit(1)
}

if (!existsSync(macOSDir)) {
	console.error(`[post-build] FATAL: MacOS directory not found at ${macOSDir}`)
	process.exit(1)
}

cpSync(enclaveSrc, enclaveDest)
console.log(`[post-build] Copied enclave → ${enclaveDest}`)

// Copy 1sat-stack sidecar binary into MacOS/ so Electrobun codesigns it
const stackSrc = resolve(__dirname, '..', '1sat-stack-binary')
const stackDest = join(macOSDir, '1sat-stack')

console.log(`[post-build] Looking for 1sat-stack at: ${stackSrc}`)

if (existsSync(stackSrc)) {
	cpSync(stackSrc, stackDest)
	chmodSync(stackDest, 0o755)
	console.log(`[post-build] Copied 1sat-stack → ${stackDest}`)
} else {
	console.warn(
		`[post-build] WARNING: 1sat-stack binary not found at ${stackSrc}`,
	)
	console.warn(
		'[post-build] The app will not be able to run the blockchain sidecar.',
	)
}

/**
 * Interactive wallet setup wizard.
 *
 * Guides the user through:
 * 1. Network selection (mainnet/testnet)
 * 2. Key generation or import
 * 3. Password-protected key encryption
 * 4. Config file creation
 */

import { randomBytes } from 'node:crypto'
import { PrivateKey } from '@bsv/sdk'
import {
	cancel,
	confirm,
	intro,
	isCancel,
	outro,
	password,
	select,
	text,
} from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { ensureConfigDir, loadConfig, saveConfig } from '../config'
import { hasKey, saveKey } from '../keys'
import { fatal, formatSuccess, formatValue, formatWarning } from '../output'

export async function handleInitCommand(
	_args: string[],
	opts: GlobalFlags,
): Promise<void> {
	if (opts.json) {
		fatal('init command requires interactive mode (remove --json)')
	}

	intro('1sat wallet setup')

	// Warn if key already exists
	if (hasKey()) {
		const overwrite = await confirm({
			message: 'A wallet key already exists. Overwrite it?',
		})
		if (isCancel(overwrite) || !overwrite) {
			cancel('Setup cancelled.')
			process.exit(0)
		}
	}

	// 1. Network selection
	const chain = await select({
		message: 'Select network:',
		options: [
			{ value: 'main', label: 'Mainnet', hint: 'real BSV' },
			{ value: 'test', label: 'Testnet', hint: 'test BSV' },
		],
	})
	if (isCancel(chain)) {
		cancel('Setup cancelled.')
		process.exit(0)
	}

	// 2. Key source
	const keySource = await select({
		message: 'How would you like to set up your key?',
		options: [
			{
				value: 'generate',
				label: 'Generate new key',
				hint: 'creates a new random private key',
			},
			{
				value: 'import',
				label: 'Import existing key',
				hint: 'enter a WIF-encoded private key',
			},
		],
	})
	if (isCancel(keySource)) {
		cancel('Setup cancelled.')
		process.exit(0)
	}

	let wif: string

	if (keySource === 'generate') {
		const pk = PrivateKey.fromRandom()
		wif = pk.toWif()
		const address = pk.toPublicKey().toAddress()

		console.log()
		console.log(formatWarning('  IMPORTANT: Back up your private key!'))
		console.log(formatWarning('  If you lose it, your funds are gone forever.'))
		console.log()
		console.log(`  ${formatValue('WIF:')}    ${wif}`)
		console.log(`  ${formatValue('Address:')} ${address}`)
		console.log()

		const confirmed = await confirm({
			message: 'Have you saved your private key somewhere safe?',
		})
		if (isCancel(confirmed) || !confirmed) {
			cancel('Setup cancelled. Please save your key and try again.')
			process.exit(0)
		}
	} else {
		const wifInput = await text({
			message: 'Enter your WIF-encoded private key:',
			validate(value) {
				try {
					PrivateKey.fromWif(value)
				} catch {
					return 'Invalid WIF key. Keys start with 5, K, L (mainnet) or c (testnet).'
				}
			},
		})
		if (isCancel(wifInput)) {
			cancel('Setup cancelled.')
			process.exit(0)
		}
		wif = wifInput as string
	}

	// 3. Password for encryption
	const pw = await password({
		message: 'Set a password to encrypt your key:',
		validate(value) {
			if (value.length < 8) return 'Password must be at least 8 characters.'
		},
	})
	if (isCancel(pw)) {
		cancel('Setup cancelled.')
		process.exit(0)
	}

	const pwConfirm = await password({
		message: 'Confirm password:',
	})
	if (isCancel(pwConfirm)) {
		cancel('Setup cancelled.')
		process.exit(0)
	}

	if (pw !== pwConfirm) {
		fatal('Passwords do not match.')
	}

	// 4. Generate random storage identity key
	const storageId = `1sat-cli-${randomBytes(8).toString('hex')}`

	// 5. Optional: remote storage configuration
	const useRemote = await confirm({
		message: 'Configure remote storage? (remote is active, local is backup)',
		defaultValue: false,
	})
	let activeRemote: string | undefined

	if (useRemote) {
		const url = await text({
			message: 'Primary remote storage URL:',
			validate(value) {
				if (!value) return 'Required'
				try {
					new URL(value)
				} catch {
					return 'Invalid URL'
				}
			},
		})
		if (isCancel(url)) {
			cancel('Setup cancelled.')
			process.exit(0)
		}
		activeRemote = url as string
	}

	// 6. Save everything
	ensureConfigDir()

	await saveKey(wif, pw as string)

	saveConfig({
		...loadConfig(),
		chain: chain as 'main' | 'test',
		storageIdentityKey: storageId,
		activeRemote,
	})

	const pk = PrivateKey.fromWif(wif)
	const address = pk.toPublicKey().toAddress()

	outro(formatSuccess(`Wallet configured! Address: ${address}`))
}

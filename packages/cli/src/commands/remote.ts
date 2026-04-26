/**
 * Remote storage management commands.
 *
 * Subcommands:
 *   add        - Add a remote as backup (validates with immediate sync)
 *   list       - Show all remotes and their status
 *   delete     - Remove a remote from the backup list
 *   set-active - Switch active storage to a remote or back to local
 */

import { StorageClient } from '@1sat/wallet-node'
import { WalletServerClient, topUpStorage } from '@1sat/wallet-server'
import { confirm, isCancel, text } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { loadConfig, saveConfig } from '../config'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { fatal, formatSuccess, formatWarning, output } from '../output'

export async function handleRemoteCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'add':
			return remoteAdd(rest, opts)
		case 'list':
			return remoteList(rest, opts)
		case 'delete':
			return remoteDelete(rest, opts)
		case 'set-active':
			return remoteSetActive(rest, opts)
		case 'status':
			return remoteStatus(rest, opts)
		case 'topup':
			return remoteTopup(rest, opts)
		default:
			printCommandHelp('remote', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

// ============================================================================
// remote add
// ============================================================================

async function remoteAdd(args: string[], opts: GlobalFlags): Promise<void> {
	let url = args[0]

	if (!url) {
		url = (await text({
			message: 'Remote storage URL:',
			validate(value) {
				if (!value) return 'Required'
				try {
					new URL(value)
				} catch {
					return 'Invalid URL'
				}
			},
		})) as string
		if (isCancel(url)) {
			fatal('Cancelled')
		}
	} else {
		try {
			new URL(url)
		} catch {
			fatal(`Invalid URL: ${url}`)
		}
	}

	const privateKey = await loadKey()
	const { walletResult, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	// Load config early — needed for storage identity key lookups
	const config = loadConfig()

	try {
		const client = new StorageClient(walletResult.wallet, url)
		await walletResult.storage.addWalletStorageProvider(client)

		// When adding a backup, the remote may report itself as "active" which
		// creates a conflicting active state. Re-assert local as active before syncing.
		if (!walletResult.storage.isActiveEnabled) {
			const localKey = config.storageIdentityKey ?? '1sat-cli-default'
			await walletResult.storage.setActive(localKey)
		}

		await walletResult.storage.updateBackups()

		// Persist to config — connectivity will be validated on next monitor run
		const existing = config.backups ?? []
		if (!existing.includes(url)) {
			saveConfig({ ...config, backups: [...existing, url] })
		}

		if (opts.json) {
			output({ url, status: 'added' }, opts)
		} else {
			console.log(formatSuccess(`  Added ${url} as backup`))
			console.log(
				formatWarning(
					'  Note: Use "1sat remote set-active <url>" to make this remote the primary storage',
				),
			)
		}
	} finally {
		await destroy()
	}
}

// ============================================================================
// remote list
// ============================================================================

async function remoteList(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey()
	const { destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const config = loadConfig()

		// Use config.backups for display (remoteClients only populated for active connections)
		const backupUrls = config.backups ?? []

		// Use config for active determination — WalletStorageManager internal state
		// can be misleading (a backup may appear as active after addWalletStorageProvider)
		const isRemoteActive = Boolean(config.activeRemote)

		if (opts.json) {
			output(
				{
					activeStorage: isRemoteActive ? 'remote' : 'local',
					backups: backupUrls,
					config: {
						activeRemote: config.activeRemote ?? null,
						backups: config.backups ?? [],
					},
				},
				opts,
			)
			return
		}

		console.log()
		console.log(
			`  ${bold('Active Storage:')} ${isRemoteActive ? 'remote' : 'local'}`,
		)
		if (isRemoteActive) {
			console.log(`  ${bold('Active Remote:')} ${config.activeRemote}`)
		}
		console.log()
		if (backupUrls.length === 0 && !config.backups?.length) {
			console.log('  No remote storages configured')
		} else {
			console.log(`  ${bold('Backups:')}`)
			for (const url of backupUrls) {
				console.log(`    ● ${url}`)
			}
		}
		console.log()
	} finally {
		await destroy()
	}
}

// ============================================================================
// remote delete
// ============================================================================

async function remoteDelete(args: string[], opts: GlobalFlags): Promise<void> {
	let url = args[0]

	if (!url) {
		url = (await text({
			message: 'Remote storage URL to remove:',
			validate(value) {
				if (!value) return 'Required'
			},
		})) as string
		if (isCancel(url)) {
			fatal('Cancelled')
		}
	}

	const config = loadConfig()
	const backups = config.backups ?? []

	if (!backups.includes(url)) {
		fatal(`Remote not found in config: ${url}`)
	}

	// Confirm
	const confirmed = await confirm({
		message: `Remove ${url} from backups?`,
		defaultValue: false,
	})
	if (isCancel(confirmed) || !confirmed) {
		fatal('Cancelled')
	}

	saveConfig({ ...config, backups: backups.filter((u) => u !== url) })

	if (opts.json) {
		output({ url, status: 'removed' }, opts)
	} else {
		console.log(formatSuccess(`  Removed ${url} from backups`))
	}
}

// ============================================================================
// remote set-active
// ============================================================================

async function remoteSetActive(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	let target = args[0]

	if (!target) {
		target = (await text({
			message: 'Set active storage to (url or "local"):',
			validate(value) {
				if (!value) return 'Required'
			},
		})) as string
		if (isCancel(target)) {
			fatal('Cancelled')
		}
	}

	const config = loadConfig()

	if (target === 'local') {
		// Switch back to local
		if (!config.activeRemote && !config.backups?.length) {
			fatal('No remote storages configured')
		}

		const privateKey = await loadKey()
		const { walletResult, destroy } = await loadContext(privateKey, {
			chain: opts.chain,
		})

		try {
			// Find the local storage's storageIdentityKey
			const localKey = config.storageIdentityKey ?? '1sat-cli-default'

			if (opts.json) {
				output({ target: 'local', status: 'migrating' }, opts)
			} else {
				console.log('  Switching active storage to local...')
			}

			await walletResult.storage.setActive(localKey)

			// Clear activeRemote from config
			saveConfig({ ...config, activeRemote: undefined })

			if (opts.json) {
				output(
					{ target: 'local', status: 'active', storageIdentityKey: localKey },
					opts,
				)
			} else {
				console.log(formatSuccess('  Local storage is now active'))
			}
		} finally {
			await destroy()
		}
	} else {
		// Switch to a remote
		// Validate URL
		try {
			new URL(target)
		} catch {
			fatal(`Invalid URL: ${target}`)
		}

		const privateKey = await loadKey()
		const { walletResult, destroy } = await loadContext(privateKey, {
			chain: opts.chain,
		})

		try {
			if (opts.json) {
				output({ target, status: 'migrating' }, opts)
			} else {
				console.log(`  Switching active storage to ${target}...`)
			}

			await walletResult.setActiveStorage(target)

			// Persist to config
			saveConfig({ ...config, activeRemote: target })

			if (opts.json) {
				output({ target, status: 'active' }, opts)
			} else {
				console.log(formatSuccess(`  ${target} is now active`))
			}
		} finally {
			await destroy()
		}
	}
}

// ============================================================================
// remote status
// ============================================================================

async function remoteStatus(args: string[], opts: GlobalFlags): Promise<void> {
	const config = loadConfig()
	const url = args[0] ?? config.activeRemote ?? config.backups?.[0]
	if (!url) {
		fatal(
			'No remote URL supplied. Pass one as an argument or configure activeRemote/backups first.',
		)
	}
	try {
		new URL(url)
	} catch {
		fatal(`Invalid URL: ${url}`)
	}

	const privateKey = await loadKey()
	const { walletResult, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const client = new WalletServerClient(url, walletResult.wallet)
		const status = await client.accountStatus()

		if (opts.json) {
			output(status, opts)
			return
		}

		console.log()
		console.log(`  ${bold('Remote:')} ${url}`)
		console.log(`  ${bold('Identity:')} ${status.identityKey}`)
		console.log(
			`  ${bold('Accounts:')} ${status.accountsEnabled ? 'on' : 'off'}`,
		)
		if (status.currentBlock != null) {
			console.log(`  ${bold('Chain tip:')} block ${status.currentBlock}`)
		}
		if (status.usedBytes != null) {
			console.log(`  ${bold('Used:')} ${formatBytes(status.usedBytes)}`)
		}
		if (status.accountsEnabled) {
			console.log(`  ${bold('Baseline:')} ${formatBytes(status.baselineBytes)}`)
			console.log(`  ${bold('Paid:')} ${formatBytes(status.paidBytes)}`)
			console.log(`  ${bold('Capacity:')} ${formatBytes(status.capacityBytes)}`)
			if (status.deficitBytes > 0) {
				console.log(
					`  ${bold('Deficit:')} ${formatBytes(status.deficitBytes)} (next write will trigger 402)`,
				)
			}
			if (status.paidThroughBlock != null) {
				const remaining = status.paidThroughBlock - status.currentBlock
				console.log(
					`  ${bold('Paid through:')} block ${status.paidThroughBlock} (${remaining} blocks left)`,
				)
			}
			console.log(
				`  ${bold('Pricing:')} ${status.pricing.satsPerUnit} sats per ${formatBytes(status.pricing.purchaseUnitBytes)} over ${status.pricing.durationBlocks} blocks`,
			)
		}
		console.log()
	} finally {
		await destroy()
	}
}

// ============================================================================
// remote topup
// ============================================================================

async function remoteTopup(args: string[], opts: GlobalFlags): Promise<void> {
	let url: string | undefined
	let units: number | undefined
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--units') {
			const val = args[++i]
			const parsed = Number(val)
			if (!Number.isInteger(parsed) || parsed <= 0) {
				fatal(`--units requires a positive integer, got "${val}"`)
			}
			units = parsed
		} else if (!url) {
			url = arg
		}
	}

	const config = loadConfig()
	url = url ?? config.activeRemote ?? config.backups?.[0]
	if (!url) {
		fatal(
			'No remote URL supplied. Pass one as an argument or configure activeRemote/backups first.',
		)
	}
	try {
		new URL(url)
	} catch {
		fatal(`Invalid URL: ${url}`)
	}

	const privateKey = await loadKey()
	const { walletResult, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await topUpStorage(walletResult.wallet, url)

		if (opts.json) {
			output(result, opts)
			return
		}

		console.log()
		console.log(`  ${bold('Remote:')} ${url}`)
		console.log(`  ${bold('Sats paid:')} ${result.satsPaid}`)
		if (result.status.accountsEnabled) {
			console.log()
			console.log(
				`  ${bold('New capacity:')} ${formatBytes(result.status.capacityBytes)} (${formatBytes(result.status.usedBytes)} used, ${formatBytes(result.status.deficitBytes)} deficit)`,
			)
			if (result.status.paidThroughBlock != null) {
				const remaining =
					result.status.paidThroughBlock - result.status.currentBlock
				console.log(
					`  ${bold('Paid through:')} block ${result.status.paidThroughBlock} (${remaining} blocks left)`,
				)
			}
		}
		console.log()
	} finally {
		await destroy()
	}
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
	return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ============================================================================
// Helpers
// ============================================================================

function bold(s: string): string {
	return `\x1b[1m${s}\x1b[0m`
}

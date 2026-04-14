/**
 * Remote storage management commands.
 *
 * Subcommands:
 *   add        - Add a remote as backup (validates with immediate sync)
 *   list       - Show all remotes and their status
 *   delete     - Remove a remote from the backup list
 *   set-active - Switch active storage to a remote or back to local
 */

import { confirm, isCancel, text } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { loadConfig, saveConfig } from '../config'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey, resolvePassword } from '../keys'
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
		default:
			printCommandHelp('remote', {
				add: 'Add a remote storage as backup (1sat remote add <url>)',
				list: 'List all configured remotes and their status',
				delete:
					'Remove a remote from the backup list (1sat remote delete <url>)',
				'set-active':
					'Switch active storage (1sat remote set-active <url | local>)',
			})
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

	const privateKey = await loadKey(resolvePassword())
	const { walletResult, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		// For backup-only, we use StorageClient via wallet-node
		// biome-ignore lint/suspicious/noExplicitAny: StorageClient constructor not typed in wallet-toolbox
		const { StorageClient } = await import('@1sat/wallet-node')
		const wallet = walletResult.wallet as any
		const client = new (StorageClient as any)(wallet, url)
		await walletResult.storage.addWalletStorageProvider(client)

		// When adding a backup, the remote may report itself as "active" which
		// creates a conflicting active state. Re-assert local as active before syncing.
		if (!walletResult.storage.isActiveEnabled) {
			const localKey = config.storageIdentityKey ?? '1sat-cli-default'
			await walletResult.storage.setActive(localKey)
		}

		await walletResult.storage.updateBackups()

		// Persist to config — connectivity will be validated on next monitor run
		const config = loadConfig()
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
	const privateKey = await loadKey(resolvePassword())
	const { walletResult, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const backups = walletResult.storage.getBackupStores?.() ?? []
		const config = loadConfig()

		// Use config for active determination — WalletStorageManager internal state
		// can be misleading (a backup may appear as active after addWalletStorageProvider)
		const isRemoteActive = Boolean(config.activeRemote)

		if (opts.json) {
			output(
				{
					activeStorage: isRemoteActive ? 'remote' : 'local',
					backups: walletResult.storage.getAllStores?.() ?? [],
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
		console.log(`  ${bold('Active Storage:')} ${isRemoteActive ? 'remote' : 'local'}`)
		if (isRemoteActive) {
			console.log(
				`  ${bold('Active Remote:')} ${config.activeRemote}`,
			)
		}
		console.log()
		if (backups.length === 0 && !config.backups?.length) {
			console.log('  No remote storages configured')
		} else {
			console.log(`  ${bold('Backups:')}`)
			const known = new Set(config.backups ?? [])
			for (const b of backups) {
				const isKnown = known.has(b)
				console.log(`    ${isKnown ? '●' : '○'} ${b}`)
			}
			// Show configured but not yet connected
			for (const url of config.backups ?? []) {
				if (!backups.includes(url)) {
					console.log(`    ? ${url} (not connected)`)
				}
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

		const privateKey = await loadKey(resolvePassword())
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

		const privateKey = await loadKey(resolvePassword())
		const { walletResult, destroy } = await loadContext(privateKey, {
			chain: opts.chain,
		})

		try {
			if (opts.json) {
				output({ target, status: 'migrating' }, opts)
			} else {
				console.log(`  Switching active storage to ${target}...`)
			}

			await walletResult.migrateRemote(target)

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
// Helpers
// ============================================================================

function bold(s: string): string {
	return `\x1b[1m${s}\x1b[0m`
}

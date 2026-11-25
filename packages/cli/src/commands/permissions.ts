/**
 * `1sat permissions` — what apps on `1sat serve wallet-api` may do.
 *
 * The endpoint never asks: a request it has no grant for is denied, and
 * the error names the `1sat permissions grant …` command that would allow
 * it. This command is the other half of that loop.
 *
 * Everything here works directly on the JSON grant store
 * (`<dataDir>/permissions-<chain>.json`), so it needs no key, no wallet
 * and no running server. The manager reads that file on every check, so a
 * grant written while `1sat serve wallet-api` is running takes effect on
 * the app's next call — no restart.
 */

import { normalizeOriginator } from '@1sat/wallet'
import type { StoredGrant } from '@1sat/wallet'
import type { GlobalFlags } from '../args.js'
import { extractFlag, hasFlag } from '../args.js'
import { ensureDataDir } from '../config.js'
import { printCommandHelp } from '../help.js'
import { fatal, formatLabel, formatValue, output } from '../output.js'
import {
	type GrantFlags,
	type GrantSpec,
	describeKey,
	grantCommand,
	specId,
	specsFromFlags,
} from '../wallet-api/grants.js'
import {
	FilePermissionStore,
	permissionStorePath,
} from '../wallet-api/permission-store.js'

export async function handlePermissionsCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'list':
		case 'ls': // deprecated alias
			return permissionsList(rest, opts)
		case 'grant':
			return permissionsGrant(rest, opts)
		case 'revoke':
			return permissionsRevoke(rest, opts)
		default:
			printCommandHelp('permissions', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

/** The store `1sat serve wallet-api` reads on this chain. */
function openStore(opts: GlobalFlags): {
	store: FilePermissionStore
	path: string
} {
	const path = permissionStorePath(ensureDataDir(), opts.chain)
	return { store: new FilePermissionStore(path), path }
}

/** `1sat permissions grant`, with the global flags this invocation used. */
function commandPrefix(opts: GlobalFlags): string {
	return opts.chain === 'test'
		? '1sat --chain test permissions grant'
		: '1sat permissions grant'
}

function grantFlags(args: string[]): GrantFlags {
	return {
		protocol: extractFlag(args, '--protocol'),
		level: extractFlag(args, '--level'),
		counterparty:
			extractFlag(args, '--counterparty') ?? extractFlag(args, '--verifier'),
		privileged: hasFlag(args, '--privileged'),
		basket: extractFlag(args, '--basket'),
		label: extractFlag(args, '--label'),
		certificate: extractFlag(args, '--certificate'),
		fields: extractFlag(args, '--fields'),
		spending: extractFlag(args, '--spending'),
	}
}

/** Flags of this command that take no value. */
const BOOLEAN_FLAGS = new Set(['--privileged', '--all'])

/** First non-flag argument, skipping the values flags consume. */
function firstPositional(args: string[]): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg.startsWith('--')) {
			if (!BOOLEAN_FLAGS.has(arg)) i++
			continue
		}
		return arg
	}
	return undefined
}

function toSpec(grant: StoredGrant): GrantSpec {
	return grant.authorizedAmount != null
		? { key: grant.key, authorizedAmount: grant.authorizedAmount }
		: { key: grant.key }
}

async function permissionsList(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const { store, path } = openStore(opts)
	const origin = firstPositional(args)
	const filter = origin ? { originator: normalizeOriginator(origin) } : {}
	const grants = await store.listGrants(filter)

	if (opts.json) {
		output(grants, opts)
		return
	}

	if (grants.length === 0) {
		output(
			origin
				? `No grants for ${normalizeOriginator(origin)} in ${path}`
				: `No grants in ${path}`,
			opts,
		)
		return
	}

	const byOrigin = new Map<string, StoredGrant[]>()
	for (const grant of grants) {
		const list = byOrigin.get(grant.key.originator) ?? []
		list.push(grant)
		byOrigin.set(grant.key.originator, list)
	}

	for (const name of [...byOrigin.keys()].sort()) {
		console.log(`\n${formatValue(name)}`)
		for (const grant of byOrigin.get(name) ?? []) {
			const expiry =
				grant.expiry > 0
					? ` expires ${new Date(grant.expiry * 1000).toISOString()}`
					: ''
			console.log(
				`  ${describeKey(toSpec(grant))}${formatLabel(expiry)}${formatLabel(
					grant.reason ? ` — ${grant.reason}` : '',
				)}`,
			)
		}
	}
	console.log(`\n  ${grants.length} grant(s) in ${path}`)
}

async function permissionsGrant(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const origin = firstPositional(args)
	if (!origin) fatal('Missing <origin>. See `1sat permissions --help`')

	let specs: GrantSpec[]
	try {
		specs = specsFromFlags(origin, grantFlags(args))
	} catch (err) {
		return fatal((err as Error).message)
	}

	const { store, path } = openStore(opts)
	const now = Date.now()
	for (const spec of specs) {
		await store.putGrant({
			key: spec.key,
			expiry: 0,
			grantedAt: now,
			...(spec.authorizedAmount != null
				? { authorizedAmount: spec.authorizedAmount }
				: {}),
		})
	}

	if (opts.json) {
		output(
			{
				granted: specs.map((spec) => ({
					id: specId(spec),
					key: spec.key,
					authorizedAmount: spec.authorizedAmount,
				})),
				store: path,
			},
			opts,
		)
		return
	}

	for (const spec of specs) {
		console.log(`granted ${describeKey(spec)}`)
	}
	console.log(
		`\n  ${specs.length} grant(s) written to ${path}. A running \`1sat serve wallet-api\` picks them up on the app's next call.`,
	)
}

async function permissionsRevoke(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const origin = firstPositional(args)
	if (!origin) fatal('Missing <origin>. See `1sat permissions --help`')
	const originator = normalizeOriginator(origin)
	const { store, path } = openStore(opts)

	if (hasFlag(args, '--all')) {
		const removed = await store.deleteAllForOriginator(originator)
		if (opts.json) {
			output({ originator, removed, store: path }, opts)
			return
		}
		output(`revoked ${removed} grant(s) for ${originator}`, opts)
		return
	}

	let specs: GrantSpec[]
	try {
		specs = specsFromFlags(origin, grantFlags(args))
	} catch (err) {
		return fatal(
			`${(err as Error).message}. Pass --all to revoke everything for an origin.`,
		)
	}

	const removed: GrantSpec[] = []
	const missing: GrantSpec[] = []
	for (const spec of specs) {
		if (await store.findGrant(spec.key)) {
			await store.deleteGrant(spec.key)
			removed.push(spec)
		} else {
			missing.push(spec)
		}
	}

	if (opts.json) {
		output(
			{
				revoked: removed.map((spec) => ({ id: specId(spec), key: spec.key })),
				notFound: missing.map((spec) => ({ id: specId(spec), key: spec.key })),
				store: path,
			},
			opts,
		)
		return
	}

	for (const spec of removed) console.log(`revoked ${describeKey(spec)}`)
	for (const spec of missing) {
		console.log(
			`no such grant: ${describeKey(spec)} (grant it with \`${grantCommand(
				spec,
				commandPrefix(opts),
			)}\`)`,
		)
	}
	console.log(`\n  ${removed.length} grant(s) removed from ${path}`)
}

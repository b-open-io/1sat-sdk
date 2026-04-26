/**
 * Identity commands - create, info, sign, verify.
 *
 * BAP (Bitcoin Attestation Protocol) identity management.
 */

import { publishIdentity, signBsm, updateProfile } from '@1sat/actions'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { fatal, output, printKeyValue } from '../output'

export async function handleIdentityCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'create':
			return identityCreate(rest, opts)
		case 'update-profile':
			return identityUpdateProfile(rest, opts)
		case 'info':
			return identityInfo(rest, opts)
		case 'sign':
			return identitySign(rest, opts)
		case 'verify':
			return identityVerify(rest, opts)
		default:
			printCommandHelp('identity', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function identityCreate(
	_args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await publishIdentity.execute(ctx, {})

		if (result.error) {
			fatal(result.error)
		}

		output(result, opts)
	} finally {
		await destroy()
	}
}

async function identityInfo(_args: string[], opts: GlobalFlags): Promise<void> {
	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const { publicKey } = await ctx.wallet.getPublicKey({
			protocolID: [1, 'sigma'],
			keyID: '1',
			counterparty: 'self',
			forSelf: true,
		})

		if (opts.json) {
			output({ identityKey: publicKey }, opts)
		} else {
			printKeyValue({ 'Identity Key': publicKey })
		}
	} finally {
		await destroy()
	}
}

async function identitySign(args: string[], opts: GlobalFlags): Promise<void> {
	const message = extractFlag(args, '--message')
	const encoding = extractFlag(args, '--encoding')

	if (!message) fatal('Missing --message <text>')
	if (
		encoding !== undefined &&
		encoding !== 'utf8' &&
		encoding !== 'hex' &&
		encoding !== 'base64'
	) {
		fatal('--encoding must be one of: utf8, hex, base64')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await signBsm.execute(ctx, {
			message,
			...(encoding ? { encoding: encoding as 'utf8' | 'hex' | 'base64' } : {}),
		})

		if (result.error) {
			fatal(result.error)
		}

		output(result, opts)
	} finally {
		await destroy()
	}
}

async function identityVerify(
	args: string[],
	_opts: GlobalFlags,
): Promise<void> {
	const message = extractFlag(args, '--message')
	const sig = extractFlag(args, '--sig')
	const address = extractFlag(args, '--address')

	if (!message) fatal('Missing --message <text>')
	if (!sig) fatal('Missing --sig <signature>')
	if (!address) fatal('Missing --address <addr>')

	// BSM verification doesn't need a wallet context — it's pure crypto
	// Use @bsv/sdk BSM.verify directly
	fatal(
		'identity verify is not yet implemented (needs direct BSM.verify integration)',
	)
}

async function identityUpdateProfile(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const profileStr = extractFlag(args, '--profile')

	if (!profileStr) fatal('Missing --profile <json>')

	let profile: Record<string, unknown>
	try {
		profile = JSON.parse(profileStr)
	} catch {
		fatal(`Invalid JSON in --profile: ${profileStr}`)
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await updateProfile.execute(ctx, { profile })

		if (result.error) {
			fatal(result.error)
		}

		output(result, opts)
	} finally {
		await destroy()
	}
}

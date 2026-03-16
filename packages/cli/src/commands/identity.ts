/**
 * Identity commands - create, info, sign, verify.
 *
 * BAP (Bitcoin Attestation Protocol) identity management.
 */

import { publishIdentity, signBsm } from '@1sat/actions'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey, resolvePassword } from '../keys'
import { fatal, output, printKeyValue } from '../output'

export async function handleIdentityCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'create':
			return identityCreate(rest, opts)
		case 'info':
			return identityInfo(rest, opts)
		case 'sign':
			return identitySign(rest, opts)
		case 'verify':
			return identityVerify(rest, opts)
		default:
			printCommandHelp('identity', {
				create: 'Create/publish a BAP identity',
				info: 'Show BAP identity information',
				sign: 'Sign a message with identity key (--message <text>)',
				verify:
					'Verify a signed message (--message <text> --sig <sig> --address <addr>)',
			})
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function identityCreate(
	_args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const privateKey = await loadKey(resolvePassword())
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
	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const { publicKey } = await ctx.wallet.getPublicKey({
			protocolID: [1, 'bap'],
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

	if (!message) fatal('Missing --message <text>')

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await signBsm.execute(ctx, { message })

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

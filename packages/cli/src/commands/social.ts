/**
 * Social commands - post.
 *
 * On-chain social protocol (BSocial) actions.
 */

import { createSocialPost } from '@1sat/actions'
import type { GlobalFlags } from '../args'
import { extractFlag } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey, resolvePassword } from '../keys'
import { fatal, output } from '../output'

export async function handleSocialCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	const [subcommand, ...rest] = args

	switch (subcommand) {
		case 'post':
			return socialPost(rest, opts)
		default:
			printCommandHelp('social', {
				post: 'Create an on-chain social post (--content <text> --app <name>)',
			})
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function socialPost(args: string[], opts: GlobalFlags): Promise<void> {
	const content = extractFlag(args, '--content')
	const app = extractFlag(args, '--app') ?? '1sat-cli'

	if (!content) fatal('Missing --content <text>')

	const privateKey = await loadKey(resolvePassword())
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await createSocialPost.execute(ctx, { app, content })

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

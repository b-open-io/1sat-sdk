/**
 * Social commands - post.
 *
 * On-chain social protocol (BSocial) actions.
 */

import { createSocialPost } from '@1sat/actions'
import type { GlobalFlags } from '../args'
import { extractFlag, extractFlags } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
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
			printCommandHelp('social', opts.json)
			if (subcommand && subcommand !== 'help') {
				process.exit(1)
			}
	}
}

async function socialPost(args: string[], opts: GlobalFlags): Promise<void> {
	const content = extractFlag(args, '--content')
	const app = extractFlag(args, '--app') ?? '1sat-cli'
	const contentType = extractFlag(args, '--content-type')
	const tags = extractFlags(args, '--tags')

	if (!content) fatal('Missing --content <text>')
	if (
		contentType !== undefined &&
		contentType !== 'text/plain' &&
		contentType !== 'text/markdown'
	) {
		fatal('--content-type must be one of: text/plain, text/markdown')
	}

	const privateKey = await loadKey()
	const { ctx, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const result = await createSocialPost.execute(ctx, {
			app,
			content,
			...(contentType
				? { contentType: contentType as 'text/plain' | 'text/markdown' }
				: {}),
			...(tags.length ? { tags } : {}),
		})

		if (result.error) {
			fatal(result.error)
		}

		output(opts.json ? result : { txid: result.txid }, opts)
	} finally {
		await destroy()
	}
}

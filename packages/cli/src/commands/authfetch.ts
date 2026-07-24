/**
 * Authenticated HTTP client using CLI wallet keys (BRC-104 AuthFetch).
 *
 *   1sat authfetch <method> <url> [--body <json|@file>] [--header 'K: V']...
 *
 * Always authenticates. On 402 Payment Required, prompts unless --yes, then
 * AuthFetch pays and retries.
 */

import { readFileSync } from 'node:fs'
import { AuthFetch } from '@bsv/sdk'
import { confirm, isCancel } from '@clack/prompts'
import type { GlobalFlags } from '../args'
import { loadContext } from '../context'
import { printCommandHelp } from '../help'
import { loadKey } from '../keys'
import { fatal, output } from '../output'

const METHODS = new Set([
	'GET',
	'POST',
	'PUT',
	'PATCH',
	'DELETE',
	'HEAD',
	'OPTIONS',
])

export async function handleAuthfetchCommand(
	args: string[],
	opts: GlobalFlags,
): Promise<void> {
	if (
		!args[0] ||
		args[0] === 'help' ||
		args.includes('--help') ||
		args.includes('-h')
	) {
		printCommandHelp('authfetch', opts.json)
		return
	}

	let method: string | undefined
	let url: string | undefined
	let bodyRaw: string | undefined
	const headerArgs: string[] = []

	for (let i = 0; i < args.length; i++) {
		const a = args[i]
		if (a === '--body') {
			bodyRaw = args[++i]
			if (bodyRaw === undefined) fatal('--body requires a value')
			continue
		}
		if (a === '--header') {
			const h = args[++i]
			if (h === undefined) fatal('--header requires a value')
			headerArgs.push(h)
			continue
		}
		if (a.startsWith('--')) {
			fatal(`Unknown flag: ${a}`)
		}
		if (!method) {
			method = a.toUpperCase()
			continue
		}
		if (!url) {
			url = a
			continue
		}
		fatal(`Unexpected argument: ${a}`)
	}

	if (!method || !METHODS.has(method)) {
		fatal(
			`Usage: 1sat authfetch <method> <url> [--body …] [--header 'K: V']…\nUnknown or missing method: ${method ?? ''}`,
		)
	}
	if (!url) fatal('Missing URL')
	try {
		new URL(url)
	} catch {
		fatal(`Invalid URL: ${url}`)
	}

	const headers: Record<string, string> = {}
	for (const h of headerArgs) {
		const i = h.indexOf(':')
		if (i <= 0) fatal(`Invalid --header (want 'Name: value'): ${h}`)
		headers[h.slice(0, i).trim()] = h.slice(i + 1).trim()
	}

	let body: string | undefined
	if (bodyRaw !== undefined) {
		body = bodyRaw.startsWith('@')
			? readFileSync(bodyRaw.slice(1), 'utf8')
			: bodyRaw
		if (!headers['Content-Type'] && !headers['content-type']) {
			headers['Content-Type'] = 'application/json'
		}
	}

	const privateKey = await loadKey()
	const { walletResult, destroy } = await loadContext(privateKey, {
		chain: opts.chain,
	})

	try {
		const auth = new AuthFetch(walletResult.wallet)
		const init = {
			method,
			headers,
			...(body !== undefined ? { body } : {}),
		}

		let res: Response
		try {
			// Authenticate but do not auto-pay on first try (so we can confirm).
			res = await auth.fetch(url, {
				...init,
				paymentRetryAttempts: 0,
			})
		} catch (err) {
			// Public routes may return 200 without BSV auth headers; AuthFetch rejects those.
			const msg = err instanceof Error ? err.message : String(err)
			if (/without valid BSV authentication/i.test(msg)) {
				res = await fetch(url, init)
			} else {
				throw err
			}
		}

		if (res.status === 402) {
			const satsHeader = res.headers.get('x-bsv-payment-satoshis-required')
			const sats = satsHeader ? Number(satsHeader) : undefined
			const payMsg =
				sats != null && Number.isFinite(sats)
					? `Pay ${sats} sats for ${method} ${url}?`
					: `Server requires payment (402) for ${method} ${url}. Continue?`

			if (!opts.yes) {
				const ok = await confirm({ message: payMsg })
				if (isCancel(ok) || !ok) fatal('Payment cancelled.')
			}

			res = await auth.fetch(url, init)
		}

		const text = await res.text()
		let parsed: unknown = text
		const ct = res.headers.get('content-type') ?? ''
		if (ct.includes('application/json') && text.length > 0) {
			try {
				parsed = JSON.parse(text)
			} catch {
				/* keep raw */
			}
		}

		if (opts.json) {
			output(
				{
					status: res.status,
					ok: res.ok,
					headers: Object.fromEntries(res.headers.entries()),
					body: parsed,
				},
				opts,
			)
			if (!res.ok) process.exit(1)
			return
		}

		if (!opts.quiet) {
			console.log(`${res.status} ${res.statusText || ''}`.trim())
		}
		if (text.length > 0) {
			console.log(
				typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2),
			)
		}
		if (!res.ok) process.exit(1)
	} finally {
		await destroy()
	}
}

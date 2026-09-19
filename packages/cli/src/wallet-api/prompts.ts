/**
 * Terminal prompts for the wallet-api permissions manager.
 *
 * Binds the manager's permission callbacks (protocol, basket, certificate,
 * spending authorization and grouped requests) to a y/N question on the
 * TTY. A "y" answers the request in flight and is remembered in the
 * permission store through `grantPermission` / `grantGroupedPermission`; any
 * other answer denies it. When no interactive terminal is attached every
 * request is denied with a message that says how to run interactively.
 * There is no auto-approve path.
 *
 * The manager swallows exceptions thrown by callbacks and keeps the app's
 * call pending until `grant*` or `deny*` is called, so every path here ends
 * in exactly one of those calls. Prompts are serialized so concurrent
 * requests do not interleave on the terminal.
 */

import { createInterface } from 'node:readline'
import type {
	CounterpartyPermissionEventHandler,
	GroupedPermissionEventHandler,
	GroupedPermissionRequest,
	GroupedPermissions,
	PermissionEventHandler,
	PermissionRequest,
	WalletPermissionsManagerCallbacks,
} from '@bsv/wallet-toolbox'

/** The subset of `WalletPermissionsManager` the prompts drive. */
export interface PermissionPromptTarget {
	bindCallback(
		eventName: keyof WalletPermissionsManagerCallbacks,
		handler:
			| PermissionEventHandler
			| GroupedPermissionEventHandler
			| CounterpartyPermissionEventHandler,
	): number
	grantPermission(params: { requestID: string; expiry?: number }): Promise<void>
	denyPermission(requestID: string): Promise<void>
	grantGroupedPermission(params: {
		requestID: string
		granted: Partial<GroupedPermissions>
		expiry?: number
	}): Promise<void>
	denyGroupedPermission(requestID: string): Promise<void>
}

export interface PermissionPromptOptions {
	/** Where questions are read from. Defaults to `process.stdin`. */
	input?: NodeJS.ReadableStream
	/** Where questions are written to. Defaults to `process.stdout`. */
	output?: NodeJS.WritableStream
	/**
	 * Whether a person can answer prompts. Defaults to `process.stdin.isTTY`.
	 * When false every request is denied.
	 */
	interactive?: boolean
	/** Log line sink. Defaults to `console.log`. */
	log?: (line: string) => void
}

export interface PermissionPrompts {
	/** True when requests are put to the terminal instead of denied. */
	readonly interactive: boolean
}

export const NOT_INTERACTIVE_MESSAGE =
	'1sat serve wallet-api is not attached to an interactive terminal, so permission requests cannot be approved. ' +
	'Run `1sat serve wallet-api` in a terminal (not under a service manager and without redirected stdin) to approve requests.'

/** Bind the manager's permission events to terminal prompts. */
export function bindPermissionPrompts(
	manager: PermissionPromptTarget,
	options: PermissionPromptOptions = {},
): PermissionPrompts {
	const interactive = options.interactive ?? process.stdin.isTTY === true
	const input = options.input ?? process.stdin
	const output = options.output ?? process.stdout
	const log = options.log ?? ((line: string) => console.log(line))

	// One question at a time.
	let queue: Promise<void> = Promise.resolve()
	const enqueue = (task: () => Promise<void>): Promise<void> => {
		const run = queue.then(task, task)
		queue = run.catch(() => undefined)
		return run
	}

	const ask = (question: string): Promise<boolean> =>
		new Promise((resolve) => {
			const rl = createInterface({ input, output })
			rl.question(question, (answer) => {
				rl.close()
				resolve(/^y(es)?$/i.test(answer.trim()))
			})
		})

	const decide = async (
		summary: string[],
		onYes: () => Promise<void>,
		onNo: () => Promise<void>,
	): Promise<void> => {
		if (!interactive) {
			log(`[wallet-api] denied: ${summary[0]}`)
			log(`[wallet-api] ${NOT_INTERACTIVE_MESSAGE}`)
			await onNo()
			return
		}
		await enqueue(async () => {
			output.write('\n[wallet-api] permission request\n')
			for (const line of summary) output.write(`  ${line}\n`)
			const yes = await ask('  Approve? [y/N] ')
			if (yes) {
				await onYes()
				log(`[wallet-api] granted: ${summary[0]}`)
			} else {
				await onNo()
				log(`[wallet-api] denied: ${summary[0]}`)
			}
		})
	}

	const safely = async (
		what: string,
		fn: () => Promise<void>,
	): Promise<void> => {
		try {
			await fn()
		} catch (err) {
			log(`[wallet-api] ${what} failed: ${(err as Error).message}`)
		}
	}

	const single: PermissionEventHandler = async (request) => {
		await decide(
			describeRequest(request),
			() =>
				safely('grant', () =>
					manager.grantPermission({ requestID: request.requestID }),
				),
			() => safely('deny', () => manager.denyPermission(request.requestID)),
		)
	}

	const grouped: GroupedPermissionEventHandler = async (request) => {
		await decide(
			describeGroupedRequest(request),
			() =>
				safely('grant', () =>
					manager.grantGroupedPermission({
						requestID: request.requestID,
						granted: request.permissions,
					}),
				),
			() =>
				safely('deny', () => manager.denyGroupedPermission(request.requestID)),
		)
	}

	manager.bindCallback('onProtocolPermissionRequested', single)
	manager.bindCallback('onBasketAccessRequested', single)
	manager.bindCallback('onCertificateAccessRequested', single)
	manager.bindCallback('onSpendingAuthorizationRequested', single)
	manager.bindCallback('onGroupedPermissionRequested', grouped)

	return { interactive }
}

/** Lines describing a single permission request; the first is a one-line summary. */
export function describeRequest(
	request: PermissionRequest & { requestID: string },
): string[] {
	const origin = request.displayOriginator ?? request.originator
	const lines: string[] = []
	switch (request.type) {
		case 'protocol': {
			const [level, name] = request.protocolID ?? [0, '?']
			lines.push(
				`${origin} wants to use protocol "${name}" (level ${level}${
					request.usageType ? `, ${request.usageType}` : ''
				})`,
			)
			if (request.counterparty)
				lines.push(`counterparty: ${request.counterparty}`)
			if (request.privileged) lines.push('privileged: yes')
			break
		}
		case 'basket':
			lines.push(
				`${origin} wants ${request.usageType ?? 'access'} access to basket "${request.basket}"`,
			)
			break
		case 'certificate': {
			const c = request.certificate
			lines.push(
				`${origin} wants to disclose certificate "${c?.certType}" fields [${(
					c?.fields ?? []
				).join(', ')}]`,
			)
			if (c?.verifier) lines.push(`verifier: ${c.verifier}`)
			if (request.privileged) lines.push('privileged: yes')
			break
		}
		case 'spending': {
			const sats = request.spending?.satoshis ?? 0
			lines.push(`${origin} wants to spend ${sats} sat`)
			for (const item of request.spending?.lineItems ?? []) {
				lines.push(`  ${item.type}: ${item.description} (${item.satoshis} sat)`)
			}
			break
		}
	}
	if (request.renewal) lines.push('renewal of an expired grant')
	if (request.reason) lines.push(`reason: ${request.reason}`)
	return lines
}

/** Lines describing a grouped (manifest) permission request. */
export function describeGroupedRequest(
	request: GroupedPermissionRequest,
): string[] {
	const p = request.permissions
	const lines = [`${request.originator} requests a set of permissions`]
	if (p.description) lines.push(`description: ${p.description}`)
	if (p.spendingAuthorization) {
		lines.push(
			`spend up to ${p.spendingAuthorization.amount} sat per month: ${p.spendingAuthorization.description}`,
		)
	}
	for (const proto of p.protocolPermissions ?? []) {
		lines.push(
			`protocol "${proto.protocolID[1]}" (level ${proto.protocolID[0]}${
				proto.counterparty ? `, counterparty ${proto.counterparty}` : ''
			}): ${proto.description}`,
		)
	}
	for (const b of p.basketAccess ?? []) {
		lines.push(`basket "${b.basket}": ${b.description}`)
	}
	for (const c of p.certificateAccess ?? []) {
		lines.push(
			`certificate "${c.type}" fields [${c.fields.join(', ')}] to ${c.verifierPublicKey}: ${c.description}`,
		)
	}
	return lines
}

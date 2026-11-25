/**
 * The wallet-api's answer to a permission it has not been granted.
 *
 * `1sat serve wallet-api` exists for agents and automation; a person who
 * wants to be asked runs a graphical wallet. So there is no prompt and no
 * auto-approve: anything the permission store does not already hold is
 * denied on the spot. The agent driving the app never sees this process's
 * terminal — it sees the app's error output — so the denial itself has to
 * carry the fix, which is the exact `1sat permissions grant …` command for
 * the permission that was refused.
 *
 * `WalletPermissionsManager.denyPermission` rejects the app's call with a
 * fixed `Permission denied.`, so the command is recorded as the request is
 * denied and swapped in at the HTTP boundary by `withDenialMessage`. The
 * recording is scoped to the in-flight call with `AsyncLocalStorage`: the
 * manager fires the permission event inside the same awaited chain as the
 * call that needs it, so the handler and the boundary share a context even
 * when several apps are being served at once.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import {
	type PermissionKey,
	normalizeOriginator,
	permissionKeyFromRequest,
	permissionKeysFromGroup,
} from '@1sat/wallet'
import type {
	CounterpartyPermissionEventHandler,
	GroupedPermissionEventHandler,
	GroupedPermissionRequest,
	PermissionEventHandler,
	PermissionRequest,
	WalletPermissionsManagerCallbacks,
} from '@bsv/wallet-toolbox'
import { GRANT_COMMAND, type GrantSpec, grantCommand } from './grants.js'

/** The subset of `WalletPermissionsManager` the denial handlers drive. */
export interface PermissionDenyTarget {
	bindCallback(
		eventName: keyof WalletPermissionsManagerCallbacks,
		handler:
			| PermissionEventHandler
			| GroupedPermissionEventHandler
			| CounterpartyPermissionEventHandler,
	): number
	denyPermission(requestID: string): Promise<void>
	denyGroupedPermission(requestID: string): Promise<void>
}

export interface DenyOptions {
	/**
	 * Command the message tells the caller to run, minus the origin and
	 * selectors — carries global flags where they matter, e.g.
	 * `1sat --chain test permissions grant`.
	 */
	grantCommandPrefix?: string
	/** Request log sink. Defaults to `console.log`. */
	log?: (line: string) => void
}

/** Messages recorded while one app-facing call is in flight. */
const inFlight = new AsyncLocalStorage<string[]>()

/** The manager's own code for a refusal, on the error it rejects with. */
const DENIED_CODE = 'ERR_PERMISSION_DENIED'

/**
 * Bind every permission event to an immediate denial.
 *
 * Same set the removed terminal prompts bound: protocol, basket,
 * certificate, spending authorization and the BRC-73 grouped request.
 */
export function bindPermissionDenials(
	manager: PermissionDenyTarget,
	options: DenyOptions = {},
): void {
	const prefix = options.grantCommandPrefix ?? GRANT_COMMAND
	const log = options.log ?? ((line: string) => console.log(line))

	const record = (origin: string, commands: string[]): void => {
		const message = denialMessage(origin, commands)
		inFlight.getStore()?.push(message)
		log(`[wallet-api] ${message}`)
	}

	const single: PermissionEventHandler = async (request) => {
		const origin = displayOrigin(request)
		try {
			record(origin, [grantCommand(specFromRequest(request), prefix)])
		} catch (err) {
			// An unreadable request still has to be denied; the app gets the
			// manager's plain message rather than a hung call.
			log(`[wallet-api] could not describe request: ${(err as Error).message}`)
		}
		await safely(log, 'deny', () => manager.denyPermission(request.requestID))
	}

	const grouped: GroupedPermissionEventHandler = async (request) => {
		const origin = normalizeOriginator(request.originator)
		try {
			record(
				origin,
				specsFromGroupedRequest(request).map((spec) =>
					grantCommand(spec, prefix),
				),
			)
		} catch (err) {
			log(`[wallet-api] could not describe request: ${(err as Error).message}`)
		}
		await safely(log, 'deny', () =>
			manager.denyGroupedPermission(request.requestID),
		)
	}

	manager.bindCallback('onProtocolPermissionRequested', single)
	manager.bindCallback('onBasketAccessRequested', single)
	manager.bindCallback('onCertificateAccessRequested', single)
	manager.bindCallback('onSpendingAuthorizationRequested', single)
	manager.bindCallback('onGroupedPermissionRequested', grouped)
}

/**
 * Run one app-facing wallet call, replacing the manager's bare
 * `Permission denied.` with the command that would allow it.
 *
 * Errors that are not denials pass through untouched, as does a denial the
 * handlers could not describe.
 */
export async function withDenialMessage<T>(fn: () => Promise<T>): Promise<T> {
	const messages: string[] = []
	try {
		return await inFlight.run(messages, fn)
	} catch (err) {
		const code = (err as { code?: unknown })?.code
		if (code !== DENIED_CODE || messages.length === 0) throw err
		const denied = new Error(messages.join(' ')) as Error & { code?: string }
		denied.code = DENIED_CODE
		throw denied
	}
}

/** `permission denied for <origin>: run \`…\` and retry` */
export function denialMessage(origin: string, commands: string[]): string {
	const quoted = commands.map((c) => `\`${c}\``)
	const list =
		quoted.length > 1
			? `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
			: quoted[0]
	return `permission denied for ${origin}: run ${list} and retry`
}

/** The grant a single permission request is asking for. */
export function specFromRequest(
	request: PermissionRequest & { requestID: string },
): GrantSpec {
	const key = permissionKeyFromRequest(
		request as unknown as Parameters<typeof permissionKeyFromRequest>[0],
	)
	return key.type === 'spending'
		? { key, authorizedAmount: request.spending?.satoshis ?? 0 }
		: { key }
}

/** Every grant a BRC-73 grouped request is asking for. */
export function specsFromGroupedRequest(
	request: GroupedPermissionRequest,
): GrantSpec[] {
	const amount = request.permissions.spendingAuthorization?.amount ?? 0
	return permissionKeysFromGroup(
		request.originator,
		request.permissions as unknown as Parameters<
			typeof permissionKeysFromGroup
		>[1],
	).map((key: PermissionKey) =>
		key.type === 'spending' ? { key, authorizedAmount: amount } : { key },
	)
}

function displayOrigin(request: PermissionRequest): string {
	return normalizeOriginator(request.originator)
}

async function safely(
	log: (line: string) => void,
	what: string,
	fn: () => Promise<void>,
): Promise<void> {
	try {
		await fn()
	} catch (err) {
		log(`[wallet-api] ${what} failed: ${(err as Error).message}`)
	}
}

import {
	LockingScript,
	type PublicKey,
	PushDrop,
	type WalletCounterparty,
	type WalletInterface,
	type WalletProtocol,
} from '@bsv/sdk'

/** Zeroed DER-sized placeholder so unsealed script length matches sealed. */
export const PUSHDROP_SIG_PLACEHOLDER_LEN = 72

export type PushDropLockParams = {
	fields: number[][]
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
	forSelf?: boolean
}

function counterpartyOf(params: PushDropLockParams): WalletCounterparty {
	return params.counterparty ?? 'anyone'
}

/**
 * Mint a PushDrop lock. Default is unsealed (zeroed trailing signature field)
 * so a permission-module apply pass can swap in the real signature without
 * changing script length. Pass `includeSignature: true` to seal immediately.
 */
export async function pushDropLock(
	wallet: WalletInterface,
	params: PushDropLockParams,
	opts?: { includeSignature?: boolean; placeholderLen?: number },
): Promise<LockingScript> {
	const includeSignature = opts?.includeSignature ?? false
	const fields = includeSignature
		? params.fields
		: [
				...params.fields,
				new Array(opts?.placeholderLen ?? PUSHDROP_SIG_PLACEHOLDER_LEN).fill(0),
			]
	return new PushDrop(wallet).lock(
		fields,
		params.protocolID,
		params.keyID,
		counterpartyOf(params),
		params.forSelf ?? true,
		includeSignature,
	)
}

/**
 * Replace a zeroed trailing signature field with a real PushDrop signature.
 * No-op-throw if the last field is not all zeros (already sealed / not a
 * placeholder). Callers that need idempotent seal should catch that.
 */
export async function pushDropSeal(
	wallet: WalletInterface,
	lockingScript: LockingScript | string,
	params: Omit<PushDropLockParams, 'fields'>,
): Promise<LockingScript> {
	const script =
		typeof lockingScript === 'string'
			? LockingScript.fromHex(lockingScript)
			: lockingScript
	const fields = PushDrop.decode(script).fields.map((f) => [...f])
	const placeholder = fields.pop()
	if (!placeholder?.length || placeholder.some((b) => b !== 0)) {
		throw new Error('pushdrop seal: signature field is not zeroed')
	}
	return new PushDrop(wallet).lock(
		fields,
		params.protocolID,
		params.keyID,
		params.counterparty ?? 'anyone',
		params.forSelf ?? true,
		true,
	)
}

export function pushDropDecode(lockingScript: LockingScript | string): {
	fields: number[][]
	lockingPublicKey: PublicKey
} {
	const script =
		typeof lockingScript === 'string'
			? LockingScript.fromHex(lockingScript)
			: lockingScript
	const decoded = PushDrop.decode(script)
	return {
		fields: decoded.fields,
		lockingPublicKey: decoded.lockingPublicKey,
	}
}

/** Wallet customInstructions needed to spend a PushDrop we locked. */
export function pushDropCustomInstructions(params: {
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
}): string {
	return JSON.stringify({
		protocolID: params.protocolID,
		keyID: params.keyID,
		counterparty: params.counterparty ?? 'anyone',
	})
}

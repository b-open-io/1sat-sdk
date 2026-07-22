import { OPNS_PUSHDROP_TEMPLATE } from '@1sat/types'
import {
	PushDrop,
	type Transaction,
	type WalletCounterparty,
	type WalletProtocol,
} from '@bsv/sdk'
import type { OneSatContext } from '../types'
import { signP2PKHInput } from './signP2PKH'

/** @deprecated use OPNS_PUSHDROP_TEMPLATE from @1sat/types */
export const PUSHDROP_TEMPLATE = OPNS_PUSHDROP_TEMPLATE

/** PushDrop unlock is a single CHECKSIG push (~73 bytes). */
export const PUSHDROP_UNLOCK_LENGTH = 73

/** P2PKH unlock sig + pubkey (~108 bytes). */
export const P2PKH_UNLOCK_LENGTH = 108

export interface OrdinalCustomInstructions {
	protocolID: WalletProtocol
	keyID: string
	counterparty?: WalletCounterparty
	template?: string
	name?: string
}

export function parseOrdinalCustomInstructions(
	customInstructions: string,
): OrdinalCustomInstructions | { error: string } {
	try {
		return JSON.parse(customInstructions) as OrdinalCustomInstructions
	} catch {
		return { error: 'invalid-custom-instructions' }
	}
}

export function unlockingScriptLengthForInstructions(
	customInstructions: string | undefined,
): number {
	if (!customInstructions) return P2PKH_UNLOCK_LENGTH
	const ci = parseOrdinalCustomInstructions(customInstructions)
	if ('error' in ci) return P2PKH_UNLOCK_LENGTH
	return ci.template === OPNS_PUSHDROP_TEMPLATE
		? PUSHDROP_UNLOCK_LENGTH
		: P2PKH_UNLOCK_LENGTH
}

/**
 * Unlock an ordinal input using customInstructions.
 * PushDrop when template === 'pushdrop'; otherwise P2PKH.
 */
export async function signOrdinalInput(
	ctx: OneSatContext,
	tx: Transaction,
	inputIndex: number,
	customInstructions: string,
): Promise<string | { error: string }> {
	const ci = parseOrdinalCustomInstructions(customInstructions)
	if ('error' in ci) return ci
	if (!ci.protocolID || !ci.keyID) {
		return { error: 'missing-protocol-or-key-id' }
	}

	if (ci.template === OPNS_PUSHDROP_TEMPLATE) {
		const unlocker = new PushDrop(ctx.wallet).unlock(
			ci.protocolID,
			ci.keyID,
			ci.counterparty ?? 'anyone',
		)
		const unlockingScript = await unlocker.sign(tx, inputIndex)
		return unlockingScript.toHex()
	}

	return signP2PKHInput(
		ctx,
		tx,
		inputIndex,
		ci.protocolID,
		ci.keyID,
		ci.counterparty ?? 'self',
	)
}

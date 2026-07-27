import {
	OPNS_BASKET,
	OPNS_REGISTER_COUNTERPARTY,
	P1SAT_PROTOCOL,
	opnsRegisterKeyId,
} from '@1sat/types'
import {
	type CreateActionArgs,
	PushDrop,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'

/**
 * Seal `opns.register` PushDrop field-sig onto the OpNS output in place.
 * Uses the given wallet (must be base — never a gated WPM wrapper).
 */
export async function applyOpnsRegister(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<void> {
	const outputs = args.outputs
	if (!outputs?.length) {
		throw new Error('opns.register apply: missing outputs')
	}
	const out =
		outputs.find((o) => o.basket === OPNS_BASKET) ??
		outputs.find((o) => o.satoshis === 1) ??
		outputs[0]
	if (!out) {
		throw new Error('opns.register apply: no output to seal')
	}

	const input = args.inputs?.[0]
	if (!input?.outpoint) {
		throw new Error('opns.register apply: missing input outpoint')
	}

	const { publicKey: identityPubKey } = await wallet.getPublicKey({
		identityKey: true,
	})
	const keyID = opnsRegisterKeyId(input.outpoint)
	const lockingScript = await new PushDrop(wallet).lock(
		[Utils.toArray(identityPubKey, 'hex')],
		P1SAT_PROTOCOL,
		keyID,
		OPNS_REGISTER_COUNTERPARTY,
		true,
		true,
	)
	out.lockingScript = lockingScript.toHex()
}

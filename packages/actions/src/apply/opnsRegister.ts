import {
	OPNS_BASKET,
	OPNS_REGISTER_COUNTERPARTY,
	opnsRegisterKeyId,
	P1SAT_PROTOCOL,
} from '@1sat/types'
import {
	type CreateActionArgs,
	LockingScript,
	PushDrop,
	type WalletInterface,
} from '@bsv/sdk'

/**
 * Replace the zeroed signature field of an `opns.register` lock with the real
 * one. The action emits the complete PushDrop script — identity key, profile
 * slots, and a zero-filled signature field of final length — so the only thing
 * left here is the signature. Uses the given wallet (must be base — never a
 * gated WPM wrapper).
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

	const fields = PushDrop.decode(
		LockingScript.fromHex(out.lockingScript),
	).fields.map((f) => [...f])
	const placeholder = fields.pop()
	if (!placeholder?.length || placeholder.some((b) => b !== 0)) {
		throw new Error('opns.register apply: signature field is not zeroed')
	}

	const lockingScript = await new PushDrop(wallet).lock(
		fields,
		P1SAT_PROTOCOL,
		opnsRegisterKeyId(input.outpoint),
		OPNS_REGISTER_COUNTERPARTY,
		true,
		true,
	)
	out.lockingScript = lockingScript.toHex()
}

import { decodeOpnsRecord } from '@1sat/templates'
import {
	OPNS_BASKET,
	OPNS_REGISTER_COUNTERPARTY,
	P1SAT_PROTOCOL,
	opnsRegisterKeyId,
} from '@1sat/types'
import {
	type CreateActionArgs,
	LockingScript,
	OP,
	PushDrop,
	Script,
	type WalletInterface,
} from '@bsv/sdk'

/**
 * Index of the first chunk after a lock-before PushDrop: `<pubkey> CHECKSIG`,
 * the field pushes, then the run of `OP_2DROP` / `OP_DROP`. Anything from
 * there on (an inscription envelope) is not part of the PushDrop.
 */
function pushDropEnd(script: LockingScript, fieldCount: number): number {
	let i = 2 + fieldCount
	while (
		i < script.chunks.length &&
		(script.chunks[i].op === OP.OP_2DROP || script.chunks[i].op === OP.OP_DROP)
	) {
		i++
	}
	return i
}

/**
 * Replace the zeroed signature field of an `opns.register` lock with the real
 * one. The action emits the complete script — the key/value record
 * (`identity`, `profile`, …), a zero-filled signature field of final length,
 * and optionally an inscription envelope after the PushDrop — so the only
 * thing left here is the signature.
 *
 * The inscription travels in the draft script itself: everything after the
 * PushDrop's drops is carried over unchanged onto the sealed lock. The record
 * is decoded before signing so only a well-formed record (exactly one
 * `identity` pair) is ever signed. Uses the given wallet (must be base —
 * never a gated WPM wrapper).
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

	const draft = LockingScript.fromHex(out.lockingScript)
	const fields = PushDrop.decode(draft).fields.map((f) => [...f])
	const suffix = draft.chunks.slice(pushDropEnd(draft, fields.length))
	const placeholder = fields.pop()
	if (!placeholder?.length || placeholder.some((b) => b !== 0)) {
		throw new Error('opns.register apply: signature field is not zeroed')
	}
	decodeOpnsRecord(fields)

	const sealed = await new PushDrop(wallet).lock(
		fields,
		P1SAT_PROTOCOL,
		opnsRegisterKeyId(input.outpoint),
		OPNS_REGISTER_COUNTERPARTY,
		true,
		true,
	)
	if (suffix.length) sealed.writeScript(new Script(suffix))
	out.lockingScript = sealed.toHex()
}

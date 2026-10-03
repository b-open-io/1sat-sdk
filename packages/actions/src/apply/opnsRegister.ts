import {
	IDENTITY_FIELD,
	OPNS_BASKET,
	OPNS_REGISTER_COUNTERPARTY,
	P1SAT_PROTOCOL,
	PROFILE_FIELD,
	opnsRegisterKeyId,
} from '@1sat/types'
import { decodeProfile, fieldPairs, isIdentityKey } from '@1sat/utils'
import {
	type CreateActionArgs,
	LockingScript,
	OP,
	PushDrop,
	Script,
	type WalletInterface,
} from '@bsv/sdk'
import { pushDropDecode } from '../utils/pushdrop.js'

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
 * Check the key/value fields before signing them: exactly one `identity`
 * (33-byte compressed key), at most one `profile` (valid DAG-CBOR profile).
 * Unknown keys are allowed.
 */
function assertPublishFields(fields: number[][]): void {
	let identities = 0
	let profiles = 0
	for (const [key, value] of fieldPairs(fields)) {
		if (key === IDENTITY_FIELD) {
			if (!isIdentityKey(value)) {
				throw new Error('opns.register apply: identity is not a compressed key')
			}
			identities++
		} else if (key === PROFILE_FIELD) {
			decodeProfile(value)
			profiles++
		}
	}
	if (identities !== 1 || profiles > 1) {
		throw new Error(
			'opns.register apply: fields need exactly one identity and at most one profile',
		)
	}
}

/**
 * Replace the zeroed signature field of an `opns.register` lock with the real
 * one. The action emits the complete script — the key/value fields
 * (`identity`, `profile`, …), a zero-filled signature field of final length,
 * and optionally an inscription envelope after the PushDrop — so the only
 * thing left here is the signature.
 *
 * The inscription travels in the draft script itself: everything after the
 * PushDrop's drops is carried over unchanged onto the sealed lock. The fields
 * are checked before signing so only a well-formed publish (exactly one
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
	const fields = pushDropDecode(draft).fields.map((f) => [...f])
	const suffix = draft.chunks.slice(pushDropEnd(draft, fields.length))
	const placeholder = fields.pop()
	if (!placeholder?.length || placeholder.some((b) => b !== 0)) {
		throw new Error('opns.register apply: signature field is not zeroed')
	}
	assertPublishFields(fields)

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

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
	type WalletInterface,
} from '@bsv/sdk'
import { pushDropDecode } from '../utils/pushdrop.js'

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
 * Put the real signature into an `opns.register` draft lock. The action emits
 * the complete script — `<lock pubkey> CHECKSIG`, the key/value fields
 * (`identity`, `profile`, …), a zero-filled signature push, the drops, and
 * optionally an inscription envelope. Apply signs the fields and replaces the
 * placeholder push (chunk `2 + fieldCount`) with the signature push; nothing
 * else in the script changes. The DER signature may be shorter than the
 * placeholder, so the push is re-encoded with its own length.
 *
 * The lock pubkey in the draft must be this wallet's key for the publish
 * keyID, and the fields are checked before signing so only a well-formed
 * publish (exactly one `identity` pair) is ever signed. Uses the given wallet
 * (must be base — never a gated WPM wrapper).
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
	const decoded = pushDropDecode(draft)
	const fields = decoded.fields.map((f) => [...f])
	const placeholder = fields.pop()
	if (!placeholder?.length || placeholder.some((b) => b !== 0)) {
		throw new Error('opns.register apply: signature field is not zeroed')
	}
	assertPublishFields(fields)

	const keyID = opnsRegisterKeyId(input.outpoint)
	const { publicKey } = await wallet.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: OPNS_REGISTER_COUNTERPARTY,
		forSelf: true,
	})
	if (publicKey !== decoded.lockingPublicKey.toString()) {
		throw new Error('opns.register apply: lock key does not match keyID')
	}

	const { signature } = await wallet.createSignature({
		data: fields.flat(),
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: OPNS_REGISTER_COUNTERPARTY,
	})
	// Signatures are 70–72 bytes: always a direct push (opcode = length).
	const chunks = [...draft.chunks]
	const at = 2 + fields.length
	if (chunks[at]?.data?.length !== placeholder.length) {
		throw new Error('opns.register apply: placeholder push not found')
	}
	chunks[at] = { op: signature.length, data: signature }
	out.lockingScript = new LockingScript(chunks).toHex()
}

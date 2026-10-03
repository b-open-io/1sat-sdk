/**
 * Resolve OpNS alias → identity via tip UTXO PushDrop bind.
 */

import type { OneSatServices } from '@1sat/client'
import { outpointFromBytes } from '@1sat/templates'
import {
	IDENTITY_FIELD,
	P1SAT_PROTOCOL,
	PROFILE_FIELD,
	opnsRegisterKeyId,
} from '@1sat/types'
import {
	type Profile,
	decodeProfile,
	fieldPairs,
	isIdentityKey,
} from '@1sat/utils'
import {
	type LockingScript,
	ProtoWallet,
	PushDrop,
	Transaction,
	Utils,
} from '@bsv/sdk'
import type { ResolvedBind } from './types.js'

function parseOutpoint(outpoint: string): { txid: string; vout: number } {
	const normalized = outpoint.replace('_', '.')
	const [txid, voutStr] = normalized.split('.')
	const vout = Number(voutStr)
	if (!txid || !Number.isFinite(vout)) {
		throw new Error(`invalid outpoint: ${outpoint}`)
	}
	return { txid, vout }
}

/**
 * Load tip locking script for alias, verify PushDrop bind, return identity key.
 *
 * The OpNS lookup returns the name's ORIGIN outpoint; the current tip is
 * resolved by following the origin's spend chain via ORDFS (`:-1` = latest).
 */
export async function resolvePaymailBind(
	services: OneSatServices,
	alias: string,
): Promise<ResolvedBind> {
	const { outpoint: originOutpoint } = await services.opns.getOrigin(alias)
	const latest = await services.ordfs.getMetadata(originOutpoint, -1)
	const { txid, vout } = parseOutpoint(latest.outpoint)

	const beefBytes = await services.beef.getBeef(txid)
	const tx = Transaction.fromBEEF(Array.from(beefBytes))
	const output = tx.outputs[vout]
	if (!output?.lockingScript) {
		throw new Error(`no output at ${txid}.${vout}`)
	}

	const bind = await verifyPushDropBind(tx, vout, output.lockingScript)
	return { ...bind, outpoint: `${txid}.${vout}` }
}

/**
 * Read `identity` / `profile` from key/value PushDrop fields (signature
 * removed). Unknown keys are skipped. Exactly one `identity` (33-byte
 * compressed key) and at most one `profile` are allowed; anything else —
 * including the pre-#83 positional bind — is "no bind".
 */
function readBindFields(fields: number[][]): {
	identityKey: string
	profile?: Profile
} {
	let identityKey: string | undefined
	let profile: Profile | undefined
	let sawProfile = false
	for (const [key, value] of fieldPairs(fields)) {
		if (key === IDENTITY_FIELD) {
			if (identityKey !== undefined) throw new Error('duplicate identity')
			if (!isIdentityKey(value)) throw new Error('identity is not a key')
			identityKey = Utils.toHex(value)
		} else if (key === PROFILE_FIELD) {
			if (sawProfile) throw new Error('duplicate profile')
			sawProfile = true
			profile = decodeProfile(value)
		}
	}
	if (identityKey === undefined) throw new Error('missing identity')
	return { identityKey, ...(profile ? { profile } : {}) }
}

/**
 * Verify the bind on a name coin and return the identity it names.
 *
 * The lock is a signed PushDrop whose fields are key/value pairs
 * (`identity`, `profile`, …) followed by the field signature.
 */
export async function verifyPushDropBind(
	tx: Transaction,
	_vout: number,
	lockingScript: LockingScript,
): Promise<Omit<ResolvedBind, 'outpoint'>> {
	const decoded = PushDrop.decode(lockingScript)
	if (decoded.fields.length < 3) {
		throw new Error('no bind: not a signed key/value PushDrop')
	}

	const fields = decoded.fields.map((f) => [...f])
	const signature = fields.pop() as number[]
	let bind: ReturnType<typeof readBindFields>
	try {
		bind = readBindFields(fields)
	} catch (err) {
		throw new Error(
			`no bind: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	const { identityKey, profile } = bind

	const input = tx.inputs[0]
	const sourceTxid =
		input.sourceTXID ?? input.sourceTransaction?.id('hex') ?? ''
	const sourceVout = input.sourceOutputIndex
	if (!sourceTxid) {
		throw new Error('missing creation input outpoint')
	}
	const keyID = opnsRegisterKeyId(`${sourceTxid}.${sourceVout}`)

	const anyone = new ProtoWallet('anyone')
	// forSelf: false = the identity's derived key for counterparty 'anyone',
	// which is the key PushDrop.lock derives on the owner's wallet.
	const { publicKey: expectedLockPub } = await anyone.getPublicKey({
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: identityKey,
		forSelf: false,
	})
	if (expectedLockPub !== decoded.lockingPublicKey.toString()) {
		throw new Error('lock pubkey does not match bind derivation')
	}

	const data = fields.flat()
	const { valid } = await anyone.verifySignature({
		data,
		signature,
		protocolID: P1SAT_PROTOCOL,
		keyID,
		counterparty: identityKey,
	})
	if (!valid) {
		throw new Error('invalid PushDrop field signature')
	}

	return {
		identityKey,
		...(profile?.domain ? { domain: profile.domain } : {}),
		...(profile?.displayName ? { profileName: profile.displayName } : {}),
		...(profile?.avatar
			? { avatarOrigin: outpointFromBytes(profile.avatar) ?? undefined }
			: {}),
	}
}

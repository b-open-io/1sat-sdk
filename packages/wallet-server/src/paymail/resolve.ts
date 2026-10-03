/**
 * Resolve OpNS alias → identity via tip UTXO PushDrop bind.
 */

import type { OneSatServices } from '@1sat/client'
import { type OpnsRecord, decodeOpnsRecord } from '@1sat/templates'
import { P1SAT_PROTOCOL, opnsRegisterKeyId } from '@1sat/types'
import {
	type LockingScript,
	ProtoWallet,
	PushDrop,
	Transaction,
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
 * Verify the OpNS record on a name coin and return the identity it binds.
 *
 * The record is a signed PushDrop whose fields are key/value pairs
 * (`identity`, `profile`, …) followed by the field signature. Anything else —
 * including the pre-#83 positional bind `[pubkey, name?, avatar?, sig]` — is
 * "no bind" (clean break, no compat path).
 */
export async function verifyPushDropBind(
	tx: Transaction,
	_vout: number,
	lockingScript: LockingScript,
): Promise<Omit<ResolvedBind, 'outpoint'>> {
	const decoded = PushDrop.decode(lockingScript)
	if (decoded.fields.length < 3) {
		throw new Error('no bind: not a signed OpNS record')
	}

	const fields = decoded.fields.map((f) => [...f])
	const signature = fields.pop() as number[]
	let record: OpnsRecord
	try {
		record = decodeOpnsRecord(fields)
	} catch (err) {
		throw new Error(
			`no bind: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	const { identityKey, profile } = record

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
		...(profile?.avatar ? { avatarOrigin: profile.avatar } : {}),
	}
}

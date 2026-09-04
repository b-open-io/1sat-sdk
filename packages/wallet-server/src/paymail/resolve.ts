/**
 * Resolve OpNS alias → identity via tip UTXO PushDrop bind.
 */

import type { OneSatServices } from '@1sat/client'
import { outpointFromBytes } from '@1sat/templates'
import { P1SAT_PROTOCOL, opnsRegisterKeyId } from '@1sat/types'
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
 * Slots after the identity key are presentation-only: slot 1 display name
 * (utf8), slot 2 avatar origin outpoint (36 bytes). Both optional. An empty
 * push decodes as `[]` or `[0]`, either of which means unset.
 */
function decodeProfileSlots(fields: number[][]): {
	profileName?: string
	avatarOrigin?: string
} {
	const isUnset = (f: number[] | undefined) =>
		!f?.length || (f.length === 1 && f[0] === 0)

	const name = fields[1]
	const avatar = fields[2]
	return {
		...(isUnset(name) ? {} : { profileName: Utils.toUTF8(name as number[]) }),
		...(isUnset(avatar) || avatar?.length !== 36
			? {}
			: { avatarOrigin: outpointFromBytes(avatar) ?? undefined }),
	}
}

export async function verifyPushDropBind(
	tx: Transaction,
	vout: number,
	lockingScript: LockingScript,
): Promise<Omit<ResolvedBind, 'outpoint'>> {
	const decoded = PushDrop.decode(lockingScript)
	if (decoded.fields.length < 2) {
		throw new Error('not a signed PushDrop bind')
	}

	const fields = decoded.fields.map((f) => [...f])
	const signature = fields.pop() as number[]
	const idKeyBytes = fields[0]
	if (!idKeyBytes?.length) {
		throw new Error('missing identity field')
	}
	const identityKey = Utils.toHex(idKeyBytes)

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

	const data = fields.reduce<number[]>((a, e) => [...a, ...e], [])
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

	return { identityKey, ...decodeProfileSlots(fields) }
}

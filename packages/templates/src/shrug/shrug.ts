import { LockingScript, OP, Script, Utils } from '@bsv/sdk'
import Inscription from '../inscription/inscription.js'
import {
	SHRUG_METADATA_CONTENT_TYPE,
	type ShrugMetadata,
	decodeShrugMetadata,
	outpointFromBytes,
	outpointToBytes,
} from './metadata.js'

/** The 13-byte UTF-8 shrug tag ¯\_(ツ)_/¯ */
export const SHRUG_TAG_HEX = 'c2af5c5f28e38384295f2fc2af'

/**
 * Decoded shrug token output.
 *
 * Wire format:
 * `<push tag> <push 36-byte id | OP_0> OP_2DROP <push amount | OP_0> OP_DROP <owner script>`
 */
export interface ShrugData {
	/** Token id `txid_vout`; absent on deploy outputs (the id is the output's own outpoint) */
	id?: string
	/** 0n = mint authority, >0n = token value; arbitrary precision */
	amount: bigint
	/** Script following the prefix (owner script, possibly with an inscription envelope) */
	scriptSuffix: number[]
	/** Inscription found in the suffix, if any */
	insc?: Inscription
	/** Populated when the suffix inscription carries application/shrug+cbor */
	metadata?: ShrugMetadata
}

/** Encode a non-negative bigint as a minimal Bitcoin script number (little-endian) */
function encodeScriptNum(n: bigint): number[] {
	const bytes: number[] = []
	let v = n
	while (v > 0n) {
		bytes.push(Number(v & 0xffn))
		v >>= 8n
	}
	if (bytes.length > 0 && (bytes[bytes.length - 1] & 0x80) !== 0) {
		bytes.push(0x00)
	}
	return bytes
}

/** Decode a minimal Bitcoin script number. Returns null for non-minimal encodings */
function decodeScriptNum(data: number[]): bigint | null {
	if (data.length === 0) return 0n
	const last = data[data.length - 1]
	if (
		(last & 0x7f) === 0 &&
		(data.length === 1 || (data[data.length - 2] & 0x80) === 0)
	) {
		return null
	}
	let v = 0n
	for (let i = data.length - 1; i >= 0; i--) {
		const byte = i === data.length - 1 ? data[i] & 0x7f : data[i]
		v = (v << 8n) | BigInt(byte)
	}
	return (last & 0x80) !== 0 ? -v : v
}

/**
 * Shrug token template: a binary evolution of BSV-21 encoding token data as
 * a stack-neutral prefix of raw pushes at the front of the locking script.
 */
export default class Shrug {
	/** Token id `txid_vout`; omit for deploy outputs */
	public readonly id?: string
	/** 0n = mint authority, >0n = token value */
	public readonly amount: bigint

	constructor(token: { id?: string; amount?: bigint } = {}) {
		if (token.amount !== undefined && token.amount < 0n) {
			throw new Error('amount must be non-negative')
		}
		this.id = token.id
		this.amount = token.amount ?? 0n
	}

	/**
	 * Decode a shrug output from a locking script.
	 *
	 * Runs the inscription decoder on the script suffix; an
	 * application/shrug+cbor inscription populates `metadata`. Malformed
	 * metadata does not invalidate the token output.
	 */
	static decode(script: Script): ShrugData | null {
		const chunks = script.chunks
		if (chunks.length < 5) return null
		const [tag, idChunk, twoDrop, amountChunk, drop] = chunks

		if (!tag.data || Utils.toHex(tag.data) !== SHRUG_TAG_HEX) return null

		let id: string | undefined
		if (idChunk.op > OP.OP_PUSHDATA4) return null
		if (idChunk.data && idChunk.data.length === 36) {
			id = outpointFromBytes(idChunk.data) ?? undefined
			if (!id) return null
		} else if (idChunk.data && idChunk.data.length !== 0) {
			return null
		}

		if (twoDrop.op !== OP.OP_2DROP) return null

		if (amountChunk.op > OP.OP_PUSHDATA4) return null
		const amount = decodeScriptNum(amountChunk.data ?? [])
		if (amount === null || amount < 0n) return null

		if (drop.op !== OP.OP_DROP) return null

		const suffix = new Script(chunks.slice(5))
		const data: ShrugData = {
			id,
			amount,
			scriptSuffix: suffix.toBinary(),
		}

		const insc = Inscription.decode(suffix)
		if (insc) {
			data.insc = insc
			if (insc.file.type === SHRUG_METADATA_CONTENT_TYPE) {
				data.metadata = decodeShrugMetadata(insc.file.content) ?? undefined
			}
		}

		return data
	}

	/**
	 * Build a shrug locking script.
	 *
	 * @param suffix - owner locking script, optionally preceded by an inscription envelope
	 */
	lock(suffix?: Script | LockingScript): LockingScript {
		const chunks: { op: number; data?: number[] }[] = [
			{ op: 13, data: Utils.toArray(SHRUG_TAG_HEX, 'hex') },
		]

		if (this.id !== undefined) {
			const idBytes = outpointToBytes(this.id)
			if (!idBytes) {
				throw new Error(`invalid token id outpoint: ${this.id}`)
			}
			chunks.push({ op: 36, data: idBytes })
		} else {
			chunks.push({ op: OP.OP_0 })
		}

		chunks.push({ op: OP.OP_2DROP })

		if (this.amount > 0n) {
			const amountBytes = encodeScriptNum(this.amount)
			chunks.push({
				op: amountBytes.length <= 75 ? amountBytes.length : OP.OP_PUSHDATA1,
				data: amountBytes,
			})
		} else {
			chunks.push({ op: OP.OP_0 })
		}

		chunks.push({ op: OP.OP_DROP })

		if (suffix) {
			chunks.push(...suffix.chunks)
		}

		return new LockingScript(chunks)
	}
}

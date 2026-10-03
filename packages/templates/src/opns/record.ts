import {
	OPNS_PROFILE_FIELD,
	OPNS_RECORD_IDENTITY_KEY,
	OPNS_RECORD_PROFILE_KEY,
	formatOrdinalOutpoint,
} from '@1sat/types'
import { Utils } from '@bsv/sdk'
import { decode as cborDecode, encode as cborEncode } from '@ipld/dag-cbor'
import { outpointFromBytes, outpointToBytes } from '../shrug/metadata.js'

/**
 * Facts about the identity an OpNS name represents, carried as the
 * DAG-CBOR value of the `profile` pair. Optional fields are absent (no key in
 * the map) when unset — never placeholders.
 */
export interface OpnsProfile {
	/** BRC-169 ecosystem domain (lowercase hostname). Required. */
	domain: string
	/** Presentation name. */
	displayName?: string
	/** Origin outpoint (`txid_vout`) of an on-chain image ordinal. */
	avatar?: string
}

/** Decoded OpNS name record (the signed PushDrop fields, signature excluded). */
export interface OpnsRecord {
	/** Compressed identity public key, hex. */
	identityKey: string
	profile?: OpnsProfile
}

const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Loose hostname check — lowercase labels of `[a-z0-9-]`, no ports, no
 * scheme, no DNS lookup.
 */
export function isOpnsDomain(domain: string): boolean {
	if (!domain || domain.length > 253) return false
	return domain.split('.').every((label) => HOSTNAME_LABEL.test(label))
}

function isCompressedPubKey(bytes: number[]): boolean {
	return bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)
}

/**
 * Encode the `profile` value: a DAG-CBOR map with `domain` and, when set,
 * `displayName` / `avatar` (36-byte outpoint bytes). `domain` is trimmed and
 * lowercased; empty optionals are omitted.
 */
export function encodeOpnsProfile(profile: OpnsProfile): number[] {
	const domain = profile.domain?.trim().toLowerCase() ?? ''
	if (!isOpnsDomain(domain)) {
		throw new Error(`invalid opns domain: ${profile.domain}`)
	}
	const map: Record<string, string | Uint8Array> = {
		[OPNS_PROFILE_FIELD.domain]: domain,
	}
	const displayName = profile.displayName?.trim()
	if (displayName) map[OPNS_PROFILE_FIELD.displayName] = displayName
	const avatar = profile.avatar?.trim()
	if (avatar) {
		const bytes = outpointToBytes(formatOrdinalOutpoint(avatar))
		if (!bytes) throw new Error(`invalid avatar outpoint: ${avatar}`)
		map[OPNS_PROFILE_FIELD.avatar] = Uint8Array.from(bytes)
	}
	return Array.from(cborEncode(map))
}

/** Decode and validate a `profile` value. Unknown map fields are ignored. */
export function decodeOpnsProfile(bytes: number[]): OpnsProfile {
	const map = cborDecode<unknown>(Uint8Array.from(bytes))
	if (!map || typeof map !== 'object' || Array.isArray(map)) {
		throw new Error('opns profile is not a map')
	}
	const m = map as Record<string, unknown>
	const domain = m[OPNS_PROFILE_FIELD.domain]
	if (typeof domain !== 'string' || !isOpnsDomain(domain)) {
		throw new Error('opns profile: missing or invalid domain')
	}
	const profile: OpnsProfile = { domain }

	const displayName = m[OPNS_PROFILE_FIELD.displayName]
	if (displayName !== undefined) {
		if (typeof displayName !== 'string') {
			throw new Error('opns profile: displayName is not a string')
		}
		profile.displayName = displayName
	}

	const avatar = m[OPNS_PROFILE_FIELD.avatar]
	if (avatar !== undefined) {
		const origin =
			avatar instanceof Uint8Array
				? outpointFromBytes(Array.from(avatar))
				: null
		if (!origin) throw new Error('opns profile: avatar is not 36 bytes')
		profile.avatar = origin
	}
	return profile
}

/**
 * Encode an OpNS record as PushDrop data fields (signature not included):
 * `["identity", <pubkey>, "profile", <dag-cbor>]`. The `profile` pair is
 * written only when `record.profile` is given.
 */
export function encodeOpnsRecord(record: OpnsRecord): number[][] {
	const identity = Utils.toArray(record.identityKey, 'hex')
	if (!isCompressedPubKey(identity)) {
		throw new Error('opns record: identity must be a 33-byte compressed key')
	}
	const fields = [Utils.toArray(OPNS_RECORD_IDENTITY_KEY, 'utf8'), identity]
	if (record.profile) {
		fields.push(
			Utils.toArray(OPNS_RECORD_PROFILE_KEY, 'utf8'),
			encodeOpnsProfile(record.profile),
		)
	}
	return fields
}

/**
 * Decode OpNS record pairs (the PushDrop data fields with the trailing
 * signature already removed). Pairs are read in order; pairs with an unknown
 * key are skipped. Throws unless there is exactly one `identity` pair, at
 * most one `profile` pair, and an even number of fields. The pre-#83
 * positional bind (`[pubkey, name?, avatar?]`) fails here — no compat path.
 */
export function decodeOpnsRecord(fields: number[][]): OpnsRecord {
	if (fields.length === 0 || fields.length % 2 !== 0) {
		throw new Error('opns record: fields are not key/value pairs')
	}
	let identityKey: string | undefined
	let profile: OpnsProfile | undefined
	let sawProfile = false
	for (let i = 0; i < fields.length; i += 2) {
		const key = Utils.toUTF8(fields[i])
		const value = fields[i + 1]
		if (key === OPNS_RECORD_IDENTITY_KEY) {
			if (identityKey !== undefined) {
				throw new Error('opns record: duplicate identity pair')
			}
			if (!isCompressedPubKey(value)) {
				throw new Error('opns record: identity is not a compressed key')
			}
			identityKey = Utils.toHex(value)
		} else if (key === OPNS_RECORD_PROFILE_KEY) {
			if (sawProfile) throw new Error('opns record: duplicate profile pair')
			sawProfile = true
			profile = decodeOpnsProfile(value)
		}
	}
	if (identityKey === undefined) {
		throw new Error('opns record: missing identity pair')
	}
	return { identityKey, ...(profile ? { profile } : {}) }
}

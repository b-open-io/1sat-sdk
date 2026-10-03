/**
 * Field codecs for key/value PushDrop fields (`key, value, …, signature`).
 *
 * Each key names its value's encoding: `identity` is a raw 33-byte
 * compressed public key, `profile` is a DAG-CBOR map. Callers build and read
 * the field list themselves; these helpers only encode/decode single values
 * and split a field list into pairs.
 */

import { PROFILE_FIELDS } from '@1sat/types'
import { Utils } from '@bsv/sdk'
import { decode as cborDecode, encode as cborEncode } from '@ipld/dag-cbor'

/**
 * Value of the `profile` field. Optional members are absent (no key in the
 * map) when unset — never placeholders.
 */
export interface Profile {
	/** BRC-169 ecosystem domain (lowercase hostname). Required. */
	domain: string
	/** Presentation name. */
	displayName?: string
	/** 36-byte outpoint (txid internal order ‖ vout LE) of an image ordinal. */
	avatar?: number[]
}

const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Loose hostname check — lowercase labels of `[a-z0-9-]`, no ports, no
 * scheme, no DNS lookup.
 */
export function isHostname(domain: string): boolean {
	if (!domain || domain.length > 253) return false
	return domain.split('.').every((label) => HOSTNAME_LABEL.test(label))
}

/** `identity` field check: 33-byte compressed public key. */
export function isIdentityKey(bytes: number[]): boolean {
	return bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)
}

/**
 * Encode a `profile` value: DAG-CBOR map with `domain` and, when set,
 * `displayName` / `avatar`. `domain` is trimmed and lowercased; an empty
 * `displayName` or `avatar` is omitted.
 */
export function encodeProfile(profile: Profile): number[] {
	const domain = profile.domain?.trim().toLowerCase() ?? ''
	if (!isHostname(domain)) {
		throw new Error(`invalid profile domain: ${profile.domain}`)
	}
	const map: Record<string, string | Uint8Array> = {
		[PROFILE_FIELDS.domain]: domain,
	}
	const displayName = profile.displayName?.trim()
	if (displayName) map[PROFILE_FIELDS.displayName] = displayName
	if (profile.avatar?.length) {
		if (profile.avatar.length !== 36) {
			throw new Error('profile avatar must be a 36-byte outpoint')
		}
		map[PROFILE_FIELDS.avatar] = Uint8Array.from(profile.avatar)
	}
	return Array.from(cborEncode(map))
}

/** Decode and validate a `profile` value. Unknown map members are ignored. */
export function decodeProfile(bytes: number[]): Profile {
	const map = cborDecode<unknown>(Uint8Array.from(bytes))
	if (!map || typeof map !== 'object' || Array.isArray(map)) {
		throw new Error('profile is not a map')
	}
	const m = map as Record<string, unknown>
	const domain = m[PROFILE_FIELDS.domain]
	if (typeof domain !== 'string' || !isHostname(domain)) {
		throw new Error('profile: missing or invalid domain')
	}
	const profile: Profile = { domain }

	const displayName = m[PROFILE_FIELDS.displayName]
	if (displayName !== undefined) {
		if (typeof displayName !== 'string') {
			throw new Error('profile: displayName is not a string')
		}
		profile.displayName = displayName
	}

	const avatar = m[PROFILE_FIELDS.avatar]
	if (avatar !== undefined) {
		if (!(avatar instanceof Uint8Array) || avatar.length !== 36) {
			throw new Error('profile: avatar is not 36 bytes')
		}
		profile.avatar = Array.from(avatar)
	}
	return profile
}

/**
 * Split key/value PushDrop fields (signature already removed) into
 * `[key, value]` pairs, keys decoded as UTF-8. Throws on an odd count.
 */
export function fieldPairs(fields: number[][]): [string, number[]][] {
	if (fields.length % 2 !== 0) {
		throw new Error('fields are not key/value pairs')
	}
	const pairs: [string, number[]][] = []
	for (let i = 0; i < fields.length; i += 2) {
		pairs.push([Utils.toUTF8(fields[i]), fields[i + 1]])
	}
	return pairs
}

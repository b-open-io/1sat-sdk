/**
 * Permission grants as CLI arguments.
 *
 * One place translates between the three shapes a grant takes:
 *
 *  - the `PermissionKey` the store is indexed by,
 *  - the `1sat permissions grant …` command line a person or an agent types,
 *  - the one-line description `1sat permissions list` prints.
 *
 * The wallet-api denies every permission it has not been granted and puts
 * the command that would allow it into the error, so the app driving the
 * wallet can print it verbatim. That command is rendered here from the same
 * `PermissionKey` the store would be asked for, which is what keeps the
 * suggestion and the lookup from drifting apart.
 */

import {
	type PermissionKey,
	normalizeOriginator,
	permissionKeyToString,
} from '@1sat/wallet'

/** Protocols named `action label <x>` are how the manager gates action labels. */
const LABEL_PROTOCOL_PREFIX = 'action label '

/** The command word the denial message and help text point at. */
export const GRANT_COMMAND = '1sat permissions grant'

/** A grant as the `permissions` command's flags describe it. */
export interface GrantSpec {
	key: PermissionKey
	/** DSAP only — the monthly cap in satoshis. */
	authorizedAmount?: number
}

/** Quote a flag value for a shell only when it needs it. */
export function shellQuote(value: string): string {
	if (value !== '' && /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
	return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

/**
 * Render the `1sat permissions grant …` command that would allow `key`.
 *
 * `prefix` carries any global flags the caller needs (`1sat --chain test
 * permissions grant`), so the printed command works as-is on that chain.
 */
export function grantCommand(
	spec: GrantSpec,
	prefix: string = GRANT_COMMAND,
): string {
	const key = spec.key
	const parts = [prefix, shellQuote(key.originator)]
	switch (key.type) {
		case 'protocol': {
			if (
				key.protocolLevel === 1 &&
				key.protocolName.startsWith(LABEL_PROTOCOL_PREFIX)
			) {
				parts.push(
					'--label',
					shellQuote(key.protocolName.slice(LABEL_PROTOCOL_PREFIX.length)),
				)
				break
			}
			parts.push('--protocol', shellQuote(key.protocolName))
			parts.push('--level', String(key.protocolLevel))
			// Level 1 protocols are counterparty-less by definition (the key
			// always holds ''), so naming one would only mislead.
			if (key.protocolLevel !== 1 && key.counterparty) {
				parts.push('--counterparty', shellQuote(key.counterparty))
			}
			if (key.privileged) parts.push('--privileged')
			break
		}
		case 'basket':
			parts.push('--basket', shellQuote(key.basket))
			break
		case 'certificate':
			parts.push('--certificate', shellQuote(key.certType))
			parts.push('--fields', shellQuote(key.fields.join(',')))
			if (key.verifier) {
				parts.push('--counterparty', shellQuote(key.verifier))
			}
			if (key.privileged) parts.push('--privileged')
			break
		case 'spending':
			parts.push('--spending', String(spec.authorizedAmount ?? 0))
			break
	}
	return parts.join(' ')
}

/** One-line description of a grant, for `1sat permissions list`. */
export function describeKey(spec: GrantSpec): string {
	const key = spec.key
	switch (key.type) {
		case 'protocol': {
			if (
				key.protocolLevel === 1 &&
				key.protocolName.startsWith(LABEL_PROTOCOL_PREFIX)
			) {
				return `label    ${key.protocolName.slice(LABEL_PROTOCOL_PREFIX.length)}`
			}
			const bits = [`"${key.protocolName}" (level ${key.protocolLevel}`]
			if (key.protocolLevel !== 1 && key.counterparty) {
				bits.push(`, counterparty ${key.counterparty}`)
			}
			if (key.privileged) bits.push(', privileged')
			return `protocol ${bits.join('')})`
		}
		case 'basket':
			return `basket   "${key.basket}"`
		case 'certificate':
			return `cert     "${key.certType}" fields [${key.fields.join(', ')}]${
				key.verifier ? ` to ${key.verifier}` : ''
			}${key.privileged ? ' (privileged)' : ''}`
		case 'spending':
			return `spending up to ${spec.authorizedAmount ?? 0} sat per month`
	}
}

/** Flags `1sat permissions grant` / `revoke` accept, already parsed. */
export interface GrantFlags {
	protocol?: string
	level?: string
	counterparty?: string
	privileged: boolean
	basket?: string
	label?: string
	certificate?: string
	fields?: string
	spending?: string
}

/**
 * Turn parsed flags into the grants they name.
 *
 * Several selectors in one invocation produce several grants, so an app's
 * whole set can be granted in one line. Throws with a usable message when a
 * selector is incomplete; the caller reports it.
 */
export function specsFromFlags(origin: string, flags: GrantFlags): GrantSpec[] {
	const originator = normalizeOriginator(origin)
	if (!originator) throw new Error('An app origin is required')
	const specs: GrantSpec[] = []

	if (flags.protocol !== undefined || flags.label !== undefined) {
		if (flags.protocol !== undefined && flags.label !== undefined) {
			throw new Error('Use either --protocol or --label, not both')
		}
		const isLabel = flags.label !== undefined
		const name = isLabel
			? `${LABEL_PROTOCOL_PREFIX}${flags.label}`
			: (flags.protocol as string)
		if (!name.trim() || name === LABEL_PROTOCOL_PREFIX) {
			throw new Error(
				isLabel ? '--label requires a name' : '--protocol requires a name',
			)
		}
		// A label is always a level-1 protocol upstream; --level would only
		// let a caller write a key the manager never looks up.
		const level = isLabel ? 1 : parseLevel(flags.level)
		specs.push({
			key: {
				type: 'protocol',
				originator,
				privileged: flags.privileged,
				protocolLevel: level,
				protocolName: name,
				counterparty: level === 1 ? '' : (flags.counterparty ?? 'self'),
			},
		})
	}

	if (flags.basket !== undefined) {
		if (!flags.basket.trim()) throw new Error('--basket requires a name')
		specs.push({
			key: { type: 'basket', originator, basket: flags.basket },
		})
	}

	if (flags.certificate !== undefined) {
		if (!flags.certificate.trim()) {
			throw new Error('--certificate requires a certificate type')
		}
		const fields = (flags.fields ?? '')
			.split(',')
			.map((f) => f.trim())
			.filter((f) => f.length > 0)
		if (fields.length === 0) {
			throw new Error('--certificate requires --fields <a,b>')
		}
		specs.push({
			key: {
				type: 'certificate',
				originator,
				privileged: flags.privileged,
				verifier: flags.counterparty ?? '',
				certType: flags.certificate,
				fields: fields.sort(),
			},
		})
	}

	if (flags.spending !== undefined) {
		const satoshis = Number(flags.spending)
		if (!Number.isInteger(satoshis) || satoshis <= 0) {
			throw new Error('--spending requires a positive whole number of satoshis')
		}
		specs.push({
			key: { type: 'spending', originator },
			authorizedAmount: satoshis,
		})
	}

	if (specs.length === 0) {
		throw new Error(
			'Nothing selected. Pass --protocol/--label, --basket, --certificate or --spending',
		)
	}
	return specs
}

function parseLevel(value: string | undefined): 0 | 1 | 2 {
	if (value === undefined) {
		throw new Error('--protocol requires --level <0|1|2>')
	}
	if (value !== '0' && value !== '1' && value !== '2') {
		throw new Error(`--level must be 0, 1 or 2 (got ${value})`)
	}
	return Number(value) as 0 | 1 | 2
}

/** Canonical id of a grant; two selectors naming the same grant share it. */
export function specId(spec: GrantSpec): string {
	return permissionKeyToString(spec.key)
}

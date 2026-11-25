import { describe, expect, test } from 'bun:test'
import { permissionKeyToString } from '@1sat/wallet'
import { denialMessage, specsFromGroupedRequest } from '../src/wallet-api/deny'
import {
	describeKey,
	grantCommand,
	specsFromFlags,
} from '../src/wallet-api/grants'

const noFlags = { privileged: false }

/** The command a denial prints has to reproduce the key it was denied for. */
function roundTrip(args: string[]): string {
	const flags = {
		privileged: args.includes('--privileged'),
		protocol: flagValue(args, '--protocol'),
		level: flagValue(args, '--level'),
		counterparty: flagValue(args, '--counterparty'),
		basket: flagValue(args, '--basket'),
		label: flagValue(args, '--label'),
		certificate: flagValue(args, '--certificate'),
		fields: flagValue(args, '--fields'),
		spending: flagValue(args, '--spending'),
	}
	const [spec] = specsFromFlags(args[0], flags)
	return permissionKeyToString(spec.key)
}

function flagValue(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag)
	return i === -1 ? undefined : args[i + 1]
}

describe('grantCommand', () => {
	test('names a level-1 protocol without a counterparty', () => {
		const [spec] = specsFromFlags('gib', {
			...noFlags,
			protocol: 'gib branch',
			level: '1',
			counterparty: 'anyone',
		})
		expect(grantCommand(spec)).toBe(
			'1sat permissions grant gib --protocol "gib branch" --level 1',
		)
	})

	test('names the counterparty of a level-2 protocol', () => {
		const [spec] = specsFromFlags('gib', {
			...noFlags,
			protocol: 'messages',
			level: '2',
			counterparty: '02ab',
		})
		expect(grantCommand(spec)).toBe(
			'1sat permissions grant gib --protocol messages --level 2 --counterparty 02ab',
		)
	})

	test('renders baskets, labels, certificates and spending', () => {
		const specs = specsFromFlags('gib', {
			...noFlags,
			basket: 'gib refs',
			label: 'gib push',
			certificate: 'identity',
			fields: 'name,email',
			counterparty: '02ab',
			spending: '50000',
		})
		expect(specs.map((s) => grantCommand(s))).toEqual([
			'1sat permissions grant gib --label "gib push"',
			'1sat permissions grant gib --basket "gib refs"',
			'1sat permissions grant gib --certificate identity --fields email,name --counterparty 02ab',
			'1sat permissions grant gib --spending 50000',
		])
	})

	test('every rendered command names the key it was rendered from', () => {
		const cases: string[][] = [
			['gib', '--protocol', 'gib branch', '--level', '1'],
			[
				'gib',
				'--protocol',
				'messages',
				'--level',
				'2',
				'--counterparty',
				'02ab',
			],
			['gib', '--protocol', 'notes', '--level', '0', '--privileged'],
			['gib', '--basket', 'gib refs'],
			['gib', '--label', 'gib push'],
			['gib', '--certificate', 'identity', '--fields', 'name,email'],
			['gib', '--spending', '50000'],
		]
		for (const args of cases) {
			const before = roundTrip(args)
			const [spec] = specsFromFlags(args[0], {
				privileged: args.includes('--privileged'),
				protocol: flagValue(args, '--protocol'),
				level: flagValue(args, '--level'),
				counterparty: flagValue(args, '--counterparty'),
				basket: flagValue(args, '--basket'),
				label: flagValue(args, '--label'),
				certificate: flagValue(args, '--certificate'),
				fields: flagValue(args, '--fields'),
				spending: flagValue(args, '--spending'),
			})
			// Re-parse the command the denial would print, as a shell would.
			const printed = grantCommand(spec)
				.replace('1sat permissions grant ', '')
				.match(/"[^"]*"|\S+/g)!
				.map((t) => (t.startsWith('"') ? t.slice(1, -1) : t))
			expect(roundTrip(printed)).toBe(before)
		}
	})

	test('a selector is rejected rather than silently written wrong', () => {
		expect(() => specsFromFlags('gib', { ...noFlags, protocol: 'x' })).toThrow(
			'--protocol requires --level <0|1|2>',
		)
		expect(() =>
			specsFromFlags('gib', { ...noFlags, protocol: 'x', level: '7' }),
		).toThrow('--level must be 0, 1 or 2')
		expect(() =>
			specsFromFlags('gib', { ...noFlags, certificate: 'identity' }),
		).toThrow('--fields')
		expect(() => specsFromFlags('gib', { ...noFlags, spending: '-1' })).toThrow(
			'--spending',
		)
		expect(() => specsFromFlags('gib', noFlags)).toThrow('Nothing selected')
		expect(() =>
			specsFromFlags('gib', { ...noFlags, protocol: 'x', label: 'y' }),
		).toThrow('not both')
	})
})

describe('describeKey', () => {
	test('one line per grant', () => {
		const specs = specsFromFlags('gib', {
			...noFlags,
			protocol: 'messages',
			level: '2',
			counterparty: '02ab',
			basket: 'gib refs',
			spending: '50000',
		})
		expect(specs.map(describeKey)).toEqual([
			'protocol "messages" (level 2, counterparty 02ab)',
			'basket   "gib refs"',
			'spending up to 50000 sat per month',
		])
	})
})

describe('denialMessage', () => {
	test('one command', () => {
		expect(
			denialMessage('gib', ['1sat permissions grant gib --basket x']),
		).toBe(
			'permission denied for gib: run `1sat permissions grant gib --basket x` and retry',
		)
	})

	test('a grouped request lists every command it needs', () => {
		const specs = specsFromGroupedRequest({
			requestID: '1',
			originator: 'http://gib',
			permissions: {
				description: 'gib',
				spendingAuthorization: { amount: 50000, description: 'fees' },
				protocolPermissions: [
					{
						protocolID: [1, 'gib branch'],
						counterparty: 'self',
						description: 'refs',
					},
				],
				basketAccess: [{ basket: 'gib refs', description: 'refs' }],
			},
		} as unknown as Parameters<typeof specsFromGroupedRequest>[0])
		expect(
			denialMessage(
				'gib',
				specs.map((s) => grantCommand(s)),
			),
		).toBe(
			'permission denied for gib: run `1sat permissions grant gib --spending 50000`, ' +
				'`1sat permissions grant gib --protocol "gib branch" --level 1` and ' +
				'`1sat permissions grant gib --basket "gib refs"` and retry',
		)
	})
})

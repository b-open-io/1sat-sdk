import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import type {
	GroupedPermissionRequest,
	PermissionRequest,
} from '@bsv/wallet-toolbox'
import {
	NOT_INTERACTIVE_MESSAGE,
	type PermissionPromptTarget,
	bindPermissionPrompts,
	describeGroupedRequest,
	describeRequest,
} from '../src/wallet-api/prompts'

type Handler = (request: unknown) => Promise<void> | void

function fakeManager() {
	const handlers = new Map<string, Handler>()
	const log: string[] = []
	const manager: PermissionPromptTarget = {
		bindCallback(eventName, handler) {
			handlers.set(eventName, handler as Handler)
			return handlers.size
		},
		async grantPermission({ requestID }) {
			log.push(`grant:${requestID}`)
		},
		async denyPermission(requestID) {
			log.push(`deny:${requestID}`)
		},
		async grantGroupedPermission({ requestID, granted }) {
			log.push(`grantGroup:${requestID}:${(granted.basketAccess ?? []).length}`)
		},
		async denyGroupedPermission(requestID) {
			log.push(`denyGroup:${requestID}`)
		},
	}
	return { manager, handlers, log }
}

const basketRequest: PermissionRequest & { requestID: string } = {
	type: 'basket',
	originator: 'gib',
	basket: 'todo',
	usageType: 'insertion',
	reason: 'store todos',
	requestID: 'req-1',
}

const groupedRequest: GroupedPermissionRequest = {
	originator: 'gib',
	requestID: 'group-1',
	permissions: {
		description: 'gib needs these',
		basketAccess: [{ basket: 'todo', description: 'todos' }],
		protocolPermissions: [
			{ protocolID: [1, 'todo list'], description: 'sign todos' },
		],
	},
}

function fire(handlers: Map<string, Handler>, event: string, request: unknown) {
	const handler = handlers.get(event)
	if (!handler) throw new Error(`no handler for ${event}`)
	return handler(request)
}

describe('bindPermissionPrompts', () => {
	test('binds every single and grouped permission event', () => {
		const { manager, handlers } = fakeManager()
		bindPermissionPrompts(manager, { interactive: false, log: () => {} })
		expect([...handlers.keys()].sort()).toEqual([
			'onBasketAccessRequested',
			'onCertificateAccessRequested',
			'onGroupedPermissionRequested',
			'onProtocolPermissionRequested',
			'onSpendingAuthorizationRequested',
		])
	})

	test('grants on y and remembers via grantPermission', async () => {
		const { manager, handlers, log } = fakeManager()
		const input = new PassThrough()
		const output = new PassThrough()
		let shown = ''
		output.on('data', (chunk) => {
			shown += chunk.toString()
		})
		const lines: string[] = []
		bindPermissionPrompts(manager, {
			interactive: true,
			input,
			output,
			log: (l) => lines.push(l),
		})
		const pending = fire(handlers, 'onBasketAccessRequested', basketRequest)
		input.write('y\n')
		await pending
		expect(log).toEqual(['grant:req-1'])
		expect(shown).toContain('gib wants insertion access to basket "todo"')
		expect(shown).toContain('reason: store todos')
		expect(shown).toContain('Approve? [y/N]')
		expect(lines.some((l) => l.startsWith('[wallet-api] granted:'))).toBe(true)
	})

	test('denies on anything but y, including an empty answer', async () => {
		const { manager, handlers, log } = fakeManager()
		const input = new PassThrough()
		const output = new PassThrough()
		output.resume()
		bindPermissionPrompts(manager, {
			interactive: true,
			input,
			output,
			log: () => {},
		})
		const first = fire(handlers, 'onBasketAccessRequested', basketRequest)
		input.write('\n')
		await first
		const second = fire(handlers, 'onBasketAccessRequested', {
			...basketRequest,
			requestID: 'req-2',
		})
		input.write('nope\n')
		await second
		expect(log).toEqual(['deny:req-1', 'deny:req-2'])
	})

	test('serializes concurrent prompts', async () => {
		const { manager, handlers, log } = fakeManager()
		const input = new PassThrough()
		const output = new PassThrough()
		output.resume()
		bindPermissionPrompts(manager, {
			interactive: true,
			input,
			output,
			log: () => {},
		})
		const a = fire(handlers, 'onBasketAccessRequested', basketRequest)
		const b = fire(handlers, 'onProtocolPermissionRequested', {
			type: 'protocol',
			originator: 'gib',
			protocolID: [1, 'todo list'],
			usageType: 'signing',
			requestID: 'req-2',
		})
		input.write('y\n')
		input.write('n\n')
		await Promise.all([a, b])
		expect(log).toEqual(['grant:req-1', 'deny:req-2'])
	})

	test('grouped requests grant the requested set on y', async () => {
		const { manager, handlers, log } = fakeManager()
		const input = new PassThrough()
		const output = new PassThrough()
		let shown = ''
		output.on('data', (chunk) => {
			shown += chunk.toString()
		})
		bindPermissionPrompts(manager, {
			interactive: true,
			input,
			output,
			log: () => {},
		})
		const pending = fire(
			handlers,
			'onGroupedPermissionRequested',
			groupedRequest,
		)
		input.write('y\n')
		await pending
		expect(log).toEqual(['grantGroup:group-1:1'])
		expect(shown).toContain('basket "todo": todos')
		expect(shown).toContain('protocol "todo list" (level 1): sign todos')
	})

	test('denies everything without reading input when not interactive', async () => {
		const { manager, handlers, log } = fakeManager()
		const input = new PassThrough()
		const lines: string[] = []
		const prompts = bindPermissionPrompts(manager, {
			interactive: false,
			input,
			output: new PassThrough(),
			log: (l) => lines.push(l),
		})
		expect(prompts.interactive).toBe(false)
		await fire(handlers, 'onSpendingAuthorizationRequested', {
			type: 'spending',
			originator: 'gib',
			spending: { satoshis: 500 },
			requestID: 'req-9',
		})
		await fire(handlers, 'onGroupedPermissionRequested', groupedRequest)
		expect(log).toEqual(['deny:req-9', 'denyGroup:group-1'])
		expect(lines.join('\n')).toContain(NOT_INTERACTIVE_MESSAGE)
		expect(lines.join('\n')).toContain('gib wants to spend 500 sat')
	})

	test('a failing grant is logged, not thrown', async () => {
		const { manager, handlers } = fakeManager()
		manager.grantPermission = async () => {
			throw new Error('Request ID not found.')
		}
		const input = new PassThrough()
		const output = new PassThrough()
		output.resume()
		const lines: string[] = []
		bindPermissionPrompts(manager, {
			interactive: true,
			input,
			output,
			log: (l) => lines.push(l),
		})
		const pending = fire(handlers, 'onBasketAccessRequested', basketRequest)
		input.write('y\n')
		await pending
		expect(lines).toContain('[wallet-api] grant failed: Request ID not found.')
	})
})

describe('describeRequest', () => {
	test('protocol requests show level, usage and counterparty', () => {
		const lines = describeRequest({
			type: 'protocol',
			originator: 'gib',
			displayOriginator: 'https://gib',
			protocolID: [2, 'chat'],
			counterparty: '02aa',
			usageType: 'encrypting',
			privileged: true,
			requestID: 'r',
		})
		expect(lines[0]).toBe(
			'https://gib wants to use protocol "chat" (level 2, encrypting)',
		)
		expect(lines).toContain('counterparty: 02aa')
		expect(lines).toContain('privileged: yes')
	})

	test('certificate requests show type, fields and verifier', () => {
		const lines = describeRequest({
			type: 'certificate',
			originator: 'gib',
			certificate: {
				certType: 'kyc',
				fields: ['name', 'dob'],
				verifier: '03bb',
			},
			requestID: 'r',
		})
		expect(lines[0]).toBe(
			'gib wants to disclose certificate "kyc" fields [name, dob]',
		)
		expect(lines).toContain('verifier: 03bb')
	})

	test('spending requests itemize line items', () => {
		const lines = describeRequest({
			type: 'spending',
			originator: 'gib',
			spending: {
				satoshis: 1500,
				lineItems: [{ type: 'output', description: 'tip', satoshis: 1000 }],
			},
			requestID: 'r',
		})
		expect(lines[0]).toBe('gib wants to spend 1500 sat')
		expect(lines[1]).toContain('output: tip (1000 sat)')
	})

	test('grouped requests list the spending allowance', () => {
		const lines = describeGroupedRequest({
			originator: 'gib',
			requestID: 'g',
			permissions: {
				spendingAuthorization: { amount: 5000, description: 'tips' },
			},
		})
		expect(lines).toContain('spend up to 5000 sat per month: tips')
	})
})

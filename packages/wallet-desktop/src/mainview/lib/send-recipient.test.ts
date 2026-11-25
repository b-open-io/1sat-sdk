import { describe, expect, test } from 'bun:test'
import { isValidRecipient, sendTarget } from './send-recipient'

const ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'

describe('send recipient routing', () => {
	test('a Base58 address is sent as address', () => {
		expect(sendTarget(` ${ADDRESS} `)).toEqual({ address: ADDRESS })
	})

	test('@handle@domain, handle@domain and +tag forms are sent as handle', () => {
		for (const h of [
			'@deggen@lkup.net',
			'deggen@lkup.net',
			'@deggen+conf2036@lkup.net',
			'alice@paymail.example',
		]) {
			expect(isValidRecipient(h)).toBe(true)
			expect(sendTarget(h)).toEqual({ handle: h })
		}
	})

	test('anything else is not a valid recipient', () => {
		for (const v of ['', 'deggen', '@deggen', 'deggen@lkup', '1notAnAddress']) {
			expect(isValidRecipient(v)).toBe(false)
		}
	})
})

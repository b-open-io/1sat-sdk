import { describe, expect, it } from 'bun:test'
import {
	CWI_EVENT_NAMES,
	CWIEventName,
	isCWIEventName,
} from '../../src/cwi/types'

describe('CWIEventName allowlist', () => {
	it('CWI_EVENT_NAMES contains every enum value', () => {
		expect(CWI_EVENT_NAMES.size).toBe(Object.values(CWIEventName).length)
		for (const v of Object.values(CWIEventName)) {
			expect(CWI_EVENT_NAMES.has(v)).toBe(true)
		}
	})

	it('isCWIEventName returns true for valid names', () => {
		expect(isCWIEventName('listOutputs')).toBe(true)
		expect(isCWIEventName('createAction')).toBe(true)
	})

	it('isCWIEventName returns false for invalid names', () => {
		expect(isCWIEventName('MASTER_BACKUP')).toBe(false)
		expect(isCWIEventName('storageAddRemote')).toBe(false)
		expect(isCWIEventName('')).toBe(false)
		expect(isCWIEventName(null as unknown as string)).toBe(false)
		expect(isCWIEventName(undefined as unknown as string)).toBe(false)
		expect(isCWIEventName(42 as unknown as string)).toBe(false)
	})
})

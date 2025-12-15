/**
 * MAP (Magic Attribute Protocol) for 1Sat Ordinals
 *
 * Builds and parses MAP metadata in OP_RETURN scripts
 */

import { MAP_PREFIX } from '@1sat/constants'
import type { MAP } from '@1sat/types'
import { Script, Utils } from '@bsv/sdk'

const { toArray, toHex } = Utils

/** Convert UTF-8 string to hex */
const utf8ToHex = (str: string): string => toHex(toArray(str, 'utf8'))

/**
 * Build MAP metadata ASM for appending to a script
 * @param metaData - MAP metadata object (app and type are required)
 * @returns ASM string for MAP metadata (including OP_RETURN)
 */
export function buildMapAsm(metaData: MAP): string {
	if (!metaData.app || !metaData.type) {
		throw new Error('MAP.app and MAP.type are required fields')
	}

	const mapPrefixHex = utf8ToHex(MAP_PREFIX)
	const mapCmdValue = utf8ToHex('SET')

	let asm = `OP_RETURN ${mapPrefixHex} ${mapCmdValue}`

	for (const [key, value] of Object.entries(metaData)) {
		if (key !== 'cmd' && value !== undefined) {
			asm = `${asm} ${utf8ToHex(key)} ${utf8ToHex(value)}`
		}
	}

	return asm
}

/**
 * Build MAP metadata script
 * @param metaData - MAP metadata object
 * @returns Script containing OP_RETURN with MAP data
 */
export function buildMapScript(metaData: MAP): Script {
	return Script.fromASM(buildMapAsm(metaData))
}

/**
 * Append MAP metadata to an existing script
 * @param script - Base script to append to
 * @param metaData - MAP metadata object
 * @returns New script with MAP metadata appended
 */
export function appendMapToScript(script: Script, metaData: MAP): Script {
	const baseAsm = script.toASM()
	const mapAsm = buildMapAsm(metaData)
	return Script.fromASM(`${baseAsm} ${mapAsm}`)
}

/**
 * Create a basic MAP metadata object
 * @param app - Application identifier
 * @param type - Content type
 * @param additionalFields - Additional key-value pairs
 * @returns MAP metadata object
 */
export function createMap(
	app: string,
	type: string,
	additionalFields?: Record<string, string>,
): MAP {
	return {
		app,
		type,
		...additionalFields,
	}
}

/**
 * Validate MAP metadata has required fields
 * @param metaData - MAP metadata to validate
 * @returns True if valid
 */
export function isValidMap(metaData: unknown): metaData is MAP {
	if (typeof metaData !== 'object' || metaData === null) {
		return false
	}
	const map = metaData as Record<string, unknown>
	return typeof map.app === 'string' && typeof map.type === 'string'
}

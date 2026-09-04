import { MAP } from '@1sat/templates'
import { Script } from '@bsv/sdk'

/**
 * Append MAP without round-tripping its OP_RETURN tape through script chunks.
 *
 * The SDK parser may fold bytes following a data-bearing OP_RETURN into one
 * chunk. Copying those chunks into another script can then drop the opcode.
 * Concatenating the serialized scripts preserves the protocol boundary.
 */
export function appendMapSuffix(
	base: Script,
	map?: Record<string, string>,
): Script {
	if (!map || Object.keys(map).length === 0) {
		return Script.fromBinary(base.toBinary())
	}
	return Script.fromBinary([...base.toBinary(), ...MAP.set(map).toBinary()])
}

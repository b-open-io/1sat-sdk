/**
 * Rúnar artifact types.
 *
 * Mirror of `runar-ir-schema` 1.0.0-rc.1 (`src/artifact.ts`, runar commit
 * b3f08f2), reduced to the fields a stateless contract consumer needs. The
 * published `runar-ir-schema` on npm is still 0.4.6 (a different artifact
 * generation); once 1.0 is published, replace this file with
 * `export type { ... } from 'runar-ir-schema'`.
 */

export interface RunarABIParam {
	name: string
	type: string
}

export interface RunarABIConstructor {
	params: RunarABIParam[]
}

export interface RunarABIMethod {
	name: string
	params: RunarABIParam[]
	isPublic: boolean
	/** BIP-143 sighash type from a `@sighash` directive; absent = ALL|FORKID (0x41). */
	sigHashType?: number
}

export interface RunarABI {
	constructor: RunarABIConstructor
	methods: RunarABIMethod[]
}

export interface RunarConstructorSlot {
	/** Index into `abi.constructor.params`. */
	paramIndex: number
	/** Byte offset of the 1-byte OP_0 placeholder in the template script. */
	byteOffset: number
}

export interface RunarArtifact {
	/** Schema version, e.g. "runar-v0.1.0" */
	version: string
	/** Semver of the compiler that produced this artifact */
	compilerVersion: string
	/** Name of the compiled contract */
	contractName: string
	parentClass?:
		| 'SmartContract'
		| 'StatefulSmartContract'
		| 'UnsafeSmartContract'
	/** Public ABI (constructor + methods) */
	abi: RunarABI
	/** Hex-encoded locking script template (OP_0 placeholders at constructor slots) */
	script: string
	/** Human-readable assembly (space-separated opcodes) */
	asm: string
	/** Byte offsets of constructor parameter placeholders in the script */
	constructorSlots?: RunarConstructorSlot[]
	/** Byte offset of OP_CODESEPARATOR in the locking script (for BIP-143 sighash) */
	codeSeparatorIndex?: number
	/** Per-method OP_CODESEPARATOR byte offsets */
	codeSeparatorIndices?: number[]
	/** ISO-8601 build timestamp */
	buildTimestamp: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null
}

function isParam(v: unknown): v is RunarABIParam {
	return isRecord(v) && typeof v.name === 'string' && typeof v.type === 'string'
}

function isSlot(v: unknown): v is RunarConstructorSlot {
	return (
		isRecord(v) &&
		Number.isInteger(v.paramIndex) &&
		Number.isInteger(v.byteOffset)
	)
}

/**
 * Validates a JSON value as a Rúnar artifact and returns it typed. Throws with
 * the offending field on malformed input. Use this on any artifact file the
 * compiler emitted before consuming it; it never rewrites or normalizes the
 * artifact.
 */
export function parseRunarArtifact(json: unknown): RunarArtifact {
	if (!isRecord(json)) throw invalid('not an object')
	for (const k of [
		'version',
		'compilerVersion',
		'contractName',
		'asm',
		'buildTimestamp',
	]) {
		if (typeof json[k] !== 'string') throw invalid(`${k} must be a string`)
	}
	if (
		typeof json.script !== 'string' ||
		!/^([0-9a-f]{2})*$/i.test(json.script)
	) {
		throw invalid('script must be a hex string')
	}
	if (
		json.parentClass !== undefined &&
		!PARENT_CLASSES.includes(json.parentClass as string)
	) {
		throw invalid('unknown parentClass')
	}
	const abi = json.abi
	if (!isRecord(abi)) throw invalid('abi missing')
	const ctor = abi.constructor
	if (
		!isRecord(ctor) ||
		!Array.isArray(ctor.params) ||
		!ctor.params.every(isParam)
	) {
		throw invalid('abi.constructor.params malformed')
	}
	if (!Array.isArray(abi.methods) || !abi.methods.every(isMethod)) {
		throw invalid('abi.methods malformed')
	}
	if (
		json.constructorSlots !== undefined &&
		(!Array.isArray(json.constructorSlots) ||
			!json.constructorSlots.every(isSlot))
	) {
		throw invalid('constructorSlots malformed')
	}
	if (
		json.codeSeparatorIndex !== undefined &&
		!Number.isInteger(json.codeSeparatorIndex)
	) {
		throw invalid('codeSeparatorIndex must be an integer')
	}
	return json as unknown as RunarArtifact
}

const PARENT_CLASSES = [
	'SmartContract',
	'StatefulSmartContract',
	'UnsafeSmartContract',
]

function invalid(what: string): Error {
	return new Error(`Invalid Rúnar artifact: ${what}`)
}

function isMethod(v: unknown): v is RunarABIMethod {
	return (
		isRecord(v) &&
		typeof v.name === 'string' &&
		typeof v.isPublic === 'boolean' &&
		Array.isArray(v.params) &&
		v.params.every(isParam)
	)
}

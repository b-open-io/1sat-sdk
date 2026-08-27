// @ts-nocheck — generated proto files lack TS project references

import type { AtomicBeef, Beef, BeefTx } from './beef_pb.js'
import { encodeAtomicBeef } from './beef_pb.js'
import type { BeefParseResult, IndexedOutput, OutPoint } from './parse_pb.js'
import { decodeBeefParseResult } from './parse_pb.js'

export type {
	AtomicBeef,
	Beef,
	BeefParseResult,
	BeefTx,
	IndexedOutput,
	OutPoint,
}
export { decodeBeefParseResult, encodeAtomicBeef }

export class Engine {
	private instance: WebAssembly.Instance | null = null

	constructor(private wasmBytes: ArrayBuffer) {}

	async init(): Promise<void> {
		const { instance } = await WebAssembly.instantiate(this.wasmBytes)
		this.instance = instance
	}

	parseAtomicBeef(protoBytes: Uint8Array): BeefParseResult {
		if (!this.instance) throw new Error('Engine not initialized')

		const { alloc, dealloc, parse_atomic_beef, memory } = this.instance
			.exports as {
			alloc: (len: number) => number
			dealloc: () => void
			parse_atomic_beef: (ptr: number, len: number) => number
			memory: WebAssembly.Memory
		}

		try {
			const ptr = alloc(protoBytes.length)
			if (ptr === 0) throw new Error('alloc returned null')

			new Uint8Array(memory.buffer).set(protoBytes, ptr)

			const resultPtr = parse_atomic_beef(ptr, protoBytes.length)
			if (resultPtr === 0) throw new Error('parse returned null')

			const lenView = new DataView(memory.buffer, resultPtr, 4)
			const pbLen = lenView.getUint32(0, true)

			const pbBytes = new Uint8Array(
				memory.buffer,
				resultPtr + 4,
				pbLen,
			).slice()

			return decodeBeefParseResult(pbBytes)
		} finally {
			dealloc()
		}
	}
}

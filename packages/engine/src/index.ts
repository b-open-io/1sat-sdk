import { onesat } from "./proto.js";

const { AtomicBeef, Beef, BeefTx, MerklePath, PathLevel, PathElement } =
	onesat.beef;
const { BeefParseResult } = onesat.parse;

export type { onesat };

export interface ParseResult {
	txid: Uint8Array;
	blockHeight: number;
	blockIdx: number;
	outputs: onesat.parse.IIndexedOutput[];
	spends: onesat.parse.IIndexedOutput[];
}

export class Engine {
	private instance: WebAssembly.Instance | null = null;

	constructor(private wasmBytes: ArrayBuffer) {}

	async init(): Promise<void> {
		const { instance } = await WebAssembly.instantiate(this.wasmBytes);
		this.instance = instance;
	}

	parseAtomicBeef(protoBytes: Uint8Array): ParseResult {
		if (!this.instance) throw new Error("Engine not initialized");

		const { alloc, dealloc, parse_atomic_beef, memory } =
			this.instance.exports as {
				alloc: (len: number) => number;
				dealloc: () => void;
				parse_atomic_beef: (ptr: number, len: number) => number;
				memory: WebAssembly.Memory;
			};

		try {
			const ptr = alloc(protoBytes.length);
			if (ptr === 0) throw new Error("alloc returned null");

			new Uint8Array(memory.buffer).set(protoBytes, ptr);

			const resultPtr = parse_atomic_beef(ptr, protoBytes.length);
			if (resultPtr === 0) throw new Error("parse returned null");

			const mem = new Uint8Array(memory.buffer);
			const lenView = new DataView(memory.buffer, resultPtr, 4);
			const pbLen = lenView.getUint32(0, true);

			const pbBytes = mem.slice(resultPtr + 4, resultPtr + 4 + pbLen);
			const result = BeefParseResult.decode(pbBytes);

			return {
				txid: result.txid ?? new Uint8Array(),
				blockHeight: result.blockHeight ?? 0,
				blockIdx: Number(result.blockIdx ?? 0),
				outputs: result.outputs ?? [],
				spends: result.spends ?? [],
			};
		} finally {
			dealloc();
		}
	}
}

export { AtomicBeef, Beef, BeefTx, MerklePath, PathLevel, PathElement };
export { BeefParseResult };
export { onesat as proto };

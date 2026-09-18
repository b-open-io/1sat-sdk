import {
	init,
	xd3_decode_memory,
	xd3_encode_memory,
	xd3_smatch_cfg,
} from 'xdelta3-wasm'

/**
 * RFC 3284 VCDIFF encode/decode via xdelta3-wasm.
 *
 * On-chain profile (must match xdelta3 CLI ` -e -n -S none -A `):
 *   header D6 C3 C4 00, Hdr_Indicator 0 (no secondary compression,
 *   no custom code table, no app header). Decoders reject anything else.
 */

export class VcdiffError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'VcdiffError'
	}
}

const ENOSPC = 51
const PLAIN_MAX_GROW = 8

let ready: Promise<void> | undefined

export function vcdiffReady(): Promise<void> {
	if (!ready) ready = init()
	return ready
}

function assertPlainRfc(delta: Uint8Array): void {
	if (delta.length < 5) {
		throw new VcdiffError('vcdiff delta too short')
	}
	if (delta[0] !== 0xd6 || delta[1] !== 0xc3 || delta[2] !== 0xc4) {
		throw new VcdiffError('bad vcdiff magic')
	}
	if (delta[3] !== 0x00) {
		throw new VcdiffError(`unsupported vcdiff version ${delta[3]}`)
	}
	if (delta[4] !== 0x00) {
		throw new VcdiffError(
			`vcdiff Hdr_Indicator ${delta[4]} must be 0 (no secondary compression, no app header)`,
		)
	}
}

export async function vcdiffEncode(
	target: Uint8Array,
	source: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
	await vcdiffReady()
	let max = Math.max(64, target.length + 1024)
	for (let i = 0; i < PLAIN_MAX_GROW; i++) {
		const r = xd3_encode_memory(target, source, max, xd3_smatch_cfg.DEFAULT)
		if (r.ret === 0) {
			assertPlainRfc(r.output)
			return r.output
		}
		if (r.ret === ENOSPC) {
			max *= 2
			continue
		}
		throw new VcdiffError(`vcdiff encode failed: ${r.str} (${r.ret})`)
	}
	throw new VcdiffError('vcdiff encode failed: output too large')
}

export async function vcdiffDecode(
	delta: Uint8Array,
	source: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
	await vcdiffReady()
	assertPlainRfc(delta)
	let max = Math.max(source.length * 2, 1 << 20)
	for (let i = 0; i < PLAIN_MAX_GROW; i++) {
		const r = xd3_decode_memory(delta, source, max)
		if (r.ret === 0) return r.output
		if (r.ret === ENOSPC) {
			max *= 2
			continue
		}
		throw new VcdiffError(`vcdiff decode failed: ${r.str} (${r.ret})`)
	}
	throw new VcdiffError('vcdiff decode failed: output too large')
}

import {
	Indexer,
	type ParseContext,
	type ParseResult,
	type Txo,
} from '@1sat/types'
import { BSM, BigNumber, Hash, OP, Script, Signature, Utils } from '@bsv/sdk'

export interface Sigma {
	algorithm: string
	address: string
	signature: number[]
	vin: number
	valid: boolean
}

export class SigmaIndexer extends Indexer {
	tag = 'sigma'
	name = 'Sigma'

	constructor(
		public owners = new Set<string>(),
		public network: 'mainnet' | 'testnet' = 'mainnet',
	) {
		super(owners, network)
	}

	/**
	 * Parse extracts raw sigma protocol data without validation.
	 * Validation requires ctx.spends and is done in summarize().
	 */
	async parse(txo: Txo): Promise<ParseResult | undefined> {
		const script = txo.output.lockingScript
		const vout = txo.outpoint.vout
		let retPos = 0
		const sigmas: Sigma[] = []

		for (let i = retPos + 1; i < script.chunks.length; i++) {
			const chunk = script.chunks[i]
			if (!retPos && chunk.op === OP.OP_RETURN) {
				retPos = i
				continue
			}
			if (!retPos || chunk.data?.length !== 1 || chunk.data[0] !== 0x7c) {
				continue
			}

			if (Utils.toUTF8(script.chunks[++i]?.data || []) !== 'SIGMA') {
				continue
			}

			const sigma: Sigma = {
				algorithm: script.chunks[++i]?.data
					? Utils.toUTF8(script.chunks[i].data || [])
					: '',
				address: script.chunks[++i]?.data
					? Utils.toUTF8(script.chunks[i].data || [])
					: '',
				signature: script.chunks[++i]?.data || [],
				vin: script.chunks[++i]?.data
					? Number.parseInt(Utils.toUTF8(script.chunks[i].data || []))
					: -1,
				valid: false, // Will be validated in summarize()
			}

			// Use vout as default vin if not specified
			if (sigma.vin === -1) sigma.vin = vout

			sigmas.push(sigma)
		}

		if (!sigmas.length) return

		return { data: sigmas, tags: [] }
	}

	/**
	 * Validate all sigma signatures against ctx.spends.
	 */
	async summarize(
		ctx: ParseContext,
		_isBroadcasted: boolean,
	): Promise<undefined> {
		for (const txo of ctx.txos) {
			const sigmaData = txo.data[this.tag]
			if (!sigmaData) continue

			const sigmas = sigmaData.data as Sigma[]
			const script = txo.output.lockingScript

			for (const sigma of sigmas) {
				// Find the dataPos by re-scanning for this sigma
				const dataPos = this.findSigmaDataPos(script, sigma)
				if (dataPos === -1) continue

				// Get the spend for this sigma's vin
				const spend = ctx.spends[sigma.vin]
				if (!spend) continue

				const bw = new Utils.Writer()
				bw.write(Utils.toArray(spend.outpoint.txid, 'hex'))
				bw.writeUInt32LE(spend.outpoint.vout)
				const inputHash = Hash.sha256(bw.toArray())

				const dataScript = new Script()
				dataScript.chunks = script.chunks.slice(0, dataPos)
				const outputHash = Hash.sha256(dataScript.toBinary())
				const msgHash = Hash.sha256(inputHash.concat(outputHash))

				const signature = Signature.fromCompact(sigma.signature)
				for (let recovery = 0; recovery < 4; recovery++) {
					try {
						const publicKey = signature.RecoverPublicKey(
							recovery,
							new BigNumber(BSM.magicHash(msgHash)),
						)
						const sigFitsPubkey = BSM.verify(msgHash, signature, publicKey)
						const pubkeyAddress = publicKey.toAddress(
							this.network === 'mainnet' ? 'mainnet' : 'testnet',
						)
						if (sigFitsPubkey && pubkeyAddress === sigma.address) {
							sigma.valid = true
							break
						}
					} catch {
						// try next recovery
					}
				}
			}
		}

		return undefined
	}

	/**
	 * Find the data position for a sigma in the script (position before the pipe separator).
	 */
	private findSigmaDataPos(script: Script, targetSigma: Sigma): number {
		let retPos = 0

		for (let i = 1; i < script.chunks.length; i++) {
			const chunk = script.chunks[i]
			if (!retPos && chunk.op === OP.OP_RETURN) {
				retPos = i
				continue
			}
			if (!retPos || chunk.data?.length !== 1 || chunk.data[0] !== 0x7c) {
				continue
			}

			if (Utils.toUTF8(script.chunks[i + 1]?.data || []) !== 'SIGMA') {
				continue
			}

			const dataPos = i

			// Check if this is the target sigma by comparing address and signature
			const address = script.chunks[i + 3]?.data
				? Utils.toUTF8(script.chunks[i + 3].data || [])
				: ''
			const sig = script.chunks[i + 4]?.data || []

			if (
				address === targetSigma.address &&
				sig.length === targetSigma.signature.length &&
				sig.every((b, idx) => b === targetSigma.signature[idx])
			) {
				return dataPos
			}
		}

		return -1
	}
}

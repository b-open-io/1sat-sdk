/**
 * Authoritative BSV-21 CI stamp — shared by local apply and module embellish.
 *
 * For each output that already has CI and a BSV-21 locking script:
 * - Start from caller CI (keep derivation / extras)
 * - Overwrite load-bearing fields from script + spent-input carry
 * - Preserve encryption state: plaintext in → plaintext out; ciphertext in →
 *   peel → merge → re-encrypt (WPM encrypts before module onRequest)
 */

import { BSV21_BASKET, parseInputAssetLabels } from '@1sat/types'
import { BSV21 } from '@1sat/templates'
import {
	type CreateActionArgs,
	Script,
	type WalletInterface,
} from '@bsv/sdk'
import {
	bsv21FieldsFromOutput,
	overwriteBsv21CiFields,
	type Bsv21RemittanceFields,
} from './bsv21Remittance'
import { loadBasketOutput } from './loadBasketOutput'
import {
	encryptWalletMetadataCi,
	ensurePlaintextCi,
	looksLikeJson,
} from './walletMetadataCi'

async function carryFieldsFromInputs(
	wallet: WalletInterface,
	labels: string[] | undefined,
): Promise<Map<string, Partial<Bsv21RemittanceFields>>> {
	const out = new Map<string, Partial<Bsv21RemittanceFields>>()
	const refs = parseInputAssetLabels(labels ?? []).filter(
		(r) => r.basket === BSV21_BASKET,
	)
	for (const ref of refs) {
		const loaded = await loadBasketOutput(wallet, BSV21_BASKET, ref.id)
		if ('error' in loaded) continue
		const f = bsv21FieldsFromOutput({
			tags: loaded.output.tags,
			customInstructions: loaded.output.customInstructions,
			outpoint: loaded.output.outpoint,
		})
		if (!f.tokenId) continue
		out.set(f.tokenId, {
			...(f.tokenId && { id: f.tokenId }),
			...(f.sym && { sym: f.sym }),
			...(f.dec && { dec: f.dec }),
			...(f.icon && { icon: f.icon }),
		})
	}
	return out
}

/**
 * Overwrite BSV-21 token fields on output CI from script + input carry.
 * Call from {@link applyP1SatCreateAction} so local and module paths share it.
 */
export async function stampBsv21OutputCustomInstructions(
	wallet: WalletInterface,
	args: CreateActionArgs,
): Promise<void> {
	const outputs = args.outputs
	if (!outputs?.length) return

	const carry = await carryFieldsFromInputs(wallet, args.labels)

	for (const out of outputs) {
		const raw = out.customInstructions
		if (!raw || !out.lockingScript) continue

		let script: Script
		try {
			script = Script.fromHex(out.lockingScript)
		} catch {
			continue
		}
		const decoded = BSV21.decode(script)
		if (!decoded) continue

		const td = decoded.tokenData
		const tokenId = typeof td.id === 'string' ? td.id : undefined
		const fromInput = tokenId ? carry.get(tokenId) : undefined

		const auth: Partial<Bsv21RemittanceFields> = {
			...(tokenId && { id: tokenId }),
			...(td.amt != null && td.amt !== '' && { amt: String(td.amt) }),
			...(td.op && { op: td.op }),
			...(td.sym && { sym: td.sym }),
			...(td.dec !== undefined && td.dec !== null && { dec: td.dec }),
			...(td.icon && { icon: td.icon }),
		}
		if (!auth.sym && fromInput?.sym) auth.sym = fromInput.sym
		if (auth.dec === undefined && fromInput?.dec !== undefined) {
			auth.dec = fromInput.dec
		}
		if (!auth.icon && fromInput?.icon) auth.icon = fromInput.icon

		const wasEncrypted = !looksLikeJson(raw)
		const plain = await ensurePlaintextCi(wallet, raw)
		if (!plain || !looksLikeJson(plain)) continue

		const merged = overwriteBsv21CiFields(plain, auth)
		out.customInstructions = wasEncrypted
			? await encryptWalletMetadataCi(wallet, merged)
			: merged
	}
}

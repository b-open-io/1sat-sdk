/**
 * Temporary harness controls to open burn-style BSV21 permission cards.
 * Reject the prompts — do not approve (no broadcast intended).
 */
import { BSV21 } from '@1sat/templates'
import {
	BSV21_BASKET,
	P1SAT_LABEL,
	P1SAT_PROTOCOL,
	buildInputAssetLabel,
	readAssetIdTag,
} from '@1sat/types'
import { P2PKH, PublicKey, type CreateActionArgs } from '@bsv/sdk'
import { useState } from 'react'
import { useLog } from './LogContext'
import { button, buttonDisabled, card, errorText, heading } from './styles'
import { useActionFlags } from './useActionFlags'
import { useOneSatContext } from './useActions'

function tag(tags: string[] | undefined, key: string): string | undefined {
	return tags?.find((t) => t.startsWith(`${key}:`))?.slice(key.length + 1)
}

export function BurnPromptTest() {
	const ctx = useOneSatContext()
	const flags = useActionFlags()
	const { log } = useLog()
	const [busy, setBusy] = useState<'remainder' | 'badmath' | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function run(mode: 'remainder' | 'badmath') {
		if (!ctx || busy) return
		setBusy(mode)
		setError(null)
		log('info', `burn-test: ${mode}`)

		try {
			// Prefer plain basket; fall back to legacy p-basket until migrated
			const baskets = [BSV21_BASKET, 'p 1sat bsv21']
			let list: Awaited<ReturnType<typeof ctx.wallet.listOutputs>> | null =
				null
			let sourceBasket = BSV21_BASKET
			let utxo:
				| NonNullable<
						Awaited<ReturnType<typeof ctx.wallet.listOutputs>>
				  >['outputs'][0]
				| undefined
			for (const basket of baskets) {
				try {
					list = await ctx.wallet.listOutputs({
						basket,
						includeTags: true,
						includeCustomInstructions: true,
						include: 'entire transactions',
						limit: 50,
					})
					utxo = list.outputs.find((o) => {
						const a = tag(o.tags, 'amt')
						return a && BigInt(a) >= 2n
					})
					if (utxo) {
						sourceBasket = basket
						break
					}
				} catch {
					/* basket missing or denied */
				}
			}
			if (!list || !utxo) throw new Error('no bsv21 utxo with amt >= 2')

			const tokenId =
				tag(utxo.tags, 'bsv21') ??
				(() => {
					throw new Error('missing bsv21 tag')
				})()
			const inAmt = BigInt(tag(utxo.tags, 'amt')!)
			const half = inAmt / 2n
			const outAmt = mode === 'remainder' ? half : inAmt * 2n // half = burn rest; 2x = bad math

			const keyID = `burn-test-${Date.now()}`
			const { publicKey } = await ctx.wallet.getPublicKey({
				protocolID: P1SAT_PROTOCOL,
				keyID,
				counterparty: 'self',
				forSelf: true,
			})
			const addr = PublicKey.fromString(publicKey).toAddress()
			const lock = new P2PKH().lock(addr)
			const script = BSV21.transfer(tokenId, outAmt).lock(lock)

			const id = readAssetIdTag(utxo.tags)
			const labels = [
				...(flags.useOneSatModule
					? [
							sourceBasket === 'bsv21'
								? 'p bsv21 action'
								: P1SAT_LABEL,
						]
					: []),
				...(id ? [buildInputAssetLabel(sourceBasket, id)] : []),
			]

			const args: CreateActionArgs = {
				description: `Burn test ${mode}`.slice(0, 50),
				inputBEEF: list.BEEF,
				labels,
				inputs: [
					{
						outpoint: utxo.outpoint,
						inputDescription: 'token spend',
						unlockingScriptLength: 108,
					},
				],
				outputs: [
					{
						lockingScript: script.toHex(),
						satoshis: 1,
						outputDescription:
							mode === 'remainder' ? 'partial re-issue' : 'over-issue',
						// Self-keep so we don't need an external address; conservation still applies.
						basket: BSV21_BASKET,
						tags: [
							`bsv21:${tokenId}`,
							`amt:${outAmt}`,
							...(tag(utxo.tags, 'dec') ? [`dec:${tag(utxo.tags, 'dec')}`] : []),
							...(tag(utxo.tags, 'sym') ? [`sym:${tag(utxo.tags, 'sym')}`] : []),
						],
						customInstructions: JSON.stringify({
							protocolID: P1SAT_PROTOCOL,
							keyID,
							counterparty: 'self',
							...(tag(utxo.tags, 'sym')
								? { sym: tag(utxo.tags, 'sym') }
								: {}),
						}),
					},
				],
				options: { randomizeOutputs: false, signAndProcess: false },
			}

			// Expect user reject → permission module throws
			await ctx.wallet.createAction(args)
			log('info', 'burn-test: approved (unexpected for this harness)')
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e)
			if (msg.includes('rejected')) {
				log('info', `burn-test ${mode}: rejected (ok)`)
			} else {
				setError(msg)
				log('error', `burn-test ${mode}: ${msg}`)
			}
		} finally {
			setBusy(null)
		}
	}

	const disabled = !ctx || busy !== null

	return (
		<div style={card}>
			<div style={heading}>Burn prompt test (reject only)</div>
			<p style={{ color: '#888', fontSize: '0.75rem', margin: '0 0 0.75rem' }}>
				Opens a 1Sat permission card. Reject — do not approve.
			</p>
			<button
				type="button"
				style={disabled ? buttonDisabled : button}
				disabled={disabled}
				onClick={() => void run('remainder')}
			>
				{busy === 'remainder'
					? '…'
					: 'Burn remainder (inputs > outputs)'}
			</button>
			<button
				type="button"
				style={{
					...(disabled ? buttonDisabled : button),
					marginTop: 8,
				}}
				disabled={disabled}
				onClick={() => void run('badmath')}
			>
				{busy === 'badmath' ? '…' : 'Bad math burn-all (outputs > inputs)'}
			</button>
			{error && <div style={errorText}>{error}</div>}
		</div>
	)
}

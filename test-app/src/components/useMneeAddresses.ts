import {
	DEFAULT_DEPOSIT_PREFIX,
	type KeyDerivation,
	LEGACY_ONESAT_PROTOCOL,
	ONESAT_PROTOCOL,
	type OneSatContext,
	deriveDepositAddresses,
	getMneeBalance,
} from '@1sat/actions'
import { useEffect, useState } from 'react'
import { useOneSatContext } from './useActions'

const MNEE_PROTOCOLS = [ONESAT_PROTOCOL, LEGACY_ONESAT_PROTOCOL] as const
const MNEE_GAP_LIMIT = 20
const MNEE_MAX_GAP_SCANS = 10
const DEFAULT_MAX_KEY_INDEX = 4

export function mneeKeyDerivations(
	startIndex: number,
	count: number,
): KeyDerivation[] {
	return MNEE_PROTOCOLS.flatMap((protocolID) =>
		Array.from({ length: count }, (_, i) => ({
			protocolID,
			keyID: `${DEFAULT_DEPOSIT_PREFIX} ${startIndex + i}`,
		})),
	)
}

async function discoverMneeMaxKeyIndex(
	ctx: OneSatContext,
	knownMaxKeyIndex: number,
): Promise<number> {
	let maxKeyIndex = knownMaxKeyIndex
	let scanStart = knownMaxKeyIndex + 1

	for (let scan = 0; scan < MNEE_MAX_GAP_SCANS; scan++) {
		const fundedIndices: number[] = []
		for (const protocolID of MNEE_PROTOCOLS) {
			const { derivations } = await deriveDepositAddresses.execute(ctx, {
				startIndex: scanStart,
				count: MNEE_GAP_LIMIT,
				protocolID,
			})
			const batchAddresses = derivations.map((d) => d.address)
			const res = await getMneeBalance.execute(ctx, {
				addresses: batchAddresses,
			})
			for (const b of res.balances ?? []) {
				if (b.decimalAmount <= 0) continue
				const i = batchAddresses.indexOf(b.address)
				if (i >= 0) fundedIndices.push(scanStart + i)
			}
		}
		if (fundedIndices.length === 0) break
		maxKeyIndex = Math.max(maxKeyIndex, ...fundedIndices)
		scanStart += MNEE_GAP_LIMIT
	}

	return maxKeyIndex
}

type Loaded = { addresses: string[]; derivations: KeyDerivation[] }

let inflight: { ctx: OneSatContext; promise: Promise<Loaded> } | null = null

function loadMneeAddresses(ctx: OneSatContext): Promise<Loaded> {
	if (inflight?.ctx === ctx) return inflight.promise
	const promise = (async (): Promise<Loaded> => {
		const maxKeyIndex = await discoverMneeMaxKeyIndex(
			ctx,
			DEFAULT_MAX_KEY_INDEX,
		)
		const nextDerivations = mneeKeyDerivations(0, maxKeyIndex + 1)
		const results = await Promise.all(
			MNEE_PROTOCOLS.map((protocolID) =>
				deriveDepositAddresses.execute(ctx, {
					startIndex: 0,
					count: maxKeyIndex + 1,
					protocolID,
				}),
			),
		)
		return {
			derivations: nextDerivations,
			addresses: results.flatMap((r) => r.derivations.map((d) => d.address)),
		}
	})()
	inflight = { ctx, promise }
	return promise
}

export function useMneeAddresses() {
	const ctx = useOneSatContext()
	const [addresses, setAddresses] = useState<string[]>([])
	const [derivations, setDerivations] = useState<KeyDerivation[]>([])

	useEffect(() => {
		if (!ctx) {
			setAddresses([])
			setDerivations([])
			return
		}
		setDerivations(mneeKeyDerivations(0, DEFAULT_MAX_KEY_INDEX + 1))
		let cancelled = false
		loadMneeAddresses(ctx)
			.then((loaded) => {
				if (cancelled) return
				setDerivations(loaded.derivations)
				setAddresses(loaded.addresses)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [ctx])

	return { addresses, derivations }
}

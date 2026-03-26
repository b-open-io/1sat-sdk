import {
	createContext,
	prepareSweepInputs,
	sweepBsv,
	sweepOrdinals,
	sweepBsv21,
} from "@1sat/actions";
import type { IndexedOutput } from "@1sat/types";
import { PrivateKey, type WalletInterface } from "@bsv/sdk";
import { getServices } from "./services";

export interface SweepResult {
	bsvTxid?: string;
	ordinalTxids: string[];
	bsv21Txids: string[];
	errors: string[];
}

function getOwner(output: IndexedOutput): string | undefined {
	return output.events?.find((e) => e.startsWith("own:"))?.slice(4);
}

function buildKeys(outputs: IndexedOutput[], keyMap: Map<string, PrivateKey>): PrivateKey[] {
	return outputs.map((output) => {
		const owner = getOwner(output);
		const key = owner ? keyMap.get(owner) : undefined;
		if (!key) throw new Error(`No key for output ${output.outpoint} (owner: ${owner})`);
		return key;
	});
}

export async function executeSweep(params: {
	wallet: WalletInterface;
	keys: Map<string, PrivateKey>;
	funding: IndexedOutput[];
	ordinals: IndexedOutput[];
	bsv21Tokens: IndexedOutput[];
	amount?: number;
	onProgress: (stage: string) => void;
}): Promise<SweepResult> {
	const { wallet, keys, funding, ordinals, bsv21Tokens, amount, onProgress } = params;
	const ctx = createContext(wallet, { services: getServices(), chain: "main" });

	const result: SweepResult = {
		ordinalTxids: [],
		bsv21Txids: [],
		errors: [],
	};

	if (funding.length > 0) {
		onProgress(`Sweeping ${funding.length} BSV UTXOs...`);
		try {
			const inputs = await prepareSweepInputs(ctx, funding);
			const bsvResult = await sweepBsv.execute(ctx, { inputs, keys: buildKeys(funding, keys), amount });
			if (bsvResult.error) result.errors.push(`BSV: ${bsvResult.error}`);
			else if (bsvResult.txid) result.bsvTxid = bsvResult.txid;
		} catch (e) {
			result.errors.push(`BSV: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	if (ordinals.length > 0) {
		onProgress(`Sweeping ${ordinals.length} ordinals...`);
		try {
			const inputs = await prepareSweepInputs(ctx, ordinals);
			const ordResult = await sweepOrdinals.execute(ctx, { inputs, keys: buildKeys(ordinals, keys) });
			if (ordResult.error) result.errors.push(`Ordinals: ${ordResult.error}`);
			else if (ordResult.txid) result.ordinalTxids.push(ordResult.txid);
		} catch (e) {
			result.errors.push(`Ordinals: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	if (bsv21Tokens.length > 0) {
		const groups = new Map<string, IndexedOutput[]>();
		for (const token of bsv21Tokens) {
			const tokenEvent = token.events?.find((e) => e.startsWith("tokenId:"));
			const tokenId = tokenEvent?.slice(8) ?? "unknown";
			const group = groups.get(tokenId) ?? [];
			group.push(token);
			groups.set(tokenId, group);
		}

		for (const [tokenId, tokens] of groups) {
			onProgress(`Sweeping ${tokens.length} tokens (${tokenId.slice(0, 8)}...)...`);
			try {
				const inputs = await prepareSweepInputs(ctx, tokens);
				const tokenResult = await sweepBsv21.execute(ctx, {
					inputs: inputs.map((inp) => ({
						...inp,
						tokenId,
						amount: "0",
					})),
					keys: buildKeys(tokens, keys),
				});
				if (tokenResult.error) result.errors.push(`BSV-21 (${tokenId.slice(0, 8)}): ${tokenResult.error}`);
				else if (tokenResult.txid) result.bsv21Txids.push(tokenResult.txid);
			} catch (e) {
				result.errors.push(`BSV-21 (${tokenId.slice(0, 8)}): ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}

	onProgress("Sweep complete");
	return result;
}

export interface NominatedReq {
	provenTxReqId: number
	txid: string
}

export interface NominateInvalidResult {
	nominated: NominatedReq[]
}

/**
 * Nominate `invalid` proven_tx_reqs for recovery by setting them to
 * `unfail`. Nomination only — wallet-toolbox's scheduled `TaskUnFail`
 * verifies each against the chain, restores the ones that actually mined
 * (transaction back to completed, inputs re-marked spent, outputs
 * activated), and returns the rest to `invalid`.
 *
 * Exists because `invalid` is otherwise terminal: a transaction that the
 * network later mines — a wrongly classified rejection, or a proof that
 * arrived after the give-up limit — stays `failed` forever and its
 * released inputs get re-spent against confirmed history.
 *
 * `windowMsecs` limits nomination to reqs created within the window;
 * omit it to nominate every invalid req (one-time cleanup). The window
 * keys on `created_at`, which is immutable — `updated_at` would never
 * age anything out, because TaskUnFail's bounce back to `invalid`
 * refreshes it every cycle.
 *
 * `storage` accepts either a `WalletStorageManager` or a raw
 * `StorageProvider` — both expose `findProvenTxReqs`; the update goes
 * through `runAsStorageProvider` when present, directly otherwise.
 */
export async function nominateInvalidReqs(
	storage: any,
	windowMsecs?: number,
): Promise<NominateInvalidResult> {
	const cutoff =
		windowMsecs === undefined ? undefined : new Date(Date.now() - windowMsecs)
	const nominated: NominatedReq[] = []
	const limit = 100
	let offset = 0
	for (;;) {
		const reqs = await storage.findProvenTxReqs({
			partial: { status: 'invalid' },
			paged: { limit, offset },
		})
		for (const req of reqs) {
			if (!cutoff || new Date(req.created_at) >= cutoff) {
				nominated.push({ provenTxReqId: req.provenTxReqId, txid: req.txid })
			}
		}
		if (reqs.length < limit) break
		offset += limit
	}
	if (nominated.length > 0) {
		const ids = nominated.map((n) => n.provenTxReqId)
		if (typeof storage.runAsStorageProvider === 'function') {
			await storage.runAsStorageProvider(async (sp: any) => {
				await sp.updateProvenTxReq(ids, { status: 'unfail' })
			})
		} else {
			await storage.updateProvenTxReq(ids, { status: 'unfail' })
		}
	}
	return { nominated }
}

export interface ReviewInvalidTaskOptions {
	/** How often the task runs. Default 1 hour. */
	triggerMsecs?: number
	/** Only reqs created within this window are nominated. Omit for all. */
	windowMsecs?: number
}

/**
 * Builds a plain-object Monitor task around `nominateInvalidReqs` for
 * deployments that want a standing audit. Deliberately wired nowhere by
 * default: automatic healing hides upstream failures (a misclassifying
 * broadcast path would self-repair invisibly instead of surfacing).
 * Prefer the CLI (`1sat storage unfail`) for occasional deliberate runs.
 *
 * Shape-compatible with `WalletMonitorTask` so callers don't import the
 * abstract class from whichever wallet-toolbox variant they use.
 */
export function buildReviewInvalidTask(
	monitor: any,
	storage: any,
	options: ReviewInvalidTaskOptions = {},
): any {
	const triggerMsecs = options.triggerMsecs ?? 60 * 60 * 1000
	return {
		monitor,
		storage: monitor.storage,
		name: 'ReviewInvalid',
		lastRunMsecsSinceEpoch: 0,
		async asyncSetup() {},
		trigger(nowMsecsSinceEpoch: number): { run: boolean } {
			return {
				run: nowMsecsSinceEpoch - this.lastRunMsecsSinceEpoch >= triggerMsecs,
			}
		},
		async runTask(): Promise<string> {
			const { nominated } = await nominateInvalidReqs(
				storage,
				options.windowMsecs,
			)
			if (nominated.length === 0) return 'no invalid reqs nominated'
			return `nominated ${nominated.length} invalid reqs for unfail review`
		},
	}
}

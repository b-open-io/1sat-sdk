import { Lock, OrdLock, Sigma } from '@1sat/templates'
import { type CreateActionArgs, Script } from '@bsv/sdk'

/**
 * Rewrite caller-asserted tags from the locking scripts they describe.
 *
 * `price:` and `until:` are read back off the card *and* persisted to wallet
 * storage, where later prompts re-read them — so a caller that tags one value
 * while committing another poisons both the approval and every future card
 * built from that row. The script is what the chain enforces; the tag has to
 * match it.
 *
 * Driven by what each script decodes as, not by the declared intent, so an
 * OrdLock output is corrected no matter which intent produced it.
 *
 * Mutates `tags` on the existing output objects — the manager shares those by
 * reference, so writes are visible to the caller (unlike `labels`, which it
 * rebuilds).
 */
export function stampScriptDerivedTags(args: CreateActionArgs): void {
	for (const out of args.outputs ?? []) {
		if (!out.lockingScript) continue

		let script: Script
		try {
			script = Script.fromHex(out.lockingScript)
		} catch {
			continue
		}

		const ordLock = OrdLock.decode(script)
		if (ordLock) {
			out.tags = [
				...(out.tags ?? []).filter((t) => !t.startsWith('price:')),
				`price:${ordLock.price}`,
			]
			continue
		}

		const lock = Lock.decode(script)
		if (lock) {
			out.tags = [
				...(out.tags ?? []).filter((t) => !t.startsWith('until:')),
				`until:${lock.until}`,
			]
		}

		const address = Sigma.parseFromScript(script).find(
			(s) => s.address && !/^[\0]+$/.test(s.address),
		)?.address
		if (address) {
			out.tags = [
				...(out.tags ?? []).filter((t) => !t.startsWith('creator:')),
				`creator:${address}`,
			]
		}
	}
}

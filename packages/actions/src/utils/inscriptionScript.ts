import { Inscription, MAP as MAPTemplate } from '@1sat/templates'
import { type LockingScript, Script } from '@bsv/sdk'

/**
 * Compose an inscription envelope script: `envelope(content, contentType)`
 * with `lockingScript` (+ optional MAP metadata) appended as the script
 * suffix — i.e. envelope FIRST, then the P2PKH/MAP suffix.
 *
 * Shared by `inscribe` (new inscriptions) and ordinal transfer
 * (reinscription on spend) so the on-chain composition never drifts between
 * the two paths — indexers depend on this exact shape.
 */
export function buildInscriptionScript(
	lockingScript: LockingScript,
	content: Uint8Array,
	contentType: string,
	map?: Record<string, string>,
): Script {
	const suffix = new Script()
	for (const chunk of lockingScript.chunks) suffix.chunks.push(chunk)
	if (map && Object.keys(map).length > 0) {
		const mapScript = MAPTemplate.set(map)
		for (const chunk of mapScript.chunks) suffix.chunks.push(chunk)
	}

	const inscription = Inscription.create(content, contentType, {
		scriptSuffix: suffix,
	})
	return new Script(inscription.lock().chunks)
}

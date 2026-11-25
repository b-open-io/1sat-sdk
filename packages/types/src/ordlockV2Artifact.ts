import artifact from './contracts/OrdLockV2Batch.json' with { type: 'json' }
import { parseRunarArtifact } from './runar.js'

/**
 * OrdLock v2 compiled artifact, exactly as emitted by the Rúnar compiler.
 *
 * Source: ordlock-v2/runar/OrdLockV2Batch.runar.ts, compiled with the Rúnar Go
 * frontend built from source at commit b3f08f2 (2026-09-08). Canonical copy:
 * ordlock-v2/runar/artifacts/OrdLockV2Batch.head.json. Replace the JSON file
 * only with a fresh compiler output; do not hand-edit it, and do not recompile
 * with the npm `runar-compiler` 0.4.6 (unsound checkPreimage).
 */
export const ORD_LOCK_V2_ARTIFACT = parseRunarArtifact(artifact)

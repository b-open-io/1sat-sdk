# MAP Templates Migration Implementation Plan

> **Status: SDK COMPLETE** ✅ | Go deferred to OpNS simplification plan

**Goal:** Replace legacy ASM-based MAP script building with `@bopen-io/templates` MAP class, fix inscribe to actually write MAP data, and simplify OpNS to use `opns.idKey`.

**Architecture:** All MAP script building moves from `@1sat/core` (ASM string concatenation) to `@bopen-io/templates` MAP class (proper push-data scripts via BitCom). The `MAP` TypeScript type becomes flexible (no required fields). Inscription outputs use the `scriptSuffix` option to append MAP after the envelope.

**Tech Stack:** TypeScript (`@bopen-io/templates`, `@bsv/sdk`), Go (`1sat-stack`)

**Result:** SDK changes completed in prior session. Go-side changes superseded by OpNS simplification plan (OrdFS handles identity resolution).

---

## Task 1: Make MAP type flexible in @1sat/types

**Files:**
- Modify: `packages/types/src/index.ts:293-297`

**Step 1: Update MAP type definition**

Change lines 293-297 from:

```typescript
export type MAP = {
	app: string
	type: string
	[prop: string]: string
}
```

to:

```typescript
export type MAP = {
	app?: string
	type?: string
	[prop: string]: string | undefined
}
```

**Step 2: Run type check to verify no downstream breakage**

Run: `cd /home/shruggr/Code/1sat-sdk && bun run --filter '@1sat/types' build`
Expected: PASS — this is a widening change, existing callers still satisfy the type.

**Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "refactor: make MAP type app and type fields optional"
```

---

## Task 2: Replace appendMapToScript with templates MAP in transferOrdinals

**Files:**
- Modify: `packages/actions/src/ordinals/index.ts:8-9,57-66,232,274-278`

**Step 1: Update imports**

Replace lines 8-9:

```typescript
import { appendMapToScript } from '@1sat/core'
import type { MAP } from '@1sat/types'
```

with:

```typescript
import { MAP as MAPTemplate } from '@bopen-io/templates'
```

**Step 2: Update TransferItem interface**

Change the `map` field type at line 65 from:

```typescript
	map?: MAP
```

to:

```typescript
	map?: Record<string, string>
```

**Step 3: Update buildTransferOrdinals locking script construction**

Replace the locking script block at lines 274-278:

```typescript
		// Build locking script — append MAP metadata when provided
		const p2pkhScript = new P2PKH().lock(recipientAddress)
		const lockingScript = map
			? appendMapToScript(p2pkhScript, map).toHex()
			: p2pkhScript.toHex()
```

with:

```typescript
		// Build locking script — append MAP metadata when provided
		const p2pkhScript = new P2PKH().lock(recipientAddress)
		let lockingScript: string
		if (map && Object.keys(map).length > 0) {
			const mapScript = MAPTemplate.set(map)
			const combined = new Script()
			for (const chunk of p2pkhScript.chunks) combined.chunks.push(chunk)
			for (const chunk of mapScript.chunks) combined.chunks.push(chunk)
			lockingScript = new LockingScript(combined.chunks).toHex()
		} else {
			lockingScript = p2pkhScript.toHex()
		}
```

Note: `Script` and `LockingScript` are already imported from `@bsv/sdk`.

**Step 4: Run type check**

Run: `cd /home/shruggr/Code/1sat-sdk && bun run --filter '@1sat/actions' build`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/actions/src/ordinals/index.ts
git commit -m "refactor: replace appendMapToScript with @bopen-io/templates MAP"
```

---

## Task 3: Fix inscribe action to write MAP to output script

**Files:**
- Modify: `packages/actions/src/inscriptions/index.ts:1-150`

**Step 1: Add MAP import**

Add to existing imports (after line 7):

```typescript
import { MAP as MAPTemplate } from '@bopen-io/templates'
```

**Step 2: Rewrite buildInscriptionScript to use Inscription template options**

Replace the `buildInscriptionScript` function (lines 39-53):

```typescript
function buildInscriptionScript(
	address: string,
	base64Content: string,
	contentType: string,
): Script {
	const content = Utils.toArray(base64Content, 'base64')
	const inscription = Inscription.create(new Uint8Array(content), contentType)
	const inscriptionScript = inscription.lock()
	const p2pkhScript = new P2PKH().lock(address)

	const combined = new Script()
	for (const chunk of inscriptionScript.chunks) combined.chunks.push(chunk)
	for (const chunk of p2pkhScript.chunks) combined.chunks.push(chunk)
	return combined
}
```

with:

```typescript
function buildInscriptionScript(
	address: string,
	base64Content: string,
	contentType: string,
	map?: Record<string, string>,
): Script {
	const content = Utils.toArray(base64Content, 'base64')
	const p2pkhScript = new P2PKH().lock(address)

	// Build suffix: P2PKH + optional MAP
	const suffix = new Script()
	for (const chunk of p2pkhScript.chunks) suffix.chunks.push(chunk)
	if (map && Object.keys(map).length > 0) {
		const mapScript = MAPTemplate.set(map)
		for (const chunk of mapScript.chunks) suffix.chunks.push(chunk)
	}

	const inscription = Inscription.create(new Uint8Array(content), contentType, {
		scriptSuffix: suffix,
	})
	return new Script(inscription.lock().chunks)
}
```

**Step 3: Pass map to buildInscriptionScript**

Update the call site in the `execute` function (around line 105):

```typescript
		const lockingScript = buildInscriptionScript(
			address,
			input.base64Content,
			input.contentType,
		)
```

to:

```typescript
		const lockingScript = buildInscriptionScript(
			address,
			input.base64Content,
			input.contentType,
			input.map,
		)
```

**Step 4: Run type check**

Run: `cd /home/shruggr/Code/1sat-sdk && bun run --filter '@1sat/actions' build`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/actions/src/inscriptions/index.ts
git commit -m "fix: inscribe action now writes MAP metadata to output script"
```

---

## Task 4: Simplify OpNS actions MAP data

**Files:**
- Modify: `packages/actions/src/opns/index.ts`

**Step 1: Update opnsRegister MAP data**

Find the MAP object in the register action's transfer call (around line 95) and change from:

```typescript
						map: {
							app: 'opns',
							type: 'opns',
							idKey: identityPubKey,
						},
```

to:

```typescript
						map: {
							'opns.idKey': identityPubKey,
						},
```

**Step 2: Update opnsDeregister MAP data**

Find the MAP object in the deregister action's transfer call (around line 210) and change from:

```typescript
						map: {
							app: 'opns',
							type: 'id',
							idKey: '',
						},
```

to:

```typescript
						map: {
							'opns.idKey': '',
						},
```

**Step 3: Remove unused MAP type import if present**

Check if `MAP` type is imported from `@1sat/types` — if so, remove it since we're now using plain `Record<string, string>` (passed through to `TransferItem.map`).

**Step 4: Run type check**

Run: `cd /home/shruggr/Code/1sat-sdk && bun run --filter '@1sat/actions' build`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/actions/src/opns/index.ts
git commit -m "refactor: simplify OpNS MAP data to use opns.idKey field"
```

---

## Task 5: Remove @1sat/core dependency from actions package

**Files:**
- Modify: `packages/actions/package.json:24`

**Step 1: Verify no remaining @1sat/core imports**

Run: `grep -r '@1sat/core' packages/actions/src/`
Expected: No matches (the only import was `appendMapToScript` in ordinals/index.ts, removed in Task 2)

**Step 2: Remove dependency**

In `packages/actions/package.json`, remove line 24:

```json
		"@1sat/core": "^0.0.6",
```

**Step 3: Reinstall dependencies**

Run: `cd /home/shruggr/Code/1sat-sdk && bun install`
Expected: PASS

**Step 4: Run type check**

Run: `cd /home/shruggr/Code/1sat-sdk && bun run --filter '@1sat/actions' build`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/actions/package.json bun.lockb
git commit -m "chore: remove @1sat/core dependency from actions package"
```

---

## Task 6: Update Go indexer MAP field check

**SUPERSEDED** — The OpNS overlay simplification plan (`2026-03-02-opns-simplification-ordfs.md`) removes MAP parsing from the overlay entirely. ORDFS handles identity resolution now. Skip this task.

---

## Task 7: Verification — type check all packages

**Status: COMPLETE** — SDK-side verification completed by prior session. Go-side deferred to OpNS simplification plan.

---

## Summary

All SDK changes were completed in a prior development session:
- ✅ MAP type made flexible (`app?`, `type?` optional)
- ✅ `appendMapToScript` replaced with `@bopen-io/templates` MAP
- ✅ Inscribe action writes MAP to output script via `scriptSuffix`
- ✅ OpNS actions simplified to use `opns.idKey` field
- ✅ `@1sat/core` dependency removed from actions package

Go-side changes were superseded by the OpNS simplification plan which removes MAP parsing from the overlay entirely (OrdFS handles identity resolution now).


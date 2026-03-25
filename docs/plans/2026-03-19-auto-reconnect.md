# AutoReconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `autoDetect` on WalletProvider with `autoReconnect` — returning users reconnect silently via their last provider, first-time users see a login button.

**Architecture:** `WalletProvider` checks localStorage for a stored provider on mount. If found and valid, it attempts reconnection via that provider's flow. For Sigma (OAuth redirect), a sessionStorage guard prevents redirect loops. If no stored provider exists, the component stays disconnected until the user explicitly clicks login. The explicit login flow (click → BRC-100 auto-detect → fallback to provider selector) is unchanged.

**Tech Stack:** React, @1sat/connect, @1sat/react, sessionStorage, localStorage

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/react/src/wallet-context.tsx` | Modify | Replace `autoDetect` with `autoReconnect`, add sigma guard logic |
| `packages/react/src/SigmaCallback.tsx` | Modify | Clear sigma guard on successful connection |
| `packages/react/src/index.ts` | Modify | Export `clearSigmaReconnectGuard` if needed by apps |
| `droplit/components/providers/WalletProviderWrapper.tsx` | Modify | Change `autoDetect` to `autoReconnect` |
| `droplit/components/layout/MarketingHeader.tsx` | Modify | Fix `disopenConnectDialog()` typo |
| `droplit/public/.well-known/manifest.json` | Create | Grouped permissions for BRC-77 |

---

### Task 1: Replace autoDetect with autoReconnect in WalletProvider

**Files:**
- Modify: `packages/react/src/wallet-context.tsx`

- [ ] **Step 1: Update WalletProviderProps interface**

Replace the `autoDetect` prop with `autoReconnect`:

```typescript
export interface WalletProviderProps {
	autoReconnect?: boolean
	providers?: WalletProviderConfig[]
	children: ReactNode
}
```

- [ ] **Step 2: Add sigma guard helpers**

Add these constants and functions after the existing storage helpers (`clearStored`, line 67):

```typescript
const SIGMA_GUARD_KEY = 'onesat_sigma_reconnecting'

function setSigmaGuard(): void {
	if (typeof window === 'undefined') return
	sessionStorage.setItem(SIGMA_GUARD_KEY, 'true')
}

function hasSigmaGuard(): boolean {
	if (typeof window === 'undefined') return false
	return sessionStorage.getItem(SIGMA_GUARD_KEY) === 'true'
}

export function clearSigmaGuard(): void {
	if (typeof window === 'undefined') return
	sessionStorage.removeItem(SIGMA_GUARD_KEY)
}
```

- [ ] **Step 3: Update WalletProvider function signature**

Change the destructured props:

```typescript
export function WalletProvider({
	autoReconnect = false,
	providers,
	children,
}: WalletProviderProps) {
```

- [ ] **Step 4: Replace the mount useEffect**

Replace the existing mount effect (lines 158-167) with the auto-reconnect logic:

```typescript
// Auto-reconnect on mount
useEffect(() => {
	const { autoReconnect: shouldReconnect, availableProviders: configured, connect: doConnect } = mountRef.current

	if (!shouldReconnect) {
		setStatus('disconnected')
		return
	}

	const stored = loadStoredProvider()
	if (!stored) {
		setStatus('disconnected')
		return
	}

	// Validate stored provider is in configured list
	const isConfigured = configured.some((p) => p.type === stored)
	if (!isConfigured) {
		clearStored()
		setStatus('disconnected')
		return
	}

	// Sigma redirect guard — if we already tried and failed, don't loop
	if (stored === 'sigma' && hasSigmaGuard()) {
		clearStored()
		clearSigmaGuard()
		setStatus('disconnected')
		return
	}

	// Set guard before sigma redirect (it navigates away)
	if (stored === 'sigma') {
		setSigmaGuard()
	}

	doConnect(stored).catch(() => {
		clearStored()
		if (stored === 'sigma') clearSigmaGuard()
		setStatus('disconnected')
	})
}, [])
```

- [ ] **Step 5: Update mountRef to include autoReconnect**

Update the mountRef to track `autoReconnect` instead of `autoDetect`:

```typescript
const mountRef = useRef({
	autoReconnect,
	availableProviders,
	connect,
	applyResult,
})
mountRef.current = {
	autoReconnect,
	availableProviders,
	connect,
	applyResult,
}
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/react' build`
Expected: Clean build with no errors

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/wallet-context.tsx
git commit -m "feat(react): replace autoDetect with autoReconnect on WalletProvider

Returning users reconnect via stored provider. First-time users
see disconnected state until explicit login. Sigma redirect
guard prevents OAuth loops via sessionStorage flag."
```

---

### Task 2: Clear sigma guard in SigmaCallback

**Files:**
- Modify: `packages/react/src/SigmaCallback.tsx`

- [ ] **Step 1: Import clearSigmaGuard**

Add to the import from `./wallet-context`:

```typescript
import { useWallet, clearSigmaGuard } from './wallet-context'
```

- [ ] **Step 2: Clear guard on successful connection**

In the `completeSignIn` function, clear the guard after `applyResult`:

```typescript
async function completeSignIn() {
	const oauthResult = await completeSigmaOAuth(searchParams)

	setStatus('Connecting wallet...')

	const walletResult = await connectSigmaWallet(oauthResult.bapId)
	applyResult(walletResult)
	clearSigmaGuard()

	if (onComplete) {
		onComplete()
	} else {
		window.location.href = redirectTo
	}
}
```

- [ ] **Step 3: Clear guard on error too**

In the catch block, clear the guard so a failed callback doesn't leave a stale flag:

```typescript
completeSignIn().catch((err) => {
	console.error('Sigma sign-in error:', err)
	clearSigmaGuard()
	const msg =
		err instanceof Error
			? err.message
			: typeof err === 'object' && err !== null && 'message' in err
				? String(err.message)
				: 'Authentication failed'
	setError(msg)
})
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/react' build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/SigmaCallback.tsx
git commit -m "feat(react): clear sigma reconnect guard in SigmaCallback

Clears sessionStorage guard on both success and error so stale
flags don't block future reconnect attempts."
```

---

### Task 3: Export clearSigmaGuard from package index

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Add clearSigmaGuard to wallet-context exports**

Update the wallet-context export block:

```typescript
export {
	WalletProvider,
	useWallet,
	loadStoredProvider,
	clearSigmaGuard,
	type WalletContextValue,
	type WalletProviderProps,
	type WalletStatus,
} from './wallet-context'
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/davidcase/Source/1sat/1sat-sdk && bun run --filter '@1sat/react' build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/index.ts
git commit -m "feat(react): export clearSigmaGuard from package"
```

---

### Task 4: Update droplit to use autoReconnect

**Files:**
- Modify: `droplit/components/providers/WalletProviderWrapper.tsx`

- [ ] **Step 1: Replace autoDetect with autoReconnect**

Change the WalletProvider prop:

```tsx
export function WalletProviderWrapper({ children }: { children: ReactNode }) {
	return (
		<WalletProvider autoReconnect providers={providers}>
			<ConnectDialogProvider>
				<WalletSync>{children}</WalletSync>
			</ConnectDialogProvider>
		</WalletProvider>
	);
}
```

- [ ] **Step 2: Fix MarketingHeader logout typo**

In `droplit/components/layout/MarketingHeader.tsx` line 75, fix:

```typescript
// Before:
disopenConnectDialog();

// After:
disconnect();
```

- [ ] **Step 3: Verify droplit builds**

Run: `cd /Users/davidcase/Source/1sat/droplit && bun run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
cd /Users/davidcase/Source/1sat/droplit
git add components/providers/WalletProviderWrapper.tsx components/layout/MarketingHeader.tsx
git commit -m "feat: use autoReconnect and fix logout disconnect"
```

---

### Task 5: Create droplit manifest.json

**Files:**
- Create: `droplit/public/.well-known/manifest.json`

- [ ] **Step 1: Create the manifest**

```json
{
  "metanet": {
    "groupPermissions": {
      "description": "Droplit needs to sign API requests on your behalf",
      "protocolPermissions": [
        {
          "protocolID": [2, "brc77"],
          "description": "Sign API requests"
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Verify the file is served**

Run: `cd /Users/davidcase/Source/1sat/droplit && bun run dev &` then `curl http://localhost:4200/.well-known/manifest.json`
Expected: Returns the JSON content

- [ ] **Step 3: Commit**

```bash
cd /Users/davidcase/Source/1sat/droplit
git add public/.well-known/manifest.json
git commit -m "feat: add wallet permissions manifest for grouped permission prompt"
```

---

### Task 6: Verify end-to-end flows

- [ ] **Step 1: First-time visitor flow**

1. Clear localStorage (`onesat_wallet_provider` key)
2. Clear sessionStorage (`onesat_sigma_reconnecting` key)
3. Load droplit in browser
4. Verify: no redirect, no wallet popup, login button visible
5. Click login → provider selector appears

- [ ] **Step 2: Returning Sigma user flow**

1. Complete Sigma login flow
2. Verify `onesat_wallet_provider` is set to `"sigma"` in localStorage
3. Refresh the page
4. Verify: redirects to Sigma OAuth, completes, lands on dashboard connected

- [ ] **Step 3: Sigma redirect guard flow**

1. Set `onesat_wallet_provider` to `{"providerType":"sigma"}` in localStorage
2. Set `onesat_sigma_reconnecting` to `"true"` in sessionStorage
3. Load droplit
4. Verify: no redirect, stored provider cleared, login button visible

- [ ] **Step 4: Returning BRC-100 user flow**

1. Connect via BRC-100 wallet (Yours or similar)
2. Verify `onesat_wallet_provider` is set
3. Refresh the page
4. Verify: auto-reconnects to wallet without showing selector

- [ ] **Step 5: Unknown stored provider flow**

1. Set `onesat_wallet_provider` to `{"providerType":"unknown_provider"}` in localStorage
2. Load droplit
3. Verify: stored provider cleared, login button visible, no errors

---

## Notes

- **1sat-stack admin** uses `@1sat/connect` directly (not `@1sat/react`), so it doesn't need changes. Its `WalletGate` component calls `connectWallet()` from `@1sat/connect` which does BRC-100 auto-detect only.
- **Publishing order**: Build and publish `@1sat/react` first, then update droplit's dependency version.
- **Backward compatibility**: Apps using `autoDetect={true}` will get a TypeScript error pointing them to `autoReconnect`. Apps using bare `<WalletProvider>` without any auto prop will silently change from "auto-detect on mount" to "disconnected on mount" since the default changes from `true` to `false`. This is intentional — first-time users should not get unsolicited wallet popups.
- **Callback page race**: On the Sigma callback route, the mount effect will see the sigma guard and clear stored state. This is harmless because `SigmaCallback` completes independently via URL search params and re-saves the provider via `applyResult`. The mount cleanup and SigmaCallback operate on different data paths.

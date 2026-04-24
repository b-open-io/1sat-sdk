# CWI Receiver Standardization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize CWI receivers across the stack. Phase 1 adds a shared receiver layer in `@1sat/wallet` covering the three `cwi/` channels that have concrete consumers (chrome.runtime, iframe postMessage for wallet host, Sigma iframe host), with the `CWIEventName` allowlist enforced at the channel boundary. Phase 2 migrates every consumer (yours-wallet, `@1sat/extension`, sigma-auth, 1sat-website, `@1sat/connect`) onto that layer and deletes duplicated envelope parsing.

**Architecture:** Mirror the existing sender-side helpers (`createChromeCWI`, `createWebCWI`, `createSigmaCWI`) with receiver counterparts. Each channel adapter translates its on-wire envelope to a shared internal request shape, hands it to a pure `handleCWIRequest(wallet, request)` core, and translates the internal response back to the channel's on-wire envelope. The core validates shape → checks `action ∈ CWIEventName` → calls `wallet[action](params)` → wraps success/error. No policy (origin trust, lock state, permission popups) lives here — wallets keep that as upstream middleware or inside their `WalletInterface` implementation. On channels that support multiple listeners (chrome.runtime, postMessage), non-CWI actions ignored by the receiver continue to be handled by the wallet's existing admin listeners.

**Tech Stack:** TypeScript, Bun, Biome, existing `@1sat/wallet` package, `@bsv/sdk`'s `WalletInterface`.

---

## Context

The SDK today has a standardized sender-side abstraction: `CWITransport` in [factory.ts](/Users/davidcase/Source/1sat/1sat-sdk/packages/wallet/src/cwi/factory.ts) and four channel implementations that all produce a `WalletInterface`. There is no corresponding receiver abstraction — every wallet (yours-wallet, `@1sat/extension`, wallet-server, wallet-desktop, sigma-auth) hand-rolls its own envelope parsing and dispatch switch. The recent yours-wallet security fix (content script forwarding unvalidated `type` values to the background's `noAuthRequired` block) exists because there is no shared allowlist enforced at the channel boundary.

Two on-wire envelope conventions exist in the SDK:

- **Extension-style** (`event.ts`, `chrome.ts`): `{ action, params, originator }` → `{ success, data?, error? }`
- **BRC-100 postMessage-style** (`web.ts`, `sigma.ts`, `@1sat/connect`): `{ type: 'CWI', isInvocation, id, call, args }` → `{ type: 'CWI', isInvocation: false, id, result? | status: 'error', description?, code? }`

Each channel receiver must keep its on-wire shape compatible with existing senders; internally they converge on a single request/response type.

## File Structure

```
1sat-sdk/packages/wallet/src/cwi/
├── types.ts                    # MODIFY — add runtime allowlist + shared envelope types
├── factory.ts                  # unchanged
├── event.ts                    # unchanged (sender)
├── chrome.ts                   # unchanged (sender)
├── web.ts                      # MODIFY — import shared envelope types instead of re-declaring
├── sigma.ts                    # MODIFY — same
├── receiver.ts                 # NEW — handleCWIRequest core, channel-agnostic
├── chrome-receiver.ts          # NEW — createChromeCWIReceiver
├── web-receiver.ts             # NEW — createWebCWIReceiver (iframe host)
├── sigma-receiver.ts           # NEW — createSigmaCWIReceiver
└── index.ts                    # MODIFY — export new symbols
```

Tests live in `1sat-sdk/packages/wallet/test/cwi/` (create directory).

---

## Task 1: Runtime `CWIEventName` Allowlist

**Files:**
- Modify: `1sat-sdk/packages/wallet/src/cwi/types.ts`
- Test: `1sat-sdk/packages/wallet/test/cwi/allowlist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 1sat-sdk/packages/wallet/test/cwi/allowlist.test.ts
import { describe, expect, it } from 'bun:test'
import { CWI_EVENT_NAMES, CWIEventName, isCWIEventName } from '../../src/cwi/types'

describe('CWIEventName allowlist', () => {
  it('CWI_EVENT_NAMES contains every enum value', () => {
    expect(CWI_EVENT_NAMES.size).toBe(Object.values(CWIEventName).length)
    for (const v of Object.values(CWIEventName)) {
      expect(CWI_EVENT_NAMES.has(v)).toBe(true)
    }
  })

  it('isCWIEventName returns true for valid names', () => {
    expect(isCWIEventName('listOutputs')).toBe(true)
    expect(isCWIEventName('createAction')).toBe(true)
  })

  it('isCWIEventName returns false for invalid names', () => {
    expect(isCWIEventName('MASTER_BACKUP')).toBe(false)
    expect(isCWIEventName('storageAddRemote')).toBe(false)
    expect(isCWIEventName('')).toBe(false)
    expect(isCWIEventName(null as unknown as string)).toBe(false)
    expect(isCWIEventName(undefined as unknown as string)).toBe(false)
    expect(isCWIEventName(42 as unknown as string)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun test --filter '@1sat/wallet' cwi/allowlist
```

Expected: FAIL — `CWI_EVENT_NAMES` and `isCWIEventName` don't exist.

- [ ] **Step 3: Add the allowlist to types.ts**

Append to `1sat-sdk/packages/wallet/src/cwi/types.ts` (keep existing enum and interface):

```ts
/** Frozen set of every valid CWIEventName value. Use for runtime validation. */
export const CWI_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(CWIEventName),
)

/** Type guard: true iff `s` is a valid CWIEventName. */
export const isCWIEventName = (s: unknown): s is CWIEventName =>
  typeof s === 'string' && CWI_EVENT_NAMES.has(s)
```

- [ ] **Step 4: Run test — expect pass**

```bash
bun test --filter '@1sat/wallet' cwi/allowlist
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 1sat-sdk/packages/wallet/src/cwi/types.ts 1sat-sdk/packages/wallet/test/cwi/allowlist.test.ts
git commit -m "feat(wallet): add CWIEventName runtime allowlist"
```

---

## Task 2: Shared Envelope Types

**Files:**
- Modify: `1sat-sdk/packages/wallet/src/cwi/types.ts`
- Test: none (pure type declarations)

Both on-wire conventions map to a single internal request/response pair used by the receiver core and adapters. We also export the BRC-100 postMessage envelope types that `web.ts`, `sigma.ts`, and `@1sat/connect` currently duplicate.

- [ ] **Step 1: Extend types.ts**

Append to `1sat-sdk/packages/wallet/src/cwi/types.ts`:

```ts
/**
 * Channel-agnostic CWI request passed into handleCWIRequest.
 * Each channel adapter converts its on-wire envelope to this shape.
 */
export interface CWIRequest {
  action: CWIEventName
  params: unknown
  /**
   * BRC-100 originator string. Must be infrastructure-supplied by the channel
   * adapter (e.g. Chrome message field or MessageEvent.origin), never from the
   * caller-facing payload.
   */
  originator?: string
  /** Correlation id for logging / tracing. Optional. */
  id?: string
}

/** Channel-agnostic CWI response produced by handleCWIRequest. */
export type CWIResponse<T = unknown> =
  | { ok: true; data: T; id?: string }
  | { ok: false; error: { message: string; code?: string }; id?: string }

/**
 * BRC-100 postMessage request envelope used by iframe/popup channels
 * (web, sigma, @1sat/connect). Previously duplicated per channel.
 */
export interface CWIRequestMessage {
  type: 'CWI'
  isInvocation: true
  id: string
  call: string
  args?: unknown
}

/** BRC-100 postMessage response envelope used by iframe/popup channels. */
export interface CWIResponseMessage {
  type: 'CWI'
  isInvocation: false
  id: string
  result?: unknown
  status?: 'error'
  description?: string
  code?: number
}
```

- [ ] **Step 2: Lint/build**

```bash
bun run --filter '@1sat/wallet' lint
bun run --filter '@1sat/wallet' build
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add 1sat-sdk/packages/wallet/src/cwi/types.ts
git commit -m "feat(wallet): add shared CWI envelope types"
```

---

## Task 3: `handleCWIRequest` Core

**Files:**
- Create: `1sat-sdk/packages/wallet/src/cwi/receiver.ts`
- Test: `1sat-sdk/packages/wallet/test/cwi/receiver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 1sat-sdk/packages/wallet/test/cwi/receiver.test.ts
import type { WalletInterface } from '@bsv/sdk'
import { describe, expect, it, mock } from 'bun:test'
import { handleCWIRequest } from '../../src/cwi/receiver'
import { CWIEventName } from '../../src/cwi/types'

const stubWallet = (overrides: Partial<WalletInterface> = {}): WalletInterface =>
  ({
    getVersion: mock(async () => ({ version: '1.0.0' })),
    getNetwork: mock(async () => ({ network: 'mainnet' })),
    createSignature: mock(async () => ({ signature: new Uint8Array() })),
    ...overrides,
  }) as unknown as WalletInterface

describe('handleCWIRequest', () => {
  it('dispatches a valid action and returns ok', async () => {
    const wallet = stubWallet()
    const res = await handleCWIRequest(wallet, {
      action: CWIEventName.GET_VERSION,
      params: {},
    })
    expect(res).toEqual({ ok: true, data: { version: '1.0.0' } })
  })

  it('rejects an unknown action with a structured error', async () => {
    const wallet = stubWallet()
    const res = await handleCWIRequest(wallet, {
      action: 'MASTER_BACKUP' as unknown as CWIEventName,
      params: {},
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error')
    expect(res.error.code).toBe('UNKNOWN_ACTION')
  })

  it('catches wallet throws and returns structured error', async () => {
    const wallet = stubWallet({
      getVersion: mock(async () => {
        throw new Error('boom')
      }),
    })
    const res = await handleCWIRequest(wallet, {
      action: CWIEventName.GET_VERSION,
      params: {},
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error')
    expect(res.error.message).toBe('boom')
  })

  it('preserves correlation id on both success and error paths', async () => {
    const wallet = stubWallet()
    const ok = await handleCWIRequest(wallet, {
      action: CWIEventName.GET_VERSION,
      params: {},
      id: 'req-1',
    })
    expect(ok.id).toBe('req-1')

    const err = await handleCWIRequest(wallet, {
      action: 'nope' as CWIEventName,
      params: {},
      id: 'req-2',
    })
    expect(err.id).toBe('req-2')
  })

  it('forwards originator as second argument to the wallet method', async () => {
    const spy = mock(async () => ({ version: '1.0.0' }))
    const wallet = stubWallet({ getVersion: spy })
    await handleCWIRequest(wallet, {
      action: CWIEventName.GET_VERSION,
      params: { a: 1 },
      originator: 'dapp.example.com',
    })
    expect(spy).toHaveBeenCalledWith({ a: 1 }, 'dapp.example.com')
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun test --filter '@1sat/wallet' cwi/receiver
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the core**

```ts
// 1sat-sdk/packages/wallet/src/cwi/receiver.ts
import type { WalletInterface } from '@bsv/sdk'
import {
  type CWIRequest,
  type CWIResponse,
  isCWIEventName,
} from './types'

export const handleCWIRequest = async <T = unknown>(
  wallet: WalletInterface,
  request: CWIRequest,
): Promise<CWIResponse<T>> => {
  const { action, params, originator, id } = request

  if (!isCWIEventName(action)) {
    return {
      ok: false,
      id,
      error: { code: 'UNKNOWN_ACTION', message: `Unknown CWI action: ${String(action)}` },
    }
  }

  const method = (wallet as unknown as Record<string, unknown>)[action]
  if (typeof method !== 'function') {
    return {
      ok: false,
      id,
      error: { code: 'METHOD_NOT_IMPLEMENTED', message: `Wallet does not implement ${action}` },
    }
  }

  try {
    const data = await (method as (args: unknown, originator?: string) => Promise<unknown>).call(
      wallet,
      params,
      originator,
    )
    return { ok: true, id, data: data as T }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, id, error: { message } }
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
bun test --filter '@1sat/wallet' cwi/receiver
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 1sat-sdk/packages/wallet/src/cwi/receiver.ts 1sat-sdk/packages/wallet/test/cwi/receiver.test.ts
git commit -m "feat(wallet): add handleCWIRequest receiver core"
```

---

## Task 4: `createChromeCWIReceiver`

Mirrors [chrome.ts](/Users/davidcase/Source/1sat/1sat-sdk/packages/wallet/src/cwi/chrome.ts). Listens on `chrome.runtime.onMessage` and responds asynchronously via `sendResponse`.

**Files:**
- Create: `1sat-sdk/packages/wallet/src/cwi/chrome-receiver.ts`
- Test: `1sat-sdk/packages/wallet/test/cwi/chrome-receiver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 1sat-sdk/packages/wallet/test/cwi/chrome-receiver.test.ts
import type { WalletInterface } from '@bsv/sdk'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createChromeCWIReceiver } from '../../src/cwi/chrome-receiver'
import { CWIEventName } from '../../src/cwi/types'

type Listener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void
let listener: Listener | null = null
const chromeMock = {
  runtime: {
    onMessage: {
      addListener: (l: Listener) => { listener = l },
      removeListener: (l: Listener) => { if (listener === l) listener = null },
    },
  },
}

describe('createChromeCWIReceiver', () => {
  beforeEach(() => {
    listener = null
    ;(globalThis as unknown as { chrome: unknown }).chrome = chromeMock
  })
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })

  it('dispatches valid actions', async () => {
    const wallet = {
      getVersion: mock(async () => ({ version: '1.0.0' })),
    } as unknown as WalletInterface
    const receiver = createChromeCWIReceiver(wallet)
    const response = await new Promise((resolve) => {
      listener!(
        { action: CWIEventName.GET_VERSION, params: {}, originator: 'test' },
        {},
        resolve,
      )
    })
    expect(response).toEqual({ success: true, data: { version: '1.0.0' } })
    receiver.dispose()
  })

  it('ignores messages with non-CWI action (does not call sendResponse)', async () => {
    const wallet = { getVersion: mock(async () => ({})) } as unknown as WalletInterface
    const receiver = createChromeCWIReceiver(wallet)
    let called = false
    const rc = listener!(
      { action: 'MASTER_BACKUP', params: {}, originator: 'test' },
      {},
      () => { called = true },
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(called).toBe(false)
    expect(rc).toBe(false) // tells chrome not to keep the channel open
    receiver.dispose()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// 1sat-sdk/packages/wallet/src/cwi/chrome-receiver.ts
import type { WalletInterface } from '@bsv/sdk'
import { handleCWIRequest } from './receiver'
import { isCWIEventName } from './types'

type SendResponse = (response: unknown) => void
type Listener = (msg: unknown, sender: unknown, sendResponse: SendResponse) => boolean

interface ChromeRuntimeMessage {
  action?: unknown
  params?: unknown
  originator?: unknown
}

export interface ChromeCWIReceiver {
  dispose: () => void
}

const isMessage = (v: unknown): v is ChromeRuntimeMessage =>
  typeof v === 'object' && v !== null && 'action' in v

export const createChromeCWIReceiver = (
  wallet: WalletInterface,
): ChromeCWIReceiver => {
  const api = (globalThis as unknown as {
    chrome?: { runtime?: { onMessage?: { addListener: (l: Listener) => void; removeListener: (l: Listener) => void } } }
  }).chrome
  if (!api?.runtime?.onMessage) {
    throw new Error('createChromeCWIReceiver: chrome.runtime.onMessage unavailable')
  }

  const listener: Listener = (msg, _sender, sendResponse) => {
    if (!isMessage(msg)) return false
    if (!isCWIEventName(msg.action)) return false // Not a CWI message — let other listeners handle it.

    void handleCWIRequest(wallet, {
      action: msg.action,
      params: msg.params,
      originator: typeof msg.originator === 'string' ? msg.originator : undefined,
    }).then((response) => {
      sendResponse(
        response.ok
          ? { success: true, data: response.data }
          : { success: false, error: response.error.message },
      )
    })

    return true // Keep the channel open for async sendResponse.
  }

  api.runtime.onMessage.addListener(listener)
  return {
    dispose: () => api.runtime!.onMessage!.removeListener(listener),
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add 1sat-sdk/packages/wallet/src/cwi/chrome-receiver.ts 1sat-sdk/packages/wallet/test/cwi/chrome-receiver.test.ts
git commit -m "feat(wallet): add createChromeCWIReceiver"
```

---

## Task 5: `createWebCWIReceiver` (iframe host side)

The wallet runs inside an iframe exposed to a dApp page. The host listens on `window.message` events matching the BRC-100 request envelope and posts responses back to the requesting `event.source`. Mirrors the sender in [web.ts](/Users/davidcase/Source/1sat/1sat-sdk/packages/wallet/src/cwi/web.ts).

**Files:**
- Create: `1sat-sdk/packages/wallet/src/cwi/web-receiver.ts`
- Test: `1sat-sdk/packages/wallet/test/cwi/web-receiver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 1sat-sdk/packages/wallet/test/cwi/web-receiver.test.ts
import type { WalletInterface } from '@bsv/sdk'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createWebCWIReceiver } from '../../src/cwi/web-receiver'
import { CWIEventName } from '../../src/cwi/types'

interface PostedEnvelope {
  data: unknown
  targetOrigin: string
}
const postedMessages: PostedEnvelope[] = []
const parent = {
  postMessage: (data: unknown, targetOrigin: string) => {
    postedMessages.push({ data, targetOrigin })
  },
}

describe('createWebCWIReceiver', () => {
  let target: EventTarget
  let dispose: () => void

  beforeEach(() => {
    postedMessages.length = 0
    target = new EventTarget()
  })
  afterEach(() => dispose?.())

  const fireMessage = (data: unknown, source: unknown = parent, origin = 'https://dapp.test') => {
    const event = new MessageEvent('message', { data, origin, source: source as MessageEventSource })
    target.dispatchEvent(event)
  }

  it('responds to valid BRC-100 envelopes', async () => {
    const wallet = {
      getVersion: mock(async () => ({ version: '1.0.0' })),
    } as unknown as WalletInterface
    const receiver = createWebCWIReceiver(wallet, { target, allowedOrigins: ['https://dapp.test'] })
    dispose = receiver.dispose

    fireMessage({
      type: 'CWI',
      isInvocation: true,
      id: 'r-1',
      call: CWIEventName.GET_VERSION,
      args: {},
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(postedMessages).toHaveLength(1)
    expect(postedMessages[0].data).toMatchObject({
      type: 'CWI',
      isInvocation: false,
      id: 'r-1',
      result: { version: '1.0.0' },
    })
  })

  it('drops envelopes whose call is not in CWIEventName', async () => {
    const wallet = { getVersion: mock(async () => ({})) } as unknown as WalletInterface
    const receiver = createWebCWIReceiver(wallet, { target, allowedOrigins: ['https://dapp.test'] })
    dispose = receiver.dispose

    fireMessage({
      type: 'CWI',
      isInvocation: true,
      id: 'r-2',
      call: 'MASTER_BACKUP',
      args: {},
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(postedMessages).toHaveLength(0)
  })

  it('drops messages whose origin is not in allowedOrigins', async () => {
    const wallet = { getVersion: mock(async () => ({ version: '1' })) } as unknown as WalletInterface
    const receiver = createWebCWIReceiver(wallet, { target, allowedOrigins: ['https://dapp.test'] })
    dispose = receiver.dispose

    fireMessage(
      { type: 'CWI', isInvocation: true, id: 'r-3', call: CWIEventName.GET_VERSION, args: {} },
      parent,
      'https://evil.test',
    )

    await new Promise((r) => setTimeout(r, 10))
    expect(postedMessages).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// 1sat-sdk/packages/wallet/src/cwi/web-receiver.ts
import type { WalletInterface } from '@bsv/sdk'
import { handleCWIRequest } from './receiver'
import {
  type CWIRequestMessage,
  type CWIResponseMessage,
  isCWIEventName,
} from './types'

export interface WebCWIReceiverConfig {
  /** Host origins permitted to send requests. Required for safety. */
  allowedOrigins: string[]
  /** EventTarget to listen on. Defaults to globalThis. */
  target?: EventTarget
}

export interface WebCWIReceiver {
  dispose: () => void
}

const isRequest = (v: unknown): v is CWIRequestMessage => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    r.type === 'CWI' &&
    r.isInvocation === true &&
    typeof r.id === 'string' &&
    typeof r.call === 'string'
  )
}

export const createWebCWIReceiver = (
  wallet: WalletInterface,
  config: WebCWIReceiverConfig,
): WebCWIReceiver => {
  const allowed = new Set(config.allowedOrigins)
  const target = config.target ?? (globalThis as unknown as EventTarget)

  const onMessage = async (event: Event) => {
    const msg = event as MessageEvent
    if (!allowed.has(msg.origin)) return
    if (!isRequest(msg.data)) return
    if (!isCWIEventName(msg.data.call)) return

    const response = await handleCWIRequest(wallet, {
      action: msg.data.call,
      params: msg.data.args,
      originator: msg.origin,
      id: msg.data.id,
    })

    const envelope: CWIResponseMessage = response.ok
      ? { type: 'CWI', isInvocation: false, id: msg.data.id, result: response.data }
      : {
          type: 'CWI',
          isInvocation: false,
          id: msg.data.id,
          status: 'error',
          description: response.error.message,
        }

    const source = msg.source as { postMessage?: (d: unknown, o: string) => void } | null
    source?.postMessage?.(envelope, msg.origin)
  }

  target.addEventListener('message', onMessage as EventListener)
  return {
    dispose: () => target.removeEventListener('message', onMessage as EventListener),
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add 1sat-sdk/packages/wallet/src/cwi/web-receiver.ts 1sat-sdk/packages/wallet/test/cwi/web-receiver.test.ts
git commit -m "feat(wallet): add createWebCWIReceiver"
```

---

## Task 6: `createSigmaCWIReceiver`

Sigma uses the same envelope as `web.ts` but additionally supports non-CWI custom messages (e.g. `SET_IDENTITY`). The receiver dispatches BRC-100 requests and exposes a hook for custom message types.

**Files:**
- Create: `1sat-sdk/packages/wallet/src/cwi/sigma-receiver.ts`
- Test: `1sat-sdk/packages/wallet/test/cwi/sigma-receiver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 1sat-sdk/packages/wallet/test/cwi/sigma-receiver.test.ts
import type { WalletInterface } from '@bsv/sdk'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createSigmaCWIReceiver } from '../../src/cwi/sigma-receiver'
import { CWIEventName } from '../../src/cwi/types'

describe('createSigmaCWIReceiver', () => {
  let target: EventTarget
  let dispose: () => void

  beforeEach(() => { target = new EventTarget() })
  afterEach(() => dispose?.())

  it('dispatches CWI requests like web-receiver', async () => {
    const wallet = {
      getVersion: mock(async () => ({ version: '1.0.0' })),
    } as unknown as WalletInterface
    const posted: unknown[] = []
    const parent = { postMessage: (d: unknown) => posted.push(d) }

    const receiver = createSigmaCWIReceiver(wallet, {
      target,
      allowedOrigins: ['https://dapp.test'],
    })
    dispose = receiver.dispose

    target.dispatchEvent(new MessageEvent('message', {
      data: { type: 'CWI', isInvocation: true, id: 'r-1', call: CWIEventName.GET_VERSION, args: {} },
      origin: 'https://dapp.test',
      source: parent as unknown as MessageEventSource,
    }))

    await new Promise((r) => setTimeout(r, 10))
    expect(posted).toHaveLength(1)
  })

  it('routes non-CWI messages to onCustomMessage', async () => {
    const wallet = {} as unknown as WalletInterface
    const received: Array<{ type: string; payload: unknown; origin: string }> = []

    const receiver = createSigmaCWIReceiver(wallet, {
      target,
      allowedOrigins: ['https://dapp.test'],
      onCustomMessage: (m) => received.push(m),
    })
    dispose = receiver.dispose

    target.dispatchEvent(new MessageEvent('message', {
      data: { type: 'SET_IDENTITY', payload: { pk: 'abc' } },
      origin: 'https://dapp.test',
    }))

    await new Promise((r) => setTimeout(r, 10))
    expect(received).toEqual([{ type: 'SET_IDENTITY', payload: { pk: 'abc' }, origin: 'https://dapp.test' }])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// 1sat-sdk/packages/wallet/src/cwi/sigma-receiver.ts
import type { WalletInterface } from '@bsv/sdk'
import { handleCWIRequest } from './receiver'
import {
  type CWIRequestMessage,
  type CWIResponseMessage,
  isCWIEventName,
} from './types'

export interface SigmaCustomMessage {
  type: string
  payload: unknown
  origin: string
}

export interface SigmaCWIReceiverConfig {
  allowedOrigins: string[]
  target?: EventTarget
  /** Optional handler for non-CWI messages (e.g. SET_IDENTITY). */
  onCustomMessage?: (message: SigmaCustomMessage) => void
}

export interface SigmaCWIReceiver {
  dispose: () => void
}

const isCWIRequest = (v: unknown): v is CWIRequestMessage => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return r.type === 'CWI' && r.isInvocation === true && typeof r.id === 'string' && typeof r.call === 'string'
}

const isCustom = (v: unknown): v is { type: string; payload: unknown } => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.type === 'string' && r.type !== 'CWI'
}

export const createSigmaCWIReceiver = (
  wallet: WalletInterface,
  config: SigmaCWIReceiverConfig,
): SigmaCWIReceiver => {
  const allowed = new Set(config.allowedOrigins)
  const target = config.target ?? (globalThis as unknown as EventTarget)

  const onMessage = async (event: Event) => {
    const msg = event as MessageEvent
    if (!allowed.has(msg.origin)) return

    if (isCWIRequest(msg.data)) {
      if (!isCWIEventName(msg.data.call)) return
      const response = await handleCWIRequest(wallet, {
        action: msg.data.call,
        params: msg.data.args,
        originator: msg.origin,
        id: msg.data.id,
      })
      const envelope: CWIResponseMessage = response.ok
        ? { type: 'CWI', isInvocation: false, id: msg.data.id, result: response.data }
        : { type: 'CWI', isInvocation: false, id: msg.data.id, status: 'error', description: response.error.message }
      const source = msg.source as { postMessage?: (d: unknown, o: string) => void } | null
      source?.postMessage?.(envelope, msg.origin)
      return
    }

    if (isCustom(msg.data) && config.onCustomMessage) {
      config.onCustomMessage({ type: msg.data.type, payload: msg.data.payload, origin: msg.origin })
    }
  }

  target.addEventListener('message', onMessage as EventListener)
  return {
    dispose: () => target.removeEventListener('message', onMessage as EventListener),
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add 1sat-sdk/packages/wallet/src/cwi/sigma-receiver.ts 1sat-sdk/packages/wallet/test/cwi/sigma-receiver.test.ts
git commit -m "feat(wallet): add createSigmaCWIReceiver"
```

---

## Task 7: De-duplicate envelope types in `web.ts` and `sigma.ts`

Now that `CWIRequestMessage` / `CWIResponseMessage` are exported from `types.ts`, both senders should import them instead of re-declaring.

**Files:**
- Modify: `1sat-sdk/packages/wallet/src/cwi/web.ts`
- Modify: `1sat-sdk/packages/wallet/src/cwi/sigma.ts`

- [ ] **Step 1: Replace local interfaces in web.ts**

In [web.ts](/Users/davidcase/Source/1sat/1sat-sdk/packages/wallet/src/cwi/web.ts), delete the local `interface CWIRequestMessage` and `interface CWIResponseMessage` (lines 37-53) and add `CWIRequestMessage`, `CWIResponseMessage` to the existing `./types` import. Keep `CWIStateMessage` local — it's web-specific.

- [ ] **Step 2: Same change in sigma.ts**

Delete the local `interface CWIRequestMessage` and `interface CWIResponseMessage` (lines 39-55) and import from `./types`. Keep `CWIStateMessage` local.

- [ ] **Step 3: Lint + build + test**

```bash
bun run --filter '@1sat/wallet' lint
bun run --filter '@1sat/wallet' build
bun test --filter '@1sat/wallet' cwi
```

Expected: all pass. No behavior change.

- [ ] **Step 4: Commit**

```bash
git add 1sat-sdk/packages/wallet/src/cwi/web.ts 1sat-sdk/packages/wallet/src/cwi/sigma.ts
git commit -m "refactor(wallet): share CWI envelope types across cwi/"
```

---

## Task 8: Update barrel exports

**Files:**
- Modify: `1sat-sdk/packages/wallet/src/cwi/index.ts`

- [ ] **Step 1: Add new exports**

Replace `1sat-sdk/packages/wallet/src/cwi/index.ts` with:

```ts
/**
 * CWI (Compute With Integrity) — BRC-100 WalletInterface implementations
 *
 * Sender-side helpers produce a WalletInterface bound to a transport channel.
 * Receiver-side helpers bind a WalletInterface to a channel so other processes
 * can invoke it.
 */

export {
  CWIEventName,
  type CWIResponseDetail,
  type CWIRequest,
  type CWIResponse,
  type CWIRequestMessage,
  type CWIResponseMessage,
  CWI_EVENT_NAMES,
  isCWIEventName,
} from './types'

export { createCWI, type CWITransport } from './factory'

// Senders
export { createEventCWI, CWI as EventCWI } from './event'
export { createChromeCWI, ChromeCWI } from './chrome'
export { createWebCWI, type WebCWIConfig, type WebCWIResult } from './web'
export {
  createSigmaCWI,
  type SigmaCWIConfig,
  type SigmaCWIResult,
} from './sigma'

// Receivers
export { handleCWIRequest } from './receiver'
export { createChromeCWIReceiver, type ChromeCWIReceiver } from './chrome-receiver'
export {
  createWebCWIReceiver,
  type WebCWIReceiver,
  type WebCWIReceiverConfig,
} from './web-receiver'
export {
  createSigmaCWIReceiver,
  type SigmaCWIReceiver,
  type SigmaCWIReceiverConfig,
  type SigmaCustomMessage,
} from './sigma-receiver'
```

- [ ] **Step 2: Full package lint + build + test**

```bash
bun run --filter '@1sat/wallet' lint
bun run --filter '@1sat/wallet' build
bun test --filter '@1sat/wallet'
```

Expected: all pass.

- [ ] **Step 3: Monorepo-wide validation**

```bash
bun run lint
bun run build
```

Expected: all pass (no consumer should break — we only added exports).

- [ ] **Step 4: Commit**

```bash
git add 1sat-sdk/packages/wallet/src/cwi/index.ts
git commit -m "feat(wallet): export CWI receiver helpers"
```

---

## Phase 2: Consumer migrations

Each consumer gets its own plan and its own PR once Phase 1 is published. Migration order below is the suggested sequence — earlier ones are lowest risk and exercise the receiver layer; later ones have more wallet-specific policy to thread through.

Migration targets:

1. **`@1sat/connect`** — import `CWIRequestMessage` / `CWIResponseMessage` from `@1sat/wallet` and delete its duplicates. No receiver work — connect is sender-side only. Smallest change; validates that the shared envelope types work cross-package.
2. **`@1sat/extension`** — `createChromeCWIReceiver` in [background.ts](/Users/davidcase/Source/1sat/1sat-sdk/packages/extension/src/background.ts) for BRC-100 methods; keep its RpcMethod handler for 1Sat-specific methods on the same channel (or decide to split — see Open Question).
3. **yours-wallet** — `createChromeCWIReceiver` in [background.ts:841-898](/Users/davidcase/Source/1sat/yours-wallet/src/background.ts#L841-L898) replacing the `CWIEventName` switch. Content-script allowlist becomes `isCWIEventName(request.method)` imported from `@1sat/wallet`. Delete yours-wallet's duplicate `CustomListenerName` / `RequestEventDetail`. Keep permission system, noAuthRequired handling, and popup lifecycle as upstream middleware.
4. **sigma-auth** — wire `createSigmaCWIReceiver` into the existing CWI iframe host (`/signer` page); route the custom call registry through the `onCustomMessage` hook or a wrapped `WalletInterface`.
5. **1sat-website** — wire `createWebCWIReceiver` into the `/wallet/cwi` iframe host page.

Each migration plan captures the wallet-specific policy that must survive the change. Written when we're ready to pick the first one up.


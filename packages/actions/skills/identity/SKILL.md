---
name: identity
description: "This skill should be used when working with on-chain BAP identity — publishing a wallet's identity, rotating the signing key, reading or updating the profile, or posting on-chain social content. Triggers on 'BAP identity', 'publish identity', 'rotate key', 'identity rotation', 'update profile', 'get profile', 'BAP profile', 'social post', 'BSocial', or 'on-chain identity'. Uses @1sat/actions identity and social modules."
---

# Identity

Publish and manage on-chain BAP identity, profile, and identity-adjacent social posts using `@1sat/actions`.

All identity records are signed with AIP using the wallet's `identity-{N}` key hierarchy (protocolID `[1, "sigma"]`, keyID `identity-{N}`). The BAP ID is derived deterministically from `identity-0`, so any wallet bound to the same identity key resolves the same BAP ID. ID and profile outputs land in the `bap` basket.

## Calling Pattern

```typescript
import { createContext, publishIdentity } from '@1sat/actions'

// wallet is positional; options (including services) second
const ctx = createContext(wallet, { services })
const result = await publishIdentity.execute(ctx, {})
```

## Actions

| Action | Description |
|--------|-------------|
| `publishIdentity` | Publish the initial BAP ID record (seq:1) |
| `rotateIdentity` | Rotate to the next signing key |
| `updateProfile` | Set/update the profile (ALIAS); creates ID first if needed |
| `getProfile` | Read the current profile from the wallet |
| `createSocialPost` | Post on-chain BSocial content signed with the identity |

## Publish Identity

Derives `identity-0` (root key), computes the BAP ID, and publishes the ID record signed by `identity-0`. The record declares `identity-1` as the current signing key. Returns an error if an identity already exists.

The input is just `ActionOptions` — there is no `signedScript` parameter. The locking script is built and AIP-signed internally.

```typescript
import { createContext, publishIdentity } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await publishIdentity.execute(ctx, {})
// optional: publishIdentity.execute(ctx, { fundingProvider })

if (result.error) {
  // e.g. 'identity-exists: already published'
} else {
  console.log('BAP ID:', result.bapId)
  console.log('txid:', result.txid)
}
```

```typescript
// Input: ActionOptions
interface ActionOptions {
  fundingProvider?: FundingProvider
}

// Response: IdentityResponse
interface IdentityResponse {
  txid?: string
  tx?: number[]      // AtomicBEEF
  bapId?: string
  error?: string
}
```

The ID output is tagged `type:id`, `bapId:<id>`, `seq:1` in the `bap` basket.

## Rotate Identity

Finds the current signing key (highest `seq:` tag), derives `identity-{N+1}`, and publishes a new ID record declaring the new key, signed by the outgoing key. Previous ID outputs are relinquished.

```typescript
import { createContext, rotateIdentity } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await rotateIdentity.execute(ctx, {})

if (result.error) {
  // e.g. 'no-identity: publish identity first'
} else {
  console.log('Rotated. txid:', result.txid)
}
```

Input is `ActionOptions`; response is `IdentityResponse`. The new ID output is tagged `type:id`, `bapId:<id>`, `seq:<N+1>`.

## Update Profile

Publishes a BAP ALIAS with Schema.org profile data. If no identity exists yet, it creates the ID record (seq:1) and the ALIAS in a single transaction. If the identity exists, it updates only the ALIAS, signed with the current key. Previous alias outputs are relinquished.

```typescript
import { createContext, updateProfile } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await updateProfile.execute(ctx, {
  profile: {
    '@type': 'Person',
    name: 'Alice',
    description: 'BSV builder',
  },
})

console.log('BAP ID:', result.bapId, 'txid:', result.txid)
```

```typescript
// Input: UpdateProfileRequest
interface UpdateProfileRequest extends ActionOptions {
  /** Schema.org profile data, e.g. { "@type": "Person", "name": "Alice" } */
  profile: Record<string, unknown>
}

// Response: IdentityResponse
```

The ALIAS output is tagged `type:alias`, `bapId:<id>`, `publishedAt:<ms>` in the `bap` basket.

## Get Profile

Reads the current profile from the `bap` basket by parsing the newest ALIAS output's OP_RETURN. Stale duplicate alias outputs are relinquished automatically.

```typescript
import { createContext, getProfile } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await getProfile.execute(ctx, {})

if (result.error) {
  // e.g. 'no-profile: no alias output in wallet'
} else {
  console.log(result.bapId, result.profile)
}
```

```typescript
// Input: Record<string, never>  (pass {})

// Response: ProfileResponse
interface ProfileResponse {
  bapId?: string
  profile?: Record<string, unknown>
  error?: string
}
```

## Create Social Post

Publishes an on-chain BSocial post (B:// content + MAP attribution + AIP) signed with the wallet's BAP identity. The output lands in the `bsocial` basket.

```typescript
import { createContext, createSocialPost } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const result = await createSocialPost.execute(ctx, {
  app: '1sat-website',
  content: 'gm from BSV',
  contentType: 'text/markdown',   // optional, defaults to text/plain
  tags: ['bsv', 'gm'],            // optional
})

console.log('Posted. txid:', result.txid)
```

```typescript
// Input: CreateSocialPostRequest
interface CreateSocialPostRequest extends ActionOptions {
  /** Application name for MAP attribution (e.g. 'bsv-mcp', '1sat-website') */
  app: string
  /** Post content (text) */
  content: string
  /** Defaults to 'text/plain' */
  contentType?: 'text/plain' | 'text/markdown'
  tags?: string[]
}

// Response: SocialResponse
interface SocialResponse {
  txid?: string
  tx?: number[]
  error?: string
}
```

Output tags follow MAP fields: `app:<app>`, `type:post`, and `tag:<value>` for each supplied tag.

## Storage

| Basket | Holds |
|--------|-------|
| `bap` | ID records (`type:id`) and profile aliases (`type:alias`) |
| `bsocial` | Social posts and other BSocial actions |

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```

All actions broadcast transactions and need `services` in the context. For an attestation action (`attest`) and multi-device address/message coordination, see `../sync-cosign/SKILL.md`.

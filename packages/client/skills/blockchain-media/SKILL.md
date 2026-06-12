---
name: blockchain-media
description: "This skill should be used when accessing media inscribed in BSV transactions — retrieving on-chain images/videos/files, reading ORDFS content/metadata, or extracting inscribed ordinals. Triggers on 'extract inscription', 'download ordinal', 'get on-chain file', 'ORDFS content', 'txex', 'blockchain media', or 'inscribed content'. Covers SDK service access (ctx.services.ordfs.getMetadata/getContent), the ORDFS HTTP gateway, and the external txex CLI. The SDK has no dedicated extraction action."
allowed-tools: "Bash(bun:*)"
---

# Extract Blockchain Media

Access media inscribed in BSV transactions. There is **no dedicated extraction action** exported by the SDK. Content is reached one of three ways, in order of how much machinery each needs:

| Layer | What | Best for |
|-------|------|----------|
| **SDK service** | `ctx.services.ordfs.getMetadata()` / `getContent()` (the `OrdfsClient`) | In-process access from `@1sat/client` / `@1sat/actions` code |
| **ORDFS HTTP gateway** | Plain `fetch` against the gateway endpoints | Browser/app embedding, streaming, no SDK dependency |
| **txex CLI** | External `txex` binary that writes files to disk | Raw extraction, offline archival, batch processing |

## SDK: service-level access (`ctx.services.ordfs`)

The SDK exposes ORDFS through the `OrdfsClient` at `ctx.services.ordfs`. There is no exported "extract" action — these are the actual methods (`packages/client/src/services/OrdfsClient.ts`):

```typescript
// Metadata for an inscription. Pass seq -2 to resolve to the origin.
const metadata = await ctx.services.ordfs.getMetadata(outpoint, -2)
metadata.contentType // e.g. 'image/png'
metadata.origin      // origin outpoint
metadata.map         // MAP fields, if present

// Raw content bytes + parsed response headers.
const { data, headers } = await ctx.services.ordfs.getContent(origin)
// data: Uint8Array, headers.contentType: string

// Just the URL (for img/video tags) without fetching.
const url = ctx.services.ordfs.getContentUrl(outpoint)

// Batch metadata for many outpoints in one request.
const byOutpoint = await ctx.services.ordfs.bulkMetadata([op1, op2])
```

This is how the ordinals actions themselves resolve content type, origin, and MAP names — e.g. `getMetadata(outpoint, -2)` and `getContent(origin)` in `packages/actions/src/ordinals/index.ts`.

## ORDFS HTTP gateway (no SDK)

For browser or non-SDK access, hit the gateway directly. `OrdfsClient` serves content from `/content` at the host root and metadata under the API prefix (`/1sat/ordfs/...` on api.1sat.app):

```typescript
// Content by outpoint (txid_vout) — root-level, ordfs-protocol compatible
const url = 'https://api.1sat.app/content/abc123...def456_0'

// 1sat-stack content proxy
const url = 'https://api.1sat.app/1sat/content/abc123...def456_0'

// Stream content
const url = 'https://api.1sat.app/1sat/ordfs/stream/abc123...def456_0'

// Metadata only
const url = 'https://api.1sat.app/1sat/ordfs/metadata/abc123...def456_0'

// Public ordfs.network gateway
const url = 'https://ordfs.network/abc123...def456_0'

const res = await fetch(url)
const contentType = res.headers.get('content-type') // e.g. 'image/png'
const data = await res.arrayBuffer()
```

The gateway serves correct `Content-Type` headers, so URLs work directly in `<img>`, `<video>`, and `<audio>` tags.

## txex CLI (external tool)

`txex` is a **separate, third-party CLI** (not part of this SDK) that extracts inscribed files to disk:

```bash
# Install
bun add -g txex

# Extract all media from a transaction
txex <txid>

# Extract to a specific output directory
txex <txid> -o /path/to/output
```

It writes images (PNG/JPG/GIF/WEBP), video (MP4/WEBM), audio (MP3/WAV/OGG), text/JSON/Markdown, and any binary data, with auto-detected extensions.

This skill ships a thin convenience wrapper that just shells out to `txex` (it is not part of the SDK runtime and exports no action):

```bash
bun run scripts/extract.ts <txid> [output-dir]
```

## Common Use Cases

1. **View NFT images**: `getContentUrl()` or a gateway URL in `<img src="...">`
2. **Read content in code**: `ctx.services.ordfs.getContent(origin)` → `Uint8Array`
3. **Inspect type/origin/MAP**: `ctx.services.ordfs.getMetadata(outpoint, -2)`
4. **Archive media locally**: batch extract with `txex`
5. **Content verification**: check what's actually inscribed on-chain

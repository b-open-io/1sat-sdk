---
name: extract-blockchain-media
description: "This skill should be used when extracting media files from BSV blockchain transactions — downloading inscribed ordinals, retrieving on-chain images/videos/files, or accessing ORDFS content. Triggers on 'extract inscription', 'download ordinal', 'get on-chain file', 'ORDFS content', 'txex', 'blockchain media', or 'inscribed content'. Uses txex CLI for raw extraction, ORDFS gateway for HTTP access."
allowed-tools: "Bash(bun:*)"
---

# Extract Blockchain Media

Extract media files from BSV blockchain transactions using `txex` CLI or access them via the ORDFS gateway.

## Two Approaches

| Method | Best For | How |
|--------|----------|-----|
| **txex CLI** | Raw extraction, offline archival, batch processing | `txex <txid>` — downloads files to disk |
| **ORDFS Gateway** | HTTP access, embedding in apps, streaming | `https://ordfs.network/<outpoint>` or `https://api.1sat.app/1sat/content/<path>` |

## txex CLI

```bash
# Install
bun add -g txex

# Extract all media from a transaction
txex <txid>

# Extract to specific output directory
txex <txid> -o /path/to/output
```

### Using the Skill Script

```bash
bun run /path/to/skills/extract-blockchain-media/scripts/extract.ts <txid> [output-dir]
```

### What Gets Extracted

- Images (PNG, JPG, GIF, WEBP)
- Videos (MP4, WEBM)
- Audio files (MP3, WAV, OGG)
- Text/JSON/Markdown data
- Any binary data inscribed in the transaction

Files are saved with auto-detected extensions based on content type.

## ORDFS Gateway (HTTP Access)

For programmatic or browser access, use the ORDFS gateway instead of extracting to disk:

```typescript
// By outpoint (txid_vout)
const url = 'https://ordfs.network/abc123...def456_0'

// Via 1sat-stack
const url = 'https://api.1sat.app/1sat/content/abc123...def456_0'

// Stream content
const url = 'https://api.1sat.app/1sat/ordfs/stream/abc123...def456_0'

// Get metadata only
const url = 'https://api.1sat.app/1sat/ordfs/metadata/abc123...def456_0'

const res = await fetch(url)
const contentType = res.headers.get('content-type') // e.g., 'image/png'
const data = await res.arrayBuffer()
```

ORDFS serves content with correct `Content-Type` headers, making it suitable for `<img>`, `<video>`, and `<audio>` tags directly.

## Common Use Cases

1. **View NFT Images**: Extract or fetch ordinal inscription content
2. **Embed in Apps**: Use ORDFS URLs in `<img src="...">` tags
3. **Archive Media**: Batch extract ordinals locally with txex
4. **Content Verification**: Check what's actually inscribed on-chain
5. **Collection Export**: Extract all inscriptions from a set of txids

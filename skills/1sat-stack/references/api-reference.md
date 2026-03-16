# 1sat-stack API Reference

Full endpoint reference for the 1sat-stack unified BSV indexing API.

**Base URL:** `https://api.1sat.app/1sat`
**Source:** https://github.com/b-open-io/1sat-stack
**Swagger:** `https://api.1sat.app/1sat/swagger` (if enabled on hosted instance)

---

## TXO (Transaction Output) Endpoints

### GET /txo/{outpoint}

Fetch a single indexed transaction output.

**Path params:**
- `outpoint` — `txid.vout` format (e.g., `abc123...0`)

**Query params:**
- `tags` — include tag data (comma-separated)
- `events` — include event list
- `spend` — include spend txid
- `sats` — include satoshi amount
- `block` — include block height/index

**Response:**
```json
{
  "outpoint": "txid.0",
  "satoshis": 1000,
  "score": 123456.0,
  "spend": null,
  "data": { "inscription": {...}, "bsv21": null },
  "events": ["own:1A1zP1...", "ins:..."]
}
```

---

### GET /txo/tx/{txid}

All indexed outputs for a transaction.

**Response:** Array of TXO objects.

---

### POST /txo/search

Search outputs with filters.

**Body:**
```json
{
  "owner": "1A1zP1...",
  "tag": "inscription",
  "limit": 100,
  "offset": 0,
  "spend": false
}
```

Tags: `inscription`, `bsv21`, `p2pkh`, `ordlock`, `lock`, `cosign`, `1sat`

**Response:** Array of TXO objects.

---

### POST /txo/outpoints

Bulk fetch multiple outpoints.

**Body:** `["txid1.0", "txid2.1", ...]`

---

### POST /txo/spends

Check spend status of multiple outpoints.

**Body:** `["txid.0", "txid.1"]`

**Response:** Object mapping outpoint → spending txid (null if unspent)

---

## Owner Endpoints

### GET /owner/{owner}/txos

All unspent outputs for an owner (address or script hash).

**Query params:**
- `limit` — max results (default 100)
- `offset` — pagination offset
- `tag` — filter by tag

**Response:** Array of TXO objects with satoshis.

---

### GET /owner/{owner}/balance

Total satoshi balance for an owner.

**Response:**
```json
{ "satoshis": 150000 }
```

---

## BEEF Endpoints

### GET /beef/{txid}

Retrieve BEEF (BSV Envelope Format) for a transaction — raw tx + merkle proof.

**Response:** Binary BEEF data (application/octet-stream)

---

### GET /beef/{txid}/tx

Raw transaction bytes only (no proof).

**Response:** Binary transaction hex.

---

### GET /beef/{txid}/proof

Merkle proof bytes only.

---

## Arcade (Broadcasting) Endpoints

### POST /arcade/tx

Broadcast a single BEEF transaction to the BSV network.

**Headers:** `Content-Type: application/octet-stream`

**Body:** BEEF binary data

**Response:**
```json
{
  "txid": "abc123...",
  "status": "ACCEPTED"
}
```

**Statuses:** `ACCEPTED`, `SEEN_IN_ORPHAN_MEMPOOL`, `DOUBLE_SPEND_ATTEMPTED`, `REJECTED`

---

### POST /arcade/txs

Broadcast multiple BEEF transactions in one request.

**Body:** Array of BEEF binary objects (JSON with base64 fields)

---

### GET /arcade/tx/{txid}

Check broadcast status of a transaction.

---

### GET /arcade/policy

Returns fee rates and transaction limits.

**Response:**
```json
{
  "feePerKb": 500,
  "maxScriptSizePolicy": 1000000,
  "maxTxSizePolicy": 10000000
}
```

---

### GET /arcade/events/{callbackToken}

SSE stream of broadcast status updates for transactions associated with a callback token.

---

## BSV21 Token Endpoints

### GET /bsv21/{tokenId}

Token details for a BSV21 fungible token.

**Path params:**
- `tokenId` — txid of the BSV21 deploy transaction

**Response:**
```json
{
  "token": {
    "p2pkh": "1A1zP1...",
    "sym": "MYTOKEN",
    "icon": "outpoint",
    "dec": 8,
    "amt": "21000000"
  },
  "status": { ... }
}
```

---

### GET /bsv21/{tokenId}/{lockType}/{address}/balance

Token balance for a specific address.

**Path params:**
- `tokenId` — BSV21 deploy txid
- `lockType` — `p2pkh` (most common) or `cosign`
- `address` — BSV address

**Response:**
```json
{ "balance": "1000000", "tick": "MYTOKEN", "dec": 8 }
```

---

### GET /bsv21/{tokenId}/{lockType}/{address}/unspent

Unspent BSV21 token UTXOs for an address.

**Response:** Array of TXO objects with BSV21 data.

---

### GET /bsv21/{tokenId}/{lockType}/{address}/history

Transaction history for an address's token balance.

---

### GET /bsv21/{tokenId}/{lockType}/balance

Total token supply in circulation for a lockType.

---

### GET /bsv21/{tokenId}/outputs

All token outputs (paginated).

---

### GET /bsv21/{tokenId}/tx/{txid}

Token-related data for a specific transaction.

---

### GET /bsv21/lookup

Discover BSV21 tokens.

**Query params:**
- `sym` — search by token symbol/ticker
- `id` — search by token ID prefix

---

## ORDFS (On-chain Content) Endpoints

### GET /content/{path}

Serve ordinal/ORDFS content by path. The path can be:
- An outpoint: `txid.0`
- A domain path: `domain/file.png`

Returns the file with the correct Content-Type header.

---

### GET /ordfs/stream/{outpoint}

Stream ORDFS content from a specific transaction output.

**Path params:**
- `outpoint` — `txid.vout` format

---

### GET /ordfs/metadata/{path}

Get ORDFS file metadata (content type, size, timestamp) without fetching the content.

---

## BAP Identity Endpoints

### POST /bap/identity/get

Resolve a BAP identity from an address or identity key.

**Body:**
```json
{ "address": "1A1zP1..." }
```
or
```json
{ "idKey": "pubkeyhex..." }
```

---

### GET /bap/identity/search

Search identities by query.

**Query params:**
- `q` — search string

---

### GET /bap/profile/{bapId}

Full profile for a BAP identity ID.

---

## Real-time Streaming Endpoints

### GET /sse/{topics}

Subscribe to Server-Sent Events for one or more topics.

**Path params:**
- `topics` — comma-separated topic names (e.g., `tm_1sat,tm_bsv21`)

**Event format:**
```
data: {"outpoint":"txid.0","topic":"tm_1sat",...}
```

---

### GET /chaintracks/tip/stream

SSE stream of new block tip events.

---

## Chain Info Endpoints

### GET /chaintracks/height

Current block height.

### GET /chaintracks/tip

Latest block header with hash, height, and timestamp.

### GET /health

Server health check — returns `200 OK` if all services are running.

---

## Overlay Engine Endpoints

### POST /overlay/submit

Submit a tagged BEEF transaction to the overlay engine.

**Body:**
```json
{
  "beef": "hexBEEF...",
  "topics": ["tm_1sat", "tm_bsv21"]
}
```

---

### POST /overlay/lookup

Query overlay lookup services.

**Body:**
```json
{
  "service": "ls_1sat",
  "query": { "owner": "1A1zP1..." }
}
```

---

## Paymail Endpoints

### GET /.well-known/bsvalias

BSvalias capability document for paymail support.

### GET /v1/bsvalias/id/{paymail}

Resolve a paymail address to a BSV address.

### POST /v1/bsvalias/receive-beef/{paymail}

Send a BEEF transaction to a paymail address.

---

## Error Responses

All error responses use a consistent format:

```json
{
  "error": {
    "message": "description of the error",
    "code": "ERROR_CODE"
  }
}
```

Common HTTP status codes:
- `400` — Invalid request parameters
- `404` — Resource not found
- `429` — Rate limit exceeded
- `500` — Internal server error

# 1sat-stack Migration Guide

This guide helps you migrate from multiple BSV indexers to the unified 1sat-stack API.

## Before: Multiple APIs

```typescript
// WhatsOnChain for transactions
const wocApi = 'https://api.whatsonchain.com/v1/bsv/main';
const tx = await fetch(`${wocApi}/tx/${txid}/hex`);
const txData = await fetch(`${wocApi}/tx/${txid}`);

// GorillaPool for ordinals
const ordApi = 'https://ordinals.gorillapool.io/api';
const inscription = await fetch(`${ordApi}/inscriptions/${id}`);

// Separate BSV20/21 token APIs
const tokenApi = 'https://sometoken.api';
const tokenInfo = await fetch(`${tokenApi}/token/${tick}`);

// ORDFS via different gateway
const ordfsApi = 'https://ordfs.network';
const content = await fetch(`${ordfsApi}/${outpoint}`);

// JungleBus for streaming
const jbApi = 'wss://junglebus.gorillapool.io';
// Complex WebSocket setup...
```

## After: Single Unified API

```typescript
// One API for everything
const api = 'https://api.1sat.app/1sat';

// Transaction with all overlay data
const tx = await fetch(`${api}/tx/${txid}?include=inscriptions,tokens,ordfs`);

// Direct inscription access
const inscription = await fetch(`${api}/inscriptions/${id}`);

// Token data in same API
const tokenInfo = await fetch(`${api}/tokens/${tick}`);

// ORDFS content directly
const content = await fetch(`${api}/ordfs/${outpoint}`);

// Streaming built-in
const stream = new EventSource(`${api}/stream?address=${address}`);
```

## Key Improvements

### 1. Consolidated Responses

Before:
```typescript
// Multiple requests to different APIs
const tx = await fetch(`${wocApi}/tx/${txid}`);
const inscriptions = await fetch(`${ordApi}/tx/${txid}/inscriptions`);
const tokens = await fetch(`${tokenApi}/tx/${txid}/tokens`);

// Manual correlation
const fullData = {
  ...tx,
  inscriptions: inscriptions || [],
  tokens: tokens || []
};
```

After:
```typescript
// Single request with all data
const response = await fetch(`${api}/tx/${txid}?include=inscriptions,tokens`);
const fullData = response.data; // Everything included
```

### 2. Unified Search

Before:
```typescript
// Search each service separately
const txSearch = await searchWOC(query);
const ordSearch = await searchOrdinals(query);
const tokenSearch = await searchTokens(query);

// Combine results manually
const results = [...txSearch, ...ordSearch, ...tokenSearch];
```

After:
```typescript
// Single search across all data types
const results = await fetch(`${api}/search?q=${query}`);
// Returns transactions, addresses, inscriptions, tokens, etc.
```

### 3. Consistent Data Format

Before:
```typescript
// Different formats from each API
// WOC format
{
  "txid": "...",
  "blockhash": "...",
  "confirmations": 100
}

// Ordinals format
{
  "inscription_id": "...",
  "tx_id": "...",
  "block_hash": "..."
}
```

After:
```typescript
// Consistent format across all endpoints
{
  "data": {
    "txid": "...",
    "blockHash": "...",
    "confirmations": 100,
    "inscriptions": [...]
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

### 4. Batch Operations

Before:
```typescript
// Multiple individual requests
const txs = [];
for (const txid of txids) {
  const tx = await fetch(`${wocApi}/tx/${txid}`);
  txs.push(tx);
}
```

After:
```typescript
// Single batch request
const batch = await fetch(`${api}/batch`, {
  method: 'POST',
  body: JSON.stringify({
    requests: txids.map(txid => ({
      method: 'GET',
      path: `/tx/${txid}`
    }))
  })
});
```

## Common Migrations

### Get Address Balance & History

Before:
```typescript
// WhatsOnChain
const balance = await fetch(`${wocApi}/address/${address}/balance`);
const history = await fetch(`${wocApi}/address/${address}/history`);
const unspent = await fetch(`${wocApi}/address/${address}/unspent`);
```

After:
```typescript
// 1sat-stack
const balance = await fetch(`${api}/addresses/${address}/balance`);
const history = await fetch(`${api}/addresses/${address}/history`);
const utxos = await fetch(`${api}/addresses/${address}/utxos`);
```

### Get Inscription Content

Before:
```typescript
// GorillaPool Ordinals
const metadata = await fetch(`${ordApi}/inscriptions/${id}`);
const txid = metadata.txid;
const content = await fetch(`${ordApi}/content/${txid}`);
```

After:
```typescript
// 1sat-stack
const metadata = await fetch(`${api}/inscriptions/${id}`);
const content = await fetch(`${api}/inscriptions/${id}/content`);
```

### Token Operations

Before:
```typescript
// Various token APIs
const bsv20Info = await fetch(`${bsv20Api}/token/${tick}`);
const bsv21Info = await fetch(`${bsv21Api}/token/${contractId}`);
const holders = await fetch(`${tokenApi}/holders/${tick}`);
```

After:
```typescript
// 1sat-stack unified tokens
const tokenInfo = await fetch(`${api}/tokens/${tick}`);
const holders = await fetch(`${api}/tokens/${tick}/holders`);
// Works for BSV20, BSV21, and other token types
```

## Error Handling

The unified API uses consistent error responses:

```typescript
try {
  const response = await fetch(`${api}/tx/${txid}`);

  if (!response.ok) {
    const error = await response.json();
    // Consistent error format
    console.error(error.error.message);
    console.error(error.error.code);
  }
} catch (e) {
  // Network errors
}
```

## Rate Limiting

1sat-stack has generous rate limits:
- Public: 100 requests/minute
- Authenticated: 1000 requests/minute

Add API key for higher limits:
```typescript
const response = await fetch(`${api}/tx/${txid}`, {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  }
});
```

## Best Practices

1. **Use includes parameter**: Get all related data in one request
   ```typescript
   ?include=inscriptions,tokens,ordfs
   ```

2. **Cache static data**: Transactions and blocks don't change after confirmation

3. **Use streaming for real-time**: Instead of polling
   ```typescript
   const events = new EventSource(`${api}/stream?address=${address}`);
   ```

4. **Handle pagination**: For large result sets
   ```typescript
   const page1 = await fetch(`${api}/inscriptions?page=1&limit=100`);
   const total = page1.meta.pagination.total;
   ```

5. **Batch when possible**: Reduce request count
   ```typescript
   const batch = await fetch(`${api}/batch`, { ... });
   ```
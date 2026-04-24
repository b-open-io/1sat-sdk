# spv-store to wallet-toolbox Query Mapping

This document outlines how spv-store's TxoLookup search patterns map to wallet-toolbox's listOutputs basket/tag system for the yours-wallet integration.

## Background

spv-store currently uses a hierarchical query system via [TxoLookup](spv-store/src/models/search.ts#L9-L40):
```typescript
new TxoLookup(tag, id?, value?, owner?, includeSpent?)
```

wallet-toolbox uses a basket + tag system via [listOutputs](wallet-toolbox/src/sdk/validationHelpers.ts#L931-L944):
```typescript
listOutputs({
  basket: string,
  tags?: string[],
  tagQueryMode?: 'all' | 'any'
})
```

## Core Design Decisions

### Baskets vs Tags
- **Baskets** are assigned per-output via [ValidCreateActionOutput.basket](wallet-toolbox/src/sdk/validationHelpers.ts#L305) or [ValidBasketInsertion.basket](wallet-toolbox/src/sdk/validationHelpers.ts#L513)
- Each output can have **one basket** and **multiple tags**
- **Decision:** Use baskets for primary categorization (indexer tag), use tags for hierarchical filtering (event data)

### Default Basket
- **Funding outputs** use the default basket (either `basket: ""` or unnamed - TBD during implementation)
- This aligns with wallet-toolbox's standard for identifying funding UTXOs
- No custom basket name needed for basic P2PKH outputs

---

## Query Pattern Mappings

All 8 current TxoLookup patterns in yours-wallet mapped to wallet-toolbox queries:

### Pattern 1: Funding UTXOs

**Current spv-store:**
```typescript
// Location: Bsv.service.ts:407
fundingTxos = async () => {
  const results = await this.oneSatSPV.search(new TxoLookup('fund'), TxoSort.ASC, 0);
  return results.txos;
}
```

**wallet-toolbox mapping:**
- **Basket:** Default basket (empty/unnamed)
- **Tags:** None
- **Query:** `listOutputs({ basket: "" })`
- **Indexer:** [FundIndexer](spv-store/src/indexers/fund.ts) identifies P2PKH outputs to owned addresses
- **Notes:** No tags needed - simple basket query

---

### Pattern 2: Locked UTXOs

**Current spv-store:**
```typescript
// Location: Bsv.service.ts:85
getLockedTxos = async () => {
  const lockTxos = await this.oneSatSPV.search(new TxoLookup('lock'));
  return lockTxos.txos.filter((txo) => !txo.data.insc);
}
```

**wallet-toolbox mapping:**
- **Basket:** `"lock"`
- **Tags:** None
- **Query:** `listOutputs({ basket: "lock" })`
- **Indexer:** [LockIndexer](spv-store/src/indexers/lock.ts) identifies time-locked scripts
- **Notes:**
  - Post-filter `!txo.data.insc` handled by basket assignment
  - If output is both locked AND inscribed, categorize as inscription (not lock)
  - Lock metadata (until height) stored in `customInstructions` or separate field

---

### Pattern 3: All Ordinals (Paginated)

**Current spv-store:**
```typescript
// Location: Ordinal.service.ts:43
getOrdinals = async (from = ''): Promise<PaginatedOrdinalsResponse> => {
  const ordinals = await this.oneSatSPV.search(
    new TxoLookup('origin', 'type'),
    TxoSort.DESC,
    50,
    from
  );
  const mapped = ordinals.txos
    .filter((o) =>
      o.data?.origin?.data?.insc?.file?.type !== 'panda/tag' &&
      o.data?.origin?.data?.insc?.file?.type !== 'yours/tag'
    )
    .map(mapOrdinal);
  return { ordinals: mapped, from: ordinals.nextPage };
}
```

**wallet-toolbox mapping:**
- **Basket:** `"1sat"`
- **Tags:** `["type:" + mimeType]` (e.g., `"type:image/jpeg"`)
- **Query:** `listOutputs({ basket: "1sat" })`
- **Indexer:** OriginIndexer identifies 1Sat ordinal inscriptions
- **Notes:**
  - All ordinals go in "1sat" basket
  - MIME type stored as tag for filtering
  - Post-filter for panda/yours tags done client-side or excluded during tag creation
  - Pagination concerns deferred for now

---

### Pattern 4: Ordinals Filtered by MIME Type

**Current spv-store:**
```typescript
// Location: background.ts:538-542
const lookup = message?.params?.mimeType
  ? new TxoLookup('origin', 'type', message.params.mimeType)
  : new TxoLookup('origin');

const result = await oneSatSPV.search(lookup, TxoSort.DESC, 0);
```

**wallet-toolbox mapping:**
- **Basket:** `"1sat"`
- **Tags:**
  - All ordinals: None
  - Specific type: `["type:image/jpeg"]`
- **Query:**
  - All: `listOutputs({ basket: "1sat" })`
  - Filtered: `listOutputs({ basket: "1sat", tags: ["type:image/jpeg"] })`
- **Notes:** Extends Pattern 3 with optional MIME type filtering

---

### Pattern 5: Ordinals with Pagination (Provider API)

**Current spv-store:**
```typescript
// Location: background.ts:550-555
const results = await oneSatSPV.search(
  lookup,
  TxoSort.DESC,
  message.params.limit || 50,
  message.params.from || '',
);
```

**wallet-toolbox mapping:**
- **Same as Pattern 4** with configurable pagination
- Uses same basket/tag approach
- Pagination implementation TBD

---

### Pattern 6: Panda Derivation Tags

**Current spv-store:**
```typescript
// Location: serviceHelpers.ts:30-34
const ordsWithPandaTag = await oneSatSPV.search(
  new TxoLookup('origin', 'type', 'panda/tag', keys.identityAddress),
  TxoSort.DESC,
  0,
);
```

**wallet-toolbox mapping:**
- **Basket:** `"1sat"`
- **Tags:** `["type:panda/tag", "owner:" + identityAddress]`
- **Query:** `listOutputs({ basket: "1sat", tags: ["type:panda/tag", "owner:1ABC..."], tagQueryMode: "all" })`
- **Notes:**
  - Full hierarchical query: tag:id:value:owner
  - Used for BIP32 derivation tag discovery
  - Requires both type AND owner match (tagQueryMode: "all")
  - Kept in "1sat" basket with regular ordinals for simplicity

---

### Pattern 7: Yours Derivation Tags

**Current spv-store:**
```typescript
// Location: serviceHelpers.ts:36-40
const ordsWithYoursTag = await oneSatSPV.search(
  new TxoLookup('origin', 'type', 'yours/tag', keys.identityAddress),
  TxoSort.DESC,
  0,
);
```

**wallet-toolbox mapping:**
- **Basket:** `"1sat"`
- **Tags:** `["type:yours/tag", "owner:" + identityAddress]`
- **Query:** `listOutputs({ basket: "1sat", tags: ["type:yours/tag", "owner:1ABC..."], tagQueryMode: "all" })`
- **Notes:** Same as Pattern 6 but for yours/tag type

---

### Pattern 8: Payment UTXOs (Provider API)

**Current spv-store:**
```typescript
// Location: background.ts:651
const results = await oneSatSPV.search(new TxoLookup('fund'), undefined, 0);
const utxos = results.txos.map((txo) => ({
  txid: txo.outpoint.txid,
  vout: txo.outpoint.vout,
  satoshis: Number(txo.satoshis),
  script: Buffer.from(txo.script).toString('hex'),
}));
```

**wallet-toolbox mapping:**
- **Same as Pattern 1** - funding UTXOs
- Query from default basket
- Maps to simple UTXO format for provider API

---

## Summary

### Basket Assignments

| spv-store Indexer Tag | wallet-toolbox Basket | Notes |
|----------------------|----------------------|-------|
| `fund` | Default (empty) | Standard P2PKH funding outputs |
| `lock` | `"lock"` | Time-locked outputs |
| `origin` | `"1sat"` | All 1Sat ordinals and inscriptions |

**Total baskets:** 3 (default, lock, 1sat)

### Tag Patterns

| Tag Pattern | Purpose | Example |
|-------------|---------|---------|
| `type:{value}` | MIME type filtering for ordinals | `type:image/jpeg`, `type:panda/tag` |
| `owner:{address}` | Owner filtering for derivation tags | `owner:1ABC...` |

### Query Modes

- **Simple basket query:** No tags, just basket
  - Example: `listOutputs({ basket: "lock" })`
- **Basket + single tag:** Filter by one attribute
  - Example: `listOutputs({ basket: "1sat", tags: ["type:image/jpeg"] })`
- **Basket + multiple tags (AND):** Filter by multiple attributes
  - Example: `listOutputs({ basket: "1sat", tags: ["type:panda/tag", "owner:1ABC"], tagQueryMode: "all" })`

### Tag Query Modes

- **`tagQueryMode: "any"`** - Default, any tag can match
- **`tagQueryMode: "all"`** - All tags must match (used for owner + type filtering)

---

## Implementation Considerations

### Data Storage

1. **Basket assignment:** During output ingestion (internalizeAction), assign basket based on which indexer matches
2. **Tag creation:** Create tags for indexed events that need to be searchable
3. **Metadata storage:** Lock metadata (until height), inscription data stored in `customInstructions` or separate spv-store storage

### Indexer → Basket/Tag Mapping

When spv-store indexes an output:
1. Primary indexer determines **basket** assignment
2. Indexer events determine **tags** to create
3. If multiple indexers match, use priority:
   - Ordinals/Inscriptions (`origin`) > Locks (`lock`) > Funding (`fund`)

### Challenges Deferred

1. **Pagination:** wallet-toolbox uses offset-based, spv-store uses cursor-based
2. **Sorting:** Need to verify wallet-toolbox supports DESC by block height
3. **Rich data access:** Need access to `data.origin.data.insc` for mapOrdinal - may require keeping spv-store's indexed data storage

### Open Questions

1. How is the default basket represented in wallet-toolbox? (`basket: ""` or omitted?)
2. Does wallet-toolbox support sorting by block height/creation time?
3. Should we keep spv-store's TxoStorage for indexed data alongside wallet-toolbox for core output storage?

---

## Next Steps

1. Verify default basket representation in wallet-toolbox
2. Test basket/tag assignment during internalizeAction
3. Implement query translation layer: TxoLookup → listOutputs
4. Address pagination and sorting concerns
5. Determine storage strategy for rich indexed data (customInstructions vs separate storage)

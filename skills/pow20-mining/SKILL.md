---
name: pow20-mining
description: "This skill should be used when working with POW20 proof-of-work mineable BSV21 tokens — mining, deploying, building redeem transactions, submitting solutions, fetching token state, calculating difficulty, or building POW20 miners. Triggers on 'POW20', 'proof-of-work token', 'mine tokens', 'hash to mint', 'HashToMint', 'pow20-miner', 'mining difficulty', 'mine BSV21', 'token mining', or 'proof of work BSV'."
---

# POW20 Mining

Proof-of-work mineable BSV21 fungible tokens using sCrypt smart contracts on 1Sat Ordinals. The contract is a recursive covenant that enforces mining rules and token issuance on-chain.

## How It Works

A POW20 token is a stateful sCrypt covenant (`HashToMintBsv20` extending `BSV20V2` from `scrypt-ord`). Each mine spends the contract UTXO and creates a new one with reduced supply, plus a reward inscription to the miner.

The mining puzzle is SHA256d:
```
hash = SHA256(SHA256(outpoint_txid || nonce))
hash must have N leading zero nibbles (original) or bits (Runar variant)
```

## Quick Start — Mining an Existing Token

### 1. Find mineable tokens
```bash
Q=$(echo '{"insc":{"json":{"contract":"pow-20"}}}' | base64)
curl "https://ordinals.gorillapool.io/api/txos/search/unspent?q=${Q}&limit=10"
```

### 2. Get current mining target
```bash
curl "https://ordinals.gorillapool.io/api/inscriptions/{tokenId}/latest?script=true"
```

### 3. Mine
```
Preimage (64 bytes):
  Bytes 0-31:   Outpoint txid (32 bytes, byte-reversed)
  Bytes 32-39:  Nonce counter (uint64, little-endian)
  Bytes 40-47:  Worker thread ID (uint64, little-endian)
  Bytes 48-63:  Padding (zeros)

Solution = SHA256(SHA256(preimage))
Valid when: N leading zero nibbles where N = dynamic difficulty
```

### 4. Submit
Build redeem transaction and broadcast via Arcade:
```
POST https://api.1sat.app/1sat/arcade/tx
```

## APIs (verified by live testing)

### Token Discovery
```
GET https://ordinals.gorillapool.io/api/txos/search/unspent?q={base64}
  query = base64('{"insc":{"json":{"contract":"pow-20"}}}')
```

### Current Mining Target
```
GET https://ordinals.gorillapool.io/api/inscriptions/{tokenId}/latest?script=true
```

### Token State (1sat-stack)
```
GET https://api.1sat.app/1sat/bsv21/{tokenId}
GET https://api.1sat.app/1sat/bsv21/{tokenId}/p2pkh/{address}/balance
```

### Broadcasting
```
POST https://api.1sat.app/1sat/arcade/tx    (BEEF transaction)
```

### Real-time
```
GET https://api.1sat.app/1sat/sse/{tokenId}  (SSE stream)
```

## Difficulty

### Original (sCrypt) — Nibble-Based (16x per step)

| Supply Remaining | Extra Difficulty |
|-----------------|-----------------|
| 80-100% | +0 |
| 60-80% | +1 (16x) |
| 40-60% | +2 (256x) |
| 20-40% | +3 (4096x) |
| 0-20% | +4 (65536x) |

### Runar Variant — Bit-Based Linear (2x per step)
```
difficulty = startingDifficulty + (mined / totalSupply) * difficultyRange
```

## Transaction Building

### Redeem Transaction

**Input 0**: Contract UTXO
- Unlocking: `<rewardPkh> <nonce> <changeAmount> <changePKH> <txPreimage>`
- SIGHASH: `ANYONECANPAY | ALL | FORKID`

**Output 0**: Contract continuation (1 sat) — inscription + updated contract script
**Output 1**: Reward to miner (1 sat) — inscription + P2PKH
**Output 2+**: Change P2PKH

Contract verifies `hash256(all_outputs) === hashOutputs` from BIP-143 preimage.

### Without a BSV SDK (e.g., Zig)

1. **pow20-broadcaster** — submit nonce + payment, broadcaster builds tx
2. **Shell out to bun/node** — call `@bsv/sdk` via subprocess
3. **Minimal raw tx** — serialize + BIP-143 sighash + libsecp256k1 C FFI
4. **go-sdk C FFI** — Go exports C-compatible functions

## Implementations

| What | Language | URL |
|------|----------|-----|
| Contract (sCrypt) | TypeScript | https://github.com/danwag06/htm-contract |
| Contract (Runar) | TS/Zig | https://github.com/b-open-io/pow20-runar |
| Miner (Go) | Go | https://github.com/b-open-io/pow20-miner |
| Miner (Zig) | Zig | https://github.com/b-open-io/pow20-miner-zig |
| Protocol | — | https://protocol.pow20.io/ |

## Related Skills

- `1sat:1sat-stack` — API endpoints for token state and broadcasting
- `1sat:token-operations` — BSV21 token send/receive/balance
- `bsv-skills:smart-contracts` — Runar/sCrypt contract development
- `bsv-skills:bsv-standards` — BSV-21 inscription format details

# Plan: BRC-163 BSV-21 remittance (SDK)

Status: **In progress**  
Date: 2026-08-19  
Spec: Brandon #217 + polish PR — **no BRC commits until David reviews**

## Target shape

| Layer | Content |
|-------|---------|
| **CI** | Load-bearing: `id`, `amt`, `op`, `sym`, `dec`, `icon` + derivation when wallet-locked |
| **Tags** | Filters: `bsv21:<tokenId>` on tips; `bsv21:deploy` / `bsv21:auth` when applicable; `id:` if BRC-164 |
| **Read** | CI → tags (legacy) → deploy **outpoint** as token id |
| **Do not write** | `amt:` / `sym:` / `dec:` / `icon:` tags on new outs |

## Deploy (simplified — locked)

- Normal **createAction** deploy. Tag **`bsv21:deploy`** only (no `bsv21:<tokenId>` at build time).  
- CI: amt/op/sym/dec/icon + derivation; **id optional**.  
- **Balance / coin select:** deploy row token id = **that outpoint**.  
- Deploy UTXO for token T exists **alone** for T; once other tips exist, deploy is spent.  
- Selection for T: `bsv21:T` **or** deploy whose outpoint is T.  
- Optional self-transfer to stamp `bsv21:<T>` is UX only, not required for balance.  
- **No** module multi-step / fund basket / one-shot follow-up (parked).  

## Work

1. ~~Helper + send/change/buy/mint CI + filter tags~~ **Done**  
2. ~~Indexer filter tags only~~ **Done**  
3. ~~Balance/select deploy-as-outpoint + skip auth-only~~ **Done**  
4. ~~Deploy createAction: `bsv21:deploy` (+ auth) only; CI load-bearing, no tokenId tag~~ **Done**  
5. ~~Shared apply stamp (script + input carry → CI); load always plaintext CI~~ **Done**  
6. ~~Sweep / cosign delivery / internalize: filter tags; no p-labels on internalize~~ **Done**  
7. Spec blurb for 163 (review before any BRC commit)  
8. More tests + headed deploy smoke  

## Resume

1. Test-app: deploy → balance includes deploy tip → send from deploy  
2. Spec updates only after David reviews  


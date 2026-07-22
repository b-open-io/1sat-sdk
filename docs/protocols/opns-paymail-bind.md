# OpNS identity bind (PushDrop)

Portable name → identity on the **current name UTXO**. Constants in `@1sat/types`.

Host billing / paymail server are separate and not specified here.

## Script

Signed PushDrop on the OpNS name ordinal (`OPNS_BASKET`):

| Item | Value |
|------|--------|
| Protocol | `P1SAT_PROTOCOL` `[0, 'p 1sat']` |
| Counterparty | `anyone` |
| keyID | `opnsRegisterKeyId(inputOutpoint)` → `opns:{txid}_{vout}` of input spent to create this output |
| forSelf | `true` |
| fields[0] | identity pubkey bytes (33) |
| field-sig | yes (same derivation) |
| tag | `opns:published` |
| customInstructions.template | `pushdrop` |

## Verify

1. OpNS → latest outpoint for alias  
2. Load locking script  
3. `PushDrop.decode`  
4. idKey = fields[0]  
5. Re-derive lock pub: `KeyDeriver('anyone').derivePublicKey(protocol, keyID, idKey)`  
6. Match script lock pub + verify field-sig  

## Lifecycle

Register creates PushDrop. Transfer/list/burn/deregister spend it and re-lock without bind unless register again.

# MintFlow collection mint — schema, generator, worked example

## `mintInitSchema` (the deep-link / proposal payload)

Every field is optional; MintFlow fills gaps from wizard defaults.

| Field | Type | Notes |
|---|---|---|
| `version` | number | use `1` |
| `collectionName` | string | on-chain collection name |
| `description` | string | on-chain `subTypeData.description` |
| `collectionImage` | string (data URI) | inscribed as the collection ordinal's content (self path) |
| `totalQuantity` | int ≥ 1 | declared collection max supply |
| `royaltyPercentage` | string | `"0"`–`"7"`; secondary-sale royalty |
| `royaltyAddress` | string | destination; if omitted, defaults to the minting wallet's ordinal address |
| `hostingOption` | `"self"` \| `"hosted"` | self-mint from a wallet, or the $10 custodial path |
| `tiers[]` | `{ name, percentage, price?, features?[], image? }` | one per token type; **percentages must total 100** (become on-chain `rarityLabels`). `price`/`features` are display-only |
| `traits[]` | `{ name, values: [{ value, percentage }] }` | optional on-chain `traits` |
| `returnTo` | url | where MintFlow returns after minting |
| `theme` | record<string,string> | CSS custom properties to brand the wizard |

Tiers become the on-chain `rarityLabels`; per-item passes carry their tier, which is
what the access gate reads to map **tier → product_id**.

## Proposal file shape (for the `proposalUrl` path)

```json
{ "v": 1, "payload": { "kind": "mintflow-init", "version": 1, "init": { /* MintInitPayload */ } } }
```

Serve it with `Access-Control-Allow-Origin: *`; MintFlow fetches it client-side.

## Generator-script pattern

Encode a small `init` that points at the hosted proposal, and write the proposal
with all art embedded. base64url = standard base64 with `+/`→`-_` and `=` stripped.

```python
import base64, json
def b64url(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")
def data_uri(p):
    with open(p, "rb") as f: return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

init = {
  "version": 1,
  "collectionName": "…",
  "description": "…",
  "collectionImage": data_uri("cover-512.jpg"),
  "totalQuantity": 10000,
  "royaltyPercentage": "5",
  "royaltyAddress": "<product-fee-address>",
  "hostingOption": "self",
  "tiers": [ {"name":"…","percentage":30,"price":10,"features":["…"],"image":data_uri("tier-512.jpg")}, … ],
  "traits": [ {"name":"Edition","values":[{"value":"Genesis","percentage":"100"}]} ],
  "returnTo": "https://yoursite",
}
proposal = {"v":1, "payload":{"kind":"mintflow-init","version":1,"init":init}}
# write proposal to a CORS-served static path, then:
small = {"version":1, "proposalUrl":"https://yoursite/collections/x.json"}
link = f"https://mintflow.me/mint?init={b64url(json.dumps(small).encode())}&step=review"
```

## Worked example — bopen.ai Licenses

A license collection with **one token per product SKU** (Agent Master, five prompt
packs, Full Suite), 5% royalty to the product-fee address, self-mint. Full-bleed
1:1 pixel-art passes generated via `gemskills:generate-image`, embedded as 512px
JPEG data URIs. Reference implementation lives in the bopen-ai repo:
`scripts/build-mint-link.py` + `docs/bopen-licenses-collection.md`.

Access is payment-method-agnostic: whether a buyer paid via Stripe or holds the
ordinal, the entitlement resolves to the same `product_id`. For the resellable
path, ownership of the tier's pass is the entitlement.

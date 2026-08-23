---
name: collections
description: "This skill should be used for 1Sat collection protocol and collection-overlay questions — including 'create a collection', 'collectionItem', 'collectionId', 'list collection members', 'tm_1sat_collection', 'tm_col_', SIGMA admission, BSV21 collection members, and deciding whether an SDK mint will be indexed as a collection. Distinguishes the shipped 1sat-stack contract from SDK features that are not yet released."
---

# 1Sat Collections

Use the collection overlay in `b-open-io/1sat-stack` as the authority for what
counts as an indexed collection. Collection metadata conventions alone do not
guarantee overlay admission.

## Shipped collection contract

The stack's `pkg/collection` module recognizes two mint roles:

| Role | Required MAP | Topic |
|---|---|---|
| Collection root | `subType: "collection"` | `tm_1sat_collection` |
| Collection item | `subType: "collectionItem"` with `subTypeData.collectionId` | `tm_col_{collectionId}` |

Both roots and items must be exactly one satoshi, contain an inscription
envelope, and contain a valid transaction-bound SIGMA signature.

AIP does not satisfy collection admission. The overlay records the verified
SIGMA signer, but it does not compare that signer with the root signer or the
root's current owner. Do not invent root-owner, signer-matching, or delegated
authority rules that are absent from the implementation.

For an item, `collectionId` is read from the JSON string in MAP
`subTypeData`. A relative `_N` reference is normalized against the item's own
transaction; otherwise use the collection root's ordinal outpoint
`<txid>_<vout>`.

The current overlay is mint-only. It indexes admitted mint outputs and does not
follow transfers or reinterpret membership when ownership changes.

## Querying a collection service

When `pkg/collection` is embedded with routes enabled, its default prefix is
`/collection`:

```text
GET /collection/
GET /collection/{collectionId}
GET /collection/{collectionId}/items
GET /collection/{collectionId}/item/{outpoint}
```

`limit` and `rev` are supported by the list routes. The module defaults to
`mode: disabled`; a deployment must enable it and register item topics through
`collection_ids` or `Services.RegisterCollection`. Do not assume these routes
exist on `api.1sat.app` unless that deployment has been checked directly.
When giving query instructions, state both deployment gates: enabling the
module and registering the collection's item topic.

## SDK compatibility gate

Before recommending a mint helper, inspect the installed `@1sat/actions`
version or relevant source. Current `mintCollection` and `mintCollectionItem`
build the one-sat inscription and MAP data and add SIGMA through the P1Sat
placeholder/seal flow, so their final outputs meet the shipped collection
overlay's admission shape.

`mintCollectionItem({ ref })` is supported when the action input exposes
`ref`; it emits an `ord-fs/json` inscription with `.` pointing at the supplied
absolute or same-transaction reference. Generic BSV21 `map` / `signWithBAP`
options and `mintBsv21CollectionItem` must still be checked in the installed
version before recommending them.

For a custom mint, use the inscription flow's SIGMA support and construct the
MAP envelope exactly as the stack expects. Verify the final transaction rather
than treating an option name as proof that the output contains valid SIGMA.

## Content and token boundaries

Collection membership is independent of the inscription media type. An item
may use embedded content or an `ord-fs/json` directory whose `.` entry points to
shared content; the collection overlay never reads that leaf for membership.

A BSV21 deploy output can carry collection-item MAP and SIGMA at the script
level. That does not make collections part of BSV21. Keep the BSV21 package
generic and put collection-specific construction and lookup in the collection
layer. Confirm SDK support before presenting this as a ready-made action.
When reviewing a design that puts collection fields in the BSV21 JSON payload,
correct both halves explicitly: keep that payload generic, then compose the
collection MAP and SIGMA envelopes at the output-script layer.

## Source map

Check these files on the current `1sat-stack` default branch when behavior may
have changed:

- `pkg/collection/topic_discovery.go` — root admission
- `pkg/collection/topic_item.go` — item admission
- `pkg/collection/mapdata.go` — MAP parsing and SIGMA verification
- `pkg/collection/lookup.go` — stored fields and mint-only behavior
- `pkg/collection/routes.go` and `config.go` — HTTP routes and defaults

Use `ordinals-create` for ordinary inscription mechanics, `stack-api` for other
1sat-stack endpoints, `tokens` for BSV21 behavior, and `blockchain-media` or the
ORDFS skill for referenced content.

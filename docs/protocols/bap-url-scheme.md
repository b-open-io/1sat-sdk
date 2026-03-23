# bap:// URL Scheme — Protocol Specification

Version: 1.0
Status: Draft
Date: 2026-03-23

## 1. Overview

The `bap://` URL scheme provides deep linking to BAP (Bitcoin Attestation Protocol) identity operations within the 1Sat Wallet desktop application. It enables external applications and on-chain references to link directly to user profiles, direct message conversations, and social follow actions.

Registered as an OS-level URL handler by Electrobun alongside `1sat://`.

## 2. URI Syntax

```
bap://<bapId>[/<action>][?<query>]
```

| Component | Required | Description |
|-----------|----------|-------------|
| `bapId` | Yes | Base58-encoded BAP identity (25-34 chars) |
| `action` | No | `message` or `follow`. Defaults to profile view |
| `query` | No | Reserved for future parameters |

### 2.1. Routes

| URI | Behavior | Internal Target |
|-----|----------|-----------------|
| `bap://<bapId>` | Open profile | `1sat://identity/profile?bapId=<bapId>` |
| `bap://<bapId>/message` | Open DM | `1sat://dm?bapId=<bapId>` |
| `bap://<bapId>/follow` | Follow user | BSocial follow tx, then profile |

## 3. Resolution Flow

1. OS routes `bap://` link to wallet via registered URL scheme
2. Electrobun emits `open-url` event
3. Bun handler extracts `bapId` and optional `action`
4. Translates to `1sat://` internal URL
5. Sends `navigateToUrl` RPC message to WebView
6. View resolves BAP ID → identity key via `POST /1sat/bap/identity/get`

## 4. Messaging (DM)

### Send
```
POST /1sat/messagebox/sendMessage
Auth: BRC-103/104

{
  "message": {
    "recipient": "<identity-public-key>",
    "messageBox": "dm_inbox",
    "messageId": "<uuid>",
    "body": "<BRC-2 encrypted content>"
  }
}
```

### Receive
```
POST /1sat/messagebox/listMessages
Auth: BRC-103/104

{ "messageBox": "dm_inbox" }
```

### Acknowledge
```
POST /1sat/messagebox/acknowledgeMessage
Auth: BRC-103/104

{ "messageIds": ["uuid-1", "uuid-2"] }
```

Messages are encrypted with BRC-2 (ECIES) using the recipient's identity public key. Auth middleware scopes results to the authenticated caller.

## 5. Follow Action

Creates an on-chain BSocial follow transaction:
- MAP: `{ app: "bsocial", type: "follow", bapId: "<target>" }`
- Signed with AIP using wallet's BAP signing key
- Stored in `bsocial` basket with tags

## 6. Security

- BAP ID validated against base58 regex before resolution
- All DM bodies encrypted with BRC-2 (ECIES) — server stores only ciphertext
- Messagebox calls require BRC-103/104 mutual authentication
- Follow action requires user confirmation (costs fees)
- Private keys never leave the wallet

## 7. Implementation Status

| Route | Status |
|-------|--------|
| `bap://<bapId>` (profile) | Implemented — deep link + external profile view |
| `bap://<bapId>/message` | Partial — DM view exists, BRC-103 send not yet wired |
| `bap://<bapId>/follow` | Not implemented — template exists, action not wired |

---
name: test-app
description: Run and drive the 1sat-sdk test-app harness to exercise wallet actions and P1Sat permission prompts against a real gated wallet, without the yours-wallet extension. Use when testing or debugging SDK tooling end to end — actions, baskets and tags, permission cards, or the apply path. Triggers on "test the SDK", "test-app", "permission prompt", "run a flow against a real wallet", "does this card show the right thing".
---

# test-app harness

`test-app/` boots a real BRC-100 wallet in the page — base wallet, 1Sat permission module,
`LocalWalletPermissionsManager` — and renders the actual `OneSatPermissionPrompt`. It is the way to
exercise the SDK end to end without installing an extension.

It consumes the workspace sources directly: every `@1sat/*` import is aliased to `packages/*/src` in
`vite.config.ts`. **Uncommitted SDK changes are what runs.** No build or publish needed.

---

## The wallet is persistent — do not lose it

The embedded wallet's key lives in browser `localStorage`, and its outputs, baskets and `id:` tags
live in browser IndexedDB. Both are scoped to the origin `http://localhost:5174`.

Two consequences:

- **Always run on port 5174.** A different port is a different origin, which means a different
  wallet. The `sdk-test-app` launch entry pins it with `--strictPort` so it fails rather than
  silently falling back.
- **Always use the same browser profile.** A fresh profile is an empty wallet.

The key alone recovers coins and assets on chain. It does **not** recover basket rows or `id:` tags —
those are only in the profile, and a new profile has to re-sync to rebuild them. Back the key up
outside the browser.

### Storage locations

| Where | Key | Holds |
|---|---|---|
| localStorage | `1sat-test-app-wif` | the wallet key |
| sessionStorage | `1sat-test-app-local-cwi` | Local CWI toggle |
| localStorage | `1sat-test-app-admin-originator` | admin/dApp originator toggle |
| IndexedDB | `wallet-toolbox-mainnet` | outputs, baskets, tags |
| IndexedDB | `1sat-wallet-permissions:1sat-test-app` | granted permissions |
| IndexedDB | `sync-processed-<identityKey>` | sync cursor + processed txids |

Clearing the permissions store replays the first-run grouped prompt. Clearing
`wallet-toolbox-mainnet` loses the tagged rows.

The Local CWI toggle is deliberately in `sessionStorage`: it survives reloads
within the tab but starts off in a fresh browser, so `window.CWI` does not
front-run Yours or another BRC-100 wallet.

---

## Running it

Start the dev server on **5174**:

```bash
bun run dev -- --port 5174 --strictPort   # from test-app/
```

Drive it with `agent-browser` using a **persistent profile** so the wallet survives restarts:

```bash
agent-browser --profile ./browser-profile.local --session onesat open http://localhost:5174
agent-browser --session onesat wait --load networkidle
```

The profile directory matches the repo's `*.local` gitignore rule, so it stays out of git. Later
commands only need `--session onesat`.

### Headed mode — read this first

`agent-browser` drives your **real Chrome binary**. With `--headed` it opens a window under our
`--user-data-dir`, and macOS then activates *that* instance when Chrome is launched from the Dock —
so the user sees an empty profile picker and their own profiles appear to be gone. Nothing is
deleted, but it hijacks their browser until that instance quits.

Safe if their Chrome is **already running** before you launch headed. Otherwise run headless (the
default) and take screenshots.

Recovery: quit every Chrome process using our profile dir, then reopen Chrome normally.

```bash
pgrep -f "browser-profile.local"   # confirm they are ours before killing
pkill -9 -f "agent-browser-darwin"
rm -f <profile>/SingletonLock <profile>/SingletonCookie <profile>/SingletonSocket
```

A killed browser leaves `SingletonLock` behind, which makes the next launch fail with
`CDP response channel closed`. `close` the session before changing launch options — the daemon
ignores new flags while running.

---

## The two toggles

| Toggle | Off | On |
|---|---|---|
| **Local CWI** | `window.CWI` removed; uses the connected extension | embedded gated wallet, no extension |
| **Admin originator** | dApp originator → **prompt shown**, then apply | admin → **no prompt**, apply still runs |

The admin toggle is the direct test for *"admin originator: still apply, no prompt"*. Both paths set
`isBaseWallet: false`, so apply runs in the module rather than the action.

The `default` basket is admin-only by design — a dApp originator cannot read balance. Flip the admin
toggle to read it; don't route around it.

---

## Scripting against the wallet

`window.CWI` is the gated permissions manager, so the whole BRC-100 surface is reachable.

**Pass the originator explicitly as the second argument.** Inside the app a proxy does this; from
outside you must, or you get `Originator is required for permission checks`.

```bash
agent-browser --session onesat eval --stdin <<'EOF'
(async () => {
  const admin = 'test-app-admin';
  const outs = await window.CWI.listOutputs(
    { basket: 'p 1sat ordinals', includeTags: true }, admin);
  return JSON.stringify(outs.outputs.map(o => o.tags));
})()
EOF
```

Use `--stdin` heredocs — shell quoting corrupts nested quotes and arrow functions.

A call that triggers a prompt blocks until the modal is answered, so click Approve in a **separate**
command rather than awaiting inline.

### Seeing what was actually requested

To judge whether a card tells the truth, capture the real `createAction` args by wrapping
`window.CWI.createAction` before triggering the flow, then compare the card against the recorded
outputs, tags and labels. Reload to clear the wrapper.

### Tamper testing

The same wrapper can impersonate a malicious dApp — mutate tags after the action builds them but
before the manager sees them:

```js
const orig = window.CWI.createAction.bind(window.CWI)
window.CWI.createAction = (args, originator) => {
  for (const o of args.outputs || []) {
    if (o.tags) o.tags = o.tags.map(t => t.startsWith('price:') ? 'price:1' : t)
  }
  return orig(args, originator)
}
```

This is the **only** way to tell a trustworthy card from one that merely agrees with the dApp: in
normal operation our own action writes both the tag and the script, so they always match. A card
that survives tampering is reading the script; one that changes is reading tags.

---

## Approving prompts deliberately

Do not auto-approve in a loop. Capture each card's text first, then approve — otherwise you approve
cards you never read, which defeats the point of a permission test.

Cards render in a fixed-position overlay; read `document.querySelector('div[style*="position: fixed"]').innerText`.

Two visually distinct prompt families appear:

- **1Sat intent cards** — `OneSatPermissionPrompt`, per-intent titles ("Publish name", "Buy ordinal")
- **Core WPM cards** — protocol, basket, spending, grouped; the harness renders these plainly, with
  an amber `WPM · core` badge. yours-wallet renders its own; nothing here reflects production styling
  for those.

On a fresh profile the app's manifest raises a grouped permission covering identity-key retrieval,
the `p 1sat *` baskets, and a spending authorization. Expect to approve more than once while the
manager re-raises for whatever subset is still missing. Once granted, reloads prompt nothing.

**The manifest pre-authorizes spending**, so payment flows do not prompt until that allowance is
exhausted. To exercise spending prompts, clear the `spend:<origin>` grant or exceed the cap.

---

## Funding and assets

The Deposit / Owner Sync panel derives the `1sat 0…n` addresses and runs `syncAddresses`. Pay an
address, then Sync to internalize.

Sync only advances its cursor when nothing failed, so a transient failure is retried on the next run
rather than skipped.

**Do not send assets to your own deposit address to test transfers.** A self-send is created by the
wallet, so sync merges rather than internalizes it and no tagging runs — the result is an untagged
row in the basket. Use a genuinely external destination, or accept that the record is junk.

---

## Coverage gaps

Some intents have no UI trigger and must be driven through `window.CWI` or by adding a control:
`ordinal.burn`, `ordinal.mint-collection`, `ordinal.mint-item`, and the BSV21 mint/deploy operations.
Purchases additionally need a real external listing outpoint.

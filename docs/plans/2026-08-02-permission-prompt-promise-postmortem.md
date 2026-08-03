# Postmortem — `d.then is not a function` in the 1Sat permission prompt

Shipped in yours-wallet v5.0.2 (2026-07-30). Introduced by 1sat-sdk `a6d583b`
(2026-07-27). Found 2026-08-02 while testing 1sat.name.

Part 1 (code) is complete. Part 2 (decision history from session transcripts)
is pending.

---

## What breaks

`handlers.ts` attaches a live `Promise` to the permission intent:

```ts
...(enriched.trust && { verification: verifyIntent(...) })
```

`OneSatPermissionPrompt.tsx` consumes it with `verification.then(...)` in a
`useEffect`.

In yours-wallet the intent reaches the popup through `chrome.storage.local`, and
is flattened twice on the way: `deepMerge` in `serviceHelpers.ts` recurses into
the Promise and produces `{}` before storage is even called, and
`chrome.storage.local.set` would independently do the same. The popup therefore
reads `verification === {}` — truthy, so the `if (!verification) return` guard
passes, and `.then` is `undefined`. The TypeError is thrown synchronously inside
the effect during React commit, so the `.catch()` on the chain cannot catch it.

## Scope

**Purchase prompts only.** `verification` is attached only when
`enriched.trust` is truthy, and `initialTrust` returns a value only for
`ordinal.purchase`, `opns.purchase`, and `bsv21.purchase`. Every other prompt
kind is unaffected.

**Not avoidable by configuration.** yours-wallet never wires `services`, but
`verifyIntent` is `async`, so it returns a Promise regardless — one that resolves
instantly to `{state:'unverified'}`. Leaving verification unconfigured does not
dodge the crash.

**One field, not a class of fields.** Every other member of every prompt intent
is a string, number, string array, or plain object. `verification` is the only
non-serializable value on the payload.

## What is lost, beyond the crash

On a purchase, nothing is wallet-owned — every fact on the card comes from the
dApp. Verification is what re-checks those claims against ORDFS or the overlay,
and on resolution it rewrites the card in place: the true genesis origin (the
tagged value on a listing is the seller's OrdLock outpoint, not the asset), the
content type and size, the asset name, and the thumbnail — a listing outpoint
serves no content, so the preview is blank until verification lands.

## Why nothing caught it

**The type permits it by design.** `PromptRequest.intent` is
`Record<string, unknown>`, and a Promise is assignable to `unknown`. The
looseness was deliberate — the original doc comment said the shape is
"intentionally permissive so the SDK actions can ride additional detail through
to the prompt without locking the schema." That is exactly what removed the one
mechanical check that would have flagged this.

**The extension's own types assert the boundary is transparent.**
`OneSatPromptStorageEntry.request` and `ChromeStorageObject.oneSatPermissionRequest`
are both typed as the imported `PromptRequest`. The type system was told a live
`PromptRequest` survives `chrome.storage.local`, and believed it.

**`verification` is declared only in a private interface in the UI package**, and
reached through `req.intent as unknown as TransactionIntent` plus a second inline
cast in the effect. The Promise is asserted into existence at runtime with no
evidence behind it.

**The contract file never mentions it.** `a6d583b` rewrote the doc comment on
`intent` to enumerate "typical fields the UI consumes" — and left `verification`
out of that list. The commit tightened the contract documentation and omitted the
field it was adding.

**The design doc pre-authorized the shape.** It states the intent "carries an
optional field that resolves to the trust result… hosts that ignore the field are
unaffected." That is true of a host that does not read the field, and false of a
host that copies it. The distinction is never drawn.

**The correct precedent was already in the file and read as ergonomics.**
`contentUrlForOrigin` is a function on the enriched intent that deliberately never
reaches the payload — it is resolved eagerly into a `contentUrls` map "so the UI
doesn't need to know how to construct ORDFS URLs." That is the same discipline,
framed as a UI convenience rather than a serialization rule, so it carried no
weight when the next non-serializable member was added.

## Test coverage

`permission-module-ui` has no tests. `permission-module` has one file,
`apply.test.ts`, which cannot reach this: its intent is `opns.register` so
`verification` is never attached, its deps omit `services`, and its mock handler
receives the object by reference without round-tripping it.

`test-app` is the only end-to-end harness and is structurally incapable of
catching this class of bug — it hands the request straight to `setState` and
renders it in the same React tree.

Any one of these would have caught it:

- A round-trip assertion in the module's own tests: build a purchase intent and
  assert `structuredClone(request)` does not throw, or that
  `JSON.parse(JSON.stringify(request))` deep-equals it. No browser needed.
- A `promptHandler` in `test-app` that serializes before `setState`, so the
  harness matches the shipping host's topology instead of the convenient one.
- Any test in `permission-module-ui` rendering the prompt with
  `intent.verification = {}` — the exact value a serializing host produces.

## Consumers

Only two packages depend on `@1sat/permission-module`:

| Consumer | Crosses serialization | Broken |
|---|---|---|
| yours-wallet (extension popup) | yes, twice | yes — purchase prompts |
| 1sat-sdk/test-app | no | no |

wallet-desktop, wallet-browser, sigma-auth and 1sat-website do not consume this
bridge, despite the design doc naming wallet-desktop as a host. The
`permissionModules` directories in bsv-desktop and ts-stack are the unrelated
BTMS interface from `@bsv/wallet-toolbox`.

## Caveats on this analysis

- yours-wallet line references are from the local working tree, which is not the
  shipped tree: `v5.0.2` is `b347712` and is not an ancestor of local `HEAD`. The
  dependency pins were read directly from the tag and do match.
- The published npm tarballs for `0.0.48` / `0.0.43` were not diffed against the
  monorepo source; the analysis reasons from the monorepo.

---

## Part 2 — decision history

Source: session "1sat-sdk and permissions testing", 2026-07-26 01:24Z →
2026-07-27 13:40Z, 2,709 messages. That session produced `a6d583b` and the design
doc `2026-07-26-permission-module-verification.md`.

### What was yours

Live trust rather than stored tags was your call, and the reasoning was recorded
correctly: verification often isn't possible at broadcast time, so it has to be
computed at prompt time.

Asynchronous fill-in was also your call, chosen from two options put to you:

> "I think it can fill in the trust badge when the answer arrives... I think it's
> probably better if it loads in asynchronously."

You never specified a transport. The closest you came was describing a reactive
property, with an explicit disclaimer:

> "Isn't this react? ... Don't you just bind it to a property which populates
> when the response comes back? I'm no react expert though"

### What was the assistant's

The Promise-on-the-payload mechanism. Proposed by the assistant, never affirmed
by you — your next message moved to an unrelated question.

### The part that matters

The assistant raised this exact bug and then talked itself out of it.

> "Filling the badge in later means the host needs a way to receive an update —
> either the request carries a subscription, or it becomes observable. **That's a
> host-facing API change, since yours-wallet implements `promptHandler` too.**"

You pushed back — on rendering, not on hosts:

> "What? The host will return synchronously. You were just asking if we needed to
> wait for it to render the page, right?"

The assistant read a correction about *timing* as a refutation of the *host*
concern, and dropped both:

> "You're right, I overcomplicated it... the intent carries an optional promise
> field... Hosts that ignore it are unaffected."

That last clause became the design doc's stated decision, and it is the false
assumption the bug rests on. A host that ignores the field still copies it.

### What was never discussed

Searching all 2,709 messages for `serializ`, `structuredClone`, `postMessage`,
`chrome.storage`, and `service worker` returns nothing anywhere in the
verification work. `yours-wallet/src/services/oneSatPrompt.ts` was never opened.
yours-wallet was named exactly once in the design — in the sentence that was
retracted.

The plan doc's own change table lists the hosts to touch as **yours-wallet,
test-app, wallet-desktop**. Only test-app was ever exercised.

Later in the same session the assistant described the yours-wallet bridge from
memory while reasoning about a different guard — "yours-wallet looks the request
up by id and deletes it" — that is the storage-keyed path that serializes, and
the implication did not register.

### What "verified working" meant

The badge flipping Unverified → Verified inside `1sat-sdk/test-app`, an
in-process host. The assistant's own readiness list flagged three gaps — a
wallet-desktop build failure, an unfinished indexer consolidation, and untested
`bsv21.purchase` / `ordinal.burn` paths. Every gap was about *which intents* were
untested. None was about *which hosts*.

At publish time you said plainly:

> "I think we're ready to publish all of this stuff so that we can wrap it into
> yours wallet and test it end-to-end."

The assistant audited eight outstanding items for yours-wallet risk and cleared
all but an unrelated `keyID` issue. The prompt payload was not among them. The
handoff to yours-wallet was version bumps only.

### The lesson worth keeping

The failure was not ignorance — the boundary was identified out loud, by name,
before the code was written. It was abandoned because a user correction on one
axis (render timing) was taken as authority on a different axis (host
compatibility), and never rechecked. The cheap guard against a repeat is not
vigilance but a round-trip assertion in `permission-module`'s own tests, which
turns this class of mistake into a failing unit test with no browser involved.

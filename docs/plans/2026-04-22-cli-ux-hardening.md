# 1sat CLI UX hardening

Ongoing plan for polishing the `1sat` CLI before wider rollout. Topics
range from surface-level (password prompt, better defaults) to
architecture-level (eliminate the generic action runner).

## Status legend

- **Open** — identified, not yet scoped
- **Scoped** — solution direction agreed, not started
- **In progress** — being worked on
- **Done** — shipped and verified

---

## Items

### 1. Eliminate the generic action escape hatch

**Status:** Scoped.

**Motivation.** `1sat action <name> '{"key":"value",...}'` forces users
to hand-build JSON payloads to invoke actions that don't yet have
dedicated CLI commands. It's a scripting escape hatch, not a UX.
Surfaced when testing `syncAddresses` required `'{"prefix":"1sat"}'`
for the default case.

**Goal.** Every action an end-user or operator is likely to invoke has
a dedicated CLI subcommand with flag args and human-readable output.
The generic runner can remain for SDK/dev debugging but should not be
the documented path for any workflow.

**Audit findings (from audit run 2026-04-22):**

High priority (missing dedicated CLI):
- `burnOrdinals` → `1sat ordinals burn --outpoints <op1,op2>` (destructive; needs confirm prompt)
- `deriveCancelAddress` → `1sat ordinals cancel-address --outpoint <op>`
- `mintCollection` / `mintCollectionItem` — **not registered in action registry yet**
- MNEE actions (`mneeQueryBalance`, `mneeTransfer`) — **not registered yet**

Medium (existing CLI commands missing optional fields):
- `ordinals mint` — missing `--map <json>` and `--sign-with-bap`
- `wallet send` — missing OP_RETURN/custom-script/inscription; propose new `1sat wallet send-data` for clarity
- `identity sign` — missing `--encoding` / `--tag`
- `identity update-profile` — takes one JSON blob; should be `--name`, `--bio`, `--image`, etc.
- `social post` — missing `--content-type` / `--tags`
- `ordinals transfer` — missing `--map` / `--tags`
- `sendBsv21` paymail path — not wired

Low / programmatic-only: `scanAddress` (already covered via
`sweep scan`), `prepareSweepInputs`, `rotateIdentity`, `revokeIdentity`,
registry-module actions.

Partial-coverage commands to fix in-place:
- `wallet address` — missing `--start-index` / `--count`
- `wallet send` — per above

**Next step:** work the "add flags to existing commands" pass first
(highest coverage gain per hour). Then new commands. Collections and
MNEE require registering the actions before CLI exists.

**Reference:** full coverage matrix lives in the audit transcript
(dispatched 2026-04-22). Can be re-run with the same prompt if the
codebase drifts.

---

### 2. Password handling is weak

**Status:** Open — needs research on current state before scoping.

**Observed problem.** The CLI expects `ONESAT_PASSWORD` in the
environment or `--password` as a flag. There's no interactive prompt
when unset. `--password` on the command line also persists in shell
history.

**What exists today (needs verification):**
- `resolvePassword()` in `packages/cli/src/keys.ts` — returns
  `flagValue ?? process.env.ONESAT_PASSWORD`. Does not prompt.
- `1sat init` uses `@clack/prompts` to collect the password at setup;
  other commands that need the key re-read it via `resolvePassword()`
  without prompting.
- Touch ID caching exists on macOS (`cacheKeyPassword`) via
  `bitcoin-backup`, but that's opt-in at `init`.

**Goal.** If `ONESAT_PASSWORD` isn't set and no `--password` flag was
passed, commands that need to unlock the key should prompt for the
password interactively (via `@clack/prompts.password`) with no echo.
Touch ID unlock, when available, should be tried first.

**Open questions:**
- Should prompt happen at every command (tedious) or cache for the
  session (risky — where do we put the cache)?
- `--password` on the command line is a security footgun — warn, or
  remove entirely in favor of env + prompt?
- Does the `--json` / `--quiet` path need a different strategy (fail
  fast with clear error) so automation doesn't hang on a TTY prompt
  that never comes?

**Next step:** audit every call site of `resolvePassword()`, propose a
wrapper like `ensurePassword({ interactive, reason })` that prompts
when missing and a TTY is available, errors otherwise. Decide on
session caching policy.

---

### 3. Remote configuration during `1sat init` is unclear

**Status:** Open — needs UX pass.

**Observed problem.** The `init` wizard has a "Configure remote
storage?" step but the framing is ambiguous:

- It doesn't explain the difference between **active remote** (primary
  storage; all reads/writes go there) and **backup remotes** (periodic
  sync targets).
- It only takes one URL — offered as "Primary remote storage URL" —
  which then becomes `activeRemote`. No way to add backups during init.
- The UX implies the choice is irreversible; it's actually
  `1sat remote set-active ...` and `1sat remote add ...` later.
- No validation that the URL actually speaks BRC-100 / responds to
  `/account/status` / etc. before saving.

**Goal.** `init` either:
- (a) defers all remote configuration to later (`1sat remote add`
  after init) and explains that clearly, or
- (b) offers a clearer staged flow: "Do you want a hosted backend?" →
  "backup" or "active" → URL → validate → save.

Include copy that explains what "active" vs "backup" means.

**Open questions:**
- Should init default to a hosted option (e.g., `wallet.1sat.app`)?
  Opt-out? Opt-in? None by default?
- Should init prompt for the BRC-100 handshake validation so a
  broken URL is caught immediately?
- Interaction with `server.*` config — if the user is setting up a
  *server* (running `1sat serve`), remote storage doesn't make sense;
  init doesn't distinguish the two roles today.

**Next step:** decide on (a) vs (b). If (b), mock the clack flow and
review before implementing.

---

### 4. Touch ID unlock may be broken

**Status:** Open — needs reproduction and diagnosis.

**Observed problem (user report, 2026-04-22).** Touch ID flow doesn't
work reliably at unlock time. Unclear whether the breakage is in
`bitcoin-backup`'s `isTouchIDAvailable()` detection, the
`cacheKeyPassword()` storage call, or the retrieval path used by
`resolvePassword()` / downstream command code.

**What exists today:**
- `init` asks "Enable Touch ID?" when `isTouchIDAvailable()` returns
  true (macOS arm64 only).
- On affirm, `cacheKeyPassword(pw)` stashes the password in the system
  keychain, protected by biometric.
- `resolvePassword()` does NOT try to retrieve from Touch ID cache
  today — it only checks `--password` then `ONESAT_PASSWORD`. This is
  almost certainly the gap: even if Touch ID is enabled at setup,
  subsequent commands never ask for the cached password.

**Next step:** verify the retrieval path. If confirmed missing, extend
`resolvePassword()` to attempt a Touch ID unlock (via
`bitcoin-backup`'s retrieval API) before falling through to prompt.
Probably gates under item #2 — both need a coherent auth-layering
design:

1. `--password` flag
2. `ONESAT_PASSWORD` env
3. Touch ID (if enabled at init)
4. Interactive prompt (if TTY)
5. Fail with clear error (if non-TTY, non-env, non-Touch-ID)

---

### 5. _Placeholder_

Open slot for additional items the user wants to capture.

---

## Decision log

(Record notable decisions as the plan gets executed.)

- 2026-04-22: Eliminating the generic action runner adopted as a goal.
  Phased rollout starting with field-flag enhancements to existing
  commands. Audit recorded in agent transcript.

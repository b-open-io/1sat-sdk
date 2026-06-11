# Skills Restructure — Colocate, Reconcile, Generate

Status: proposed (awaiting signoff)
Branch: `skills-restructure`

## Problem

The 15 skills live in a single top-level `skills/` dir, divorced from the code they
document. They froze in March while `@1sat/actions` grew to 49 actions. Result:

- The two hub skills (`transaction-building`, `token-operations`) actively misdirect
  agents to `@1sat/core` for token deploy/mint/burn that are now real actions.
- Six action categories have **no skill home at all**: addresses, collections, sync,
  MNEE, signing/encryption, identity (partial).
- Command/tool drift in `1sat-cli` and `wallet-desktop-mcp`.
- `pow20-mining` documents an external mining protocol, not any SDK action.

## Approach

1. **Colocate** each skill inside the package it documents. Updating an action and its
   skill becomes the same diff. Supported via `plugin.json` `skills` array (globs).
2. **Mirror code seams** for granularity — one skill per action category with real
   surface; fold thin categories (1-2 actions) into a sibling.
3. **Demote** `transaction-building` to a pattern primer (createAction/signAction,
   two-phase, BEEF, tracked actions). It stops being the secret registry.
4. **Generate** the full action index from the `*Actions` registries so it cannot drift.
5. **Retire** `pow20-mining`. **Reshape** `extract-blockchain-media` to service-level.

Note: skills do NOT distribute via npm install — only via the Claude Code plugin /
marketplace. Colocation is for internal anti-drift; the root plugin still bundles all.

## Target layout

```
.claude-plugin/plugin.json   -> "skills": ["./skills/", "./packages/*/skills/"]

skills/                      (repo-level, not a package)
  sdk-publish/               KEEP  (maintainer workflow)

packages/actions/skills/
  action-patterns/           NEW   <- demoted from transaction-building (pattern primer + generated index)
  payments/                  NEW   sendBsv, sendAllBsv, deriveDepositAddresses
  tokens/                    REWRITE <- token-operations  (listTokens, getBsv21Balances, sendBsv21,
                                       purchaseBsv21, deployBsv21Mint, deployBsv21Auth, mintBsv21)
  ordinals-create/           KEEP  <- wallet-create-ordinals (inscribe, mintCollection, mintCollectionItem)
  ordinals-marketplace/      KEEP  <- ordinals-marketplace (getOrdinals, transferOrdinals, burnOrdinals,
                                       listOrdinal, cancelListing, purchaseOrdinal)
  locks/                     KEEP  <- timelock (getLockData, lockBsv, unlockBsv)
  opns/                      KEEP  <- opns-names (getOpnsNames, opnsRegister, opnsDeregister)
  sweep/                     KEEP  <- sweep-import (sweepBsv, sweepOrdinals, sweepBsv21, +sweepDeposit)
  mnee/                      NEW   getMneeConfig/Balance/Utxos/History/TxStatus, sendMnee
  identity/                  NEW   publishIdentity, rotateIdentity, updateProfile, getProfile, createSocialPost
  signing/                   NEW   signBsm, getAuthToken, getFriendPublicKey, encryptForCounterparty, decryptFromCounterparty
  sync-cosign/               NEW   syncAddresses, syncMessages, syncCosignDeliveries, attest

packages/wallet/skills/
  wallet-setup/              REWRITE <- wallet-setup (spans wallet/wallet-node/wallet-browser)

packages/connect/skills/
  dapp-connect/              REWRITE <- dapp-connect (spans connect/react)

packages/cli/skills/
  cli/                       REWRITE <- 1sat-cli (fix command-name drift)

packages/client/skills/
  stack-api/                 KEEP  <- 1sat-stack (indexer API the client consumes)
  blockchain-media/          RESHAPE <- extract-blockchain-media (service-level ORDFS, not "actions")

packages/wallet-desktop/skills/
  desktop-mcp/               REWRITE <- wallet-desktop-mcp (fix tool count 25->28, add mainview_eval/url)

RETIRED:
  pow20-mining/              DELETE (external mining protocol; no SDK action)
```

## Generated action index

`scripts/gen-action-index.ts` reads the per-category `*Actions` registries and emits a
markdown table of all 49 actions (name, category, signature, one-line purpose). Output
embedded into `action-patterns/SKILL.md` (or a sibling `ACTIONS.md` it references).
Wired into the build so it regenerates and can't go stale.

## Cross-harness portability

The colocated `SKILL.md` (frontmatter + body) is the single canonical, harness-neutral
source. Discovery is NOT automatic across harnesses, so each gets a thin pointer to the
same files:

- **Claude Code** — `plugin.json` `skills` array (globs into `packages/*/skills/`).
- **AGENTS.md-reading harnesses** (OpenCode, Cursor, Codex) — a "Skills catalog" section
  in `AGENTS.md` listing each skill, its path, and when to use it.

Rules to keep bodies portable:
- No Claude-only constructs in skill bodies. Cross-reference sibling skills by relative
  path/name, NOT the `Skill(1sat:…)` plugin namespace (`agents/ordinals.md` currently
  uses this — update it).
- `disable-model-invocation` is Claude-only; other harnesses ignore unknown frontmatter
  (inert, not breaking).

## Out of scope (this PR)

- Flipping `disable-model-invocation` on the four action skills that carry it
  (tokens, ordinals-marketplace, sweep, locks). Tracked separately — needs the
  rationale dug from git history first.
- Root README navigation / package READMEs (human-facing; this PR is agent-facing).
```

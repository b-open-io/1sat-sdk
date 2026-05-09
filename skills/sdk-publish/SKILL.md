---
name: sdk-publish
description: "Publish @1sat/* packages from the 1sat-sdk monorepo. Use when publishing any package, bumping versions, or releasing. Triggers on 'publish', 'release', 'bump version', 'deploy package', 'npm publish', 'bun publish'. Enforces workspace:* resolution, dependency ordering, lockfile regeneration, and pre-1.0 semver rules."
---

# 1Sat SDK Publish

Publish packages from the 1sat-sdk monorepo. This skill exists because workspace:* resolution, pre-1.0 semver, and bun's lockfile caching create subtle bugs that have caused broken publishes multiple times.

## Critical Rules

1. **Pre-1.0 semver**: `^0.0.x` means EXACT PATCH only. `^0.0.20` resolves to `0.0.20`, NOT `0.0.21+`. Every consumer must be updated explicitly when a dependency bumps.

2. **workspace:* resolves from the lockfile**: If the lockfile is stale, `bun publish` will bake in the OLD version even though package.json has the new one. Always delete bun.lock and reinstall before publishing.

3. **Publish in dependency order**: Upstream packages must be published before downstream ones. A downstream package's `workspace:*` resolves at publish time.

4. **ALL consumers must be updated**: When bumping a package, find every package in the monorepo that depends on it (directly or transitively) and bump those too.

## Dependency Order

```
types → utils → client → templates → core → wallet → wallet-browser, wallet-node, wallet-remote → actions → connect → extension → react → cli
```

If you bump `wallet`, you MUST also bump and republish `wallet-browser`, `wallet-node`, `wallet-remote`, and `actions` (all depend on wallet). Then any external consumers (yours-wallet, bsv-mcp, etc.) must update their pinned versions.

## Publish Workflow

### Step 1: Identify what changed and what depends on it

```bash
# What packages have local changes?
git diff --name-only HEAD~1 | grep "^packages/" | cut -d/ -f2 | sort -u

# For each changed package, find all dependents:
grep -r '"@1sat/<pkg>": "workspace:' packages/*/package.json
```

### Step 2: Bump versions for ALL affected packages

Bump the changed package AND every package that depends on it (recursively up the dependency chain). Use patch bumps (0.0.x → 0.0.x+1).

### Step 3: Regenerate lockfile

```bash
cd /path/to/1sat-sdk
rm bun.lock
bun install
```

### Step 4: Verify workspace resolution

For each package being published, verify the lockfile resolved workspace:* correctly:

```bash
grep -A3 '"name": "@1sat/<pkg>"' bun.lock
```

### Step 5: Clean build

```bash
rm -rf packages/<pkg>/dist
bun run --filter '@1sat/<pkg>' build
```

Do this for EVERY package being published.

### Step 6: Commit and push BEFORE publishing

```bash
git add packages/*/package.json
git commit -m "Release: <description of what changed>"
git push origin <branch>
```

### Step 7: Publish in dependency order

Publish upstream packages first, wait for registry propagation, then publish downstream.

**IMPORTANT: Use `bun publish --access public`, NOT `npm publish`.** Bun resolves `workspace:*` to actual versions; npm publishes the literal string `workspace:*` which breaks consumers.

```bash
cd packages/<pkg> && bun publish --access public
```

After each publish, verify the published dependencies:

```bash
npm view @1sat/<pkg>@<version> dependencies
```

Confirm that `@1sat/*` dependencies point to the correct versions BEFORE publishing the next package.

### Step 8: Update external consumers

For each external project (yours-wallet, bsv-mcp, sigma-auth, 1sat-website):

```bash
cd /path/to/consumer
# Update the pinned version in package.json
# Then:
rm bun.lock
bun install
bun run build
```

## npm Login & Publish Auth

### First-time login
```bash
npm login
```
It outputs a browser URL — click it to authenticate. Verify with `npm whoami`.

### Publish auth
`bun publish` and `npm publish` each require a separate browser auth step (OTP/passkey). Run the publish command, then click the URL it outputs. The auth token from `npm login` covers CLI operations, but publishing requires a fresh browser auth each time.

### Trusted publisher window (multi-package releases)
For a multi-package release, ask the user to enable "Trust this publisher" for ~5 minutes on the FIRST publish auth dialog. Once confirmed in chat, all subsequent `bun publish` calls in that window auto-authenticate without prompting — so you can publish the rest of the chain (including parallel publishes within the same dependency tier) without polling for auth URLs. Default flow:

1. First package: run `bun publish --access public`, open the auth URL, the user authenticates and selects the trust-publisher option (and tells you the duration in chat).
2. Remaining packages within the trust window: run `bun publish --access public` directly. They complete in seconds without any auth URL.
3. Publish independent packages within the same tier in parallel (background each `bun publish` and `wait`) to stay inside the trust window.
4. If the window lapses mid-release, the next publish prints a fresh auth URL — open it, ask the user to re-trust, and continue.

## Common Mistakes

### Publishing without regenerating lockfile
**Symptom**: Published package has old dependency versions.
**Fix**: Always `rm bun.lock && bun install` before publishing.

### Using npm publish instead of bun publish
**Symptom**: Published package has `workspace:*` as literal string in dependencies instead of resolved version.
**Fix**: Always use `bun publish --access public`, NOT `npm publish`. Bun resolves `workspace:*` to actual versions from the lockfile at publish time; npm does not.

### Publishing over a broken version
**Symptom**: Accidentally published with `workspace:*` deps (used `npm publish`). Can't republish same version.
**Fix**: Bump patch version (e.g. 0.0.21 → 0.0.22), regenerate lockfile, clean build, and republish with `bun publish`. Leave the broken version as-is — npm doesn't allow overwriting.

### Forgetting to bump a transitive dependent
**Symptom**: Consumer installs old version of a transitive dep because an intermediate package still pins the old version.
**Fix**: Trace the full dependency chain. If wallet changes, wallet-browser/node/remote AND actions all need bumps.

### Assuming ^0.0.x allows patch upgrades
**Symptom**: Consumer doesn't pick up new patch version.
**Fix**: In pre-1.0 semver, `^0.0.x` is exact. Must explicitly bump the consumer's dependency.

### Publishing downstream before upstream propagates
**Symptom**: Downstream package resolves to old upstream because npm registry hasn't propagated yet.
**Fix**: After publishing upstream, run `npm view @1sat/<pkg>@<version> dependencies` and wait until it returns the correct version before publishing downstream.

### Assuming committed fixes are in published packages
**Symptom**: Bug fix committed to git but transaction still fails with old behavior. The fix exists in the codebase but not in the published npm package.
**Fix**: Always verify the commit date vs publish date:
```bash
# Check when fix was committed
git log -1 --format="%ai %s" <commit-hash>

# Check when package was published
npm view @1sat/<pkg>@<version> time.created

# If commit date > publish date, the fix is NOT in the published version
# You MUST bump and republish the package
```
This commonly happens when debugging overlay validation failures — the fix is committed but consumers are using an old published version without the fix.

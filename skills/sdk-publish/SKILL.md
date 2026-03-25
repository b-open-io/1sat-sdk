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

## Common Mistakes

### Publishing without regenerating lockfile
**Symptom**: Published package has old dependency versions.
**Fix**: Always `rm bun.lock && bun install` before publishing.

### Forgetting to bump a transitive dependent
**Symptom**: Consumer installs old version of a transitive dep because an intermediate package still pins the old version.
**Fix**: Trace the full dependency chain. If wallet changes, wallet-browser/node/remote AND actions all need bumps.

### Assuming ^0.0.x allows patch upgrades
**Symptom**: Consumer doesn't pick up new patch version.
**Fix**: In pre-1.0 semver, `^0.0.x` is exact. Must explicitly bump the consumer's dependency.

### Publishing downstream before upstream propagates
**Symptom**: Downstream package resolves to old upstream because npm registry hasn't propagated yet.
**Fix**: After publishing upstream, run `npm view @1sat/<pkg>@<version> dependencies` and wait until it returns the correct version before publishing downstream.

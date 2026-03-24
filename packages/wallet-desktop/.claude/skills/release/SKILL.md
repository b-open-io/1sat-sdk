---
name: release
description: Release the 1Sat wallet-desktop Electrobun app. Use when the user says "tag a release", "ship it", "cut a release", "bump version", "create release", "push a tag", "release v0.0.X", or asks about the CI build status, CircleCI pipeline, build failures, or debugging a failed release. This is an Electrobun desktop app released via CircleCI + GitHub Releases, NOT an npm package.
---

# 1Sat Wallet Desktop — Release Workflow

This skill covers the full release lifecycle for the 1Sat wallet-desktop Electrobun app: changelog, version bump, tagging, CI monitoring, and debugging build failures.

## Release Steps (in order)

### 1. Update the changelog

Edit `CHANGELOG.md` in the wallet-desktop package root. Follow the existing format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- Feature descriptions

### Fixed
- Bug fix descriptions
```

Use `git log v<previous>..HEAD --oneline` to gather commit history since the last tag. Group by Added/Fixed/Changed/Removed.

### 2. Bump the version in package.json

This is for internal tracking only — CI also syncs it from the git tag. But keeping it in sync avoids confusion.

```bash
# In packages/wallet-desktop/package.json, update "version"
```

Do NOT touch `electrobun.config.ts` — CI handles that automatically via `sed` from the tag name.

### 3. Commit

```bash
cd ~/code/1sat-sdk
git add packages/wallet-desktop/CHANGELOG.md packages/wallet-desktop/package.json
git commit -m "chore: bump wallet-desktop to X.Y.Z"
```

### 4. Tag and push

Both the commit AND the tag must be pushed. The tag triggers CI.

```bash
git push
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 5. Monitor the build

CI runs on CircleCI. The workflow is `release`, job is `build-macos`.

## What CI Does

The full pipeline, triggered by a `v*` tag push:

1. **Install Bun** and project dependencies (`bun install` from monorepo root)
2. **Sync version** from tag into `package.json` and `electrobun.config.ts`
3. **Setup code signing** — imports Apple Developer ID cert from `CSC_LINK` env var
4. **Build workspace deps** — types, utils, client, templates, wallet, actions, connect, react
5. **Vite build** — frontend bundle to `dist/`
6. **Electrobun build** (`--env=stable`) — bundles bun entrypoint, copies files, creates `.app`, codesigns, notarizes, generates DMG
7. **GitHub Release** — creates release, uploads DMG + `latest.json`
8. **Vercel Blob** — uploads `download.json` and update artifacts for the auto-updater

### CI Environment Variables

These are set in the CircleCI project settings under the `1sat-wallet-signing` context:

| Variable | Purpose |
|----------|---------|
| `CSC_LINK` | Base64-encoded .p12 developer certificate |
| `CSC_KEY_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer team ID |
| `RELEASE_BUCKET_URL` | Update bucket URL |
| `GITHUB_TOKEN` | For `gh release create/upload` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage for update artifacts |

### Electrobun Config

`electrobun.config.ts` defines the app bundle. Key details:

- **External packages** (resolved at runtime, not bundled): `@1sat/wallet-mac`, `@1sat/vault`, `@1sat/actions`, `@1sat/client`, `@1sat/types`, `@1sat/utils`, `@bsv/sdk`, `@bsv/wallet-toolbox`, `knex`
- **Copy map**: `dist/index.html` and `dist/assets/` into views, `src/preloads/cwi.ts` into preload
- **Mac**: codesign + notarize enabled, icons from `icon.iconset/`

## Monitoring Builds via CircleCI API

The CircleCI CLI must be authenticated first (`circleci setup` with a personal API token from https://circleci.com/account/api). Config lives at `~/.circleci/cli.yml`.

### Find the pipeline for a tag

```bash
TOKEN=$(grep token ~/.circleci/cli.yml | awk '{print $2}')

# List recent pipelines, filter for tags
curl -s -H "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/project/gh/b-open-io/1sat-sdk/pipeline" \
  | python3 -c "
import json,sys
for p in json.load(sys.stdin).get('items',[])[:10]:
    tag = p.get('vcs',{}).get('tag','')
    if tag: print(f\"{p['id']}  tag={tag}  {p['state']}  {p['created_at']}\")
"
```

### Get workflow status from pipeline

```bash
curl -s -H "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/pipeline/<PIPELINE_ID>/workflow" \
  | python3 -c "
import json,sys
for w in json.load(sys.stdin).get('items',[]):
    print(f\"{w['id']}  {w['name']}  {w['status']}\")
"
```

### Get job details from workflow

```bash
curl -s -H "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/workflow/<WORKFLOW_ID>/job" \
  | python3 -c "
import json,sys
for j in json.load(sys.stdin).get('items',[]):
    print(f\"{j['id']}  {j['name']}  {j['status']}  job_number={j.get('job_number','')}\")
"
```

### Get step-by-step results and failure output

Use the v1.1 API — it returns step output URLs that the v2 API doesn't:

```bash
curl -s -H "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v1.1/project/github/b-open-io/1sat-sdk/<JOB_NUMBER>" \
  | python3 -c "
import json,sys
for s in json.load(sys.stdin).get('steps',[]):
    for a in s.get('actions',[]):
        icon = 'x' if a.get('failed') else 'ok'
        print(f'  {icon} {a.get(\"name\",\"\")} [{a.get(\"status\",\"\")}]')
        if a.get('failed') and a.get('output_url'):
            print(f'    output: {a[\"output_url\"]}')
"
```

Then fetch the output URL with `curl -s "<output_url>"` to get the actual build log.

## Debugging Build Failures

### "Bundle failed" with no detail

The Electrobun bundler is opaque about errors. The CI config includes diagnostics that run on failure:

1. **Standalone bun build** of `src/bun/index.ts` with the same externals — isolates whether the issue is bun bundling or Electrobun packaging
2. **dist file listing** — verifies Vite output exists
3. **icon.iconset listing** — verifies icon assets
4. **Version info** — bun and electrobun versions

If the standalone bun build succeeds but Electrobun still fails, the issue is in app packaging (codesign, icons, file copy). If both fail, it's a dependency resolution issue.

### Common failure patterns

- **Missing dependency**: A new import in `src/bun/` that isn't installed on CI. Check that `bun install` ran from the monorepo root and the package is in `package.json`.
- **Codesign failure**: Missing or expired Apple certificate. Check the `Setup code signing` step output. Certs are stored in the `1sat-wallet-signing` CircleCI context.
- **Notarization timeout**: Apple's notary service can be slow. The `no_output_timeout: 30m` gives it room, but extreme delays happen.
- **Icon issues**: `icon.iconset/` must contain valid PNGs at the required sizes (16, 32, 128, 256, 512 + @2x variants). Corrupted or wrong-size icons fail silently.

### Retagging after a fix

If you need to fix something and retag:

```bash
git tag -d vX.Y.Z                    # delete local tag
git push origin :refs/tags/vX.Y.Z    # delete remote tag
git add <fixed-files>
git commit -m "fix: description"
git push
git tag vX.Y.Z                       # recreate tag on new commit
git push origin vX.Y.Z               # push new tag — triggers CI again
```

## Local Build Testing

Test the build locally before tagging. The codesign step will fail without `ELECTROBUN_DEVELOPER_ID`, but the Vite + Electrobun bundling will run:

```bash
cd packages/wallet-desktop
bun run build
```

For just the bun entrypoint (fastest check for import/bundling issues):

```bash
bun build src/bun/index.ts --outdir /tmp/test --target bun \
  --external electrobun/bun --external electrobun \
  --external '@1sat/wallet-mac' --external '@1sat/vault' \
  --external '@1sat/actions' --external '@1sat/client' \
  --external '@1sat/types' --external '@1sat/utils' \
  --external '@bsv/sdk' --external '@bsv/wallet-toolbox' \
  --external knex
```

## Debugging Runtime Failures

After installing a release, if the app fails to launch or gets stuck.

### Check evlog file output

```bash
tail -30 ~/.1sat-wallet/logs/$(date +%Y-%m-%d).jsonl
```

Log files are NDJSON (one JSON object per line), organized by date, with 7-day retention.

### Startup event sequence

Events fire in this order during normal startup:
1. `url_resolved` — getMainViewUrl() succeeded
2. `window_created` — BrowserWindow created
3. `dom_ready` — webview loaded (includes `hasKey` for vault state)
4. `http_listening` — BRC-100 server on :3321
5. `mcp_listening` — MCP server on :3322
6. `setup_complete` or `onboarding_required` — stack status

If the log file exists but stops at a specific event, that's where it failed. If no log file exists, the bun process crashed before evlog initialized (likely a missing dependency).

### Common runtime issues

- **No log file at all**: Missing dependency in the bundle. Run the standalone bun build diagnostic.
- **Stops at `url_resolved`**: BrowserWindow constructor failed.
- **`dom_ready` fires but UI shows skeletons**: Stack didn't start or wallet state wasn't sent. Check for `start_failed` events.
- **`onboarding_required` but user sees nothing**: Frontend didn't receive the RPC message.

### MCP tool for live debugging

If the app is running and MCP is connected (`1sat mcp-proxy`), use the `wallet_logs` tool to query the ring buffer (last 500 events) without touching the filesystem.

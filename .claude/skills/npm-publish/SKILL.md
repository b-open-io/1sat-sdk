---
name: npm-publish
visibility: internal
description: "Drive npm login and bun/npm publish from an agent session when npm wants browser (passkey) auth: run the command on a pty, catch the auth URL, open it for the user, wait for completion, verify on the registry. Use for 'npm login', 'publish', 'bun publish', 'auth link', 'passkey', 'trust this publisher'. Pairs with sdk-publish, which owns versioning and ordering."
---

# npm publish with browser auth

npm's CLI login and every publish stop for a browser step (passkey or OTP).
The command prints a URL and blocks. This skill is the mechanics of getting
that URL in front of the user and knowing when the command finished. What to
publish, in what order, with which versions, is `sdk-publish`.

Proven 2026-09-02 on Linux (no fingerprint reader; passkey held in
Bitwarden's browser extension) for `npm login` plus 16 `bun publish` runs.

## The helper

`scripts/npm-auth-run.sh [-C dir] [-t seconds] -- <command...>`

- Runs the command under `script -qfec` so npm/bun see a TTY (they print no
  auth URL otherwise) and the transcript streams to a log.
- Strips ANSI, greps `https://www.npmjs.com/auth/cli/...` or `/login?...`,
  opens it with `xdg-open`, prints `AUTH: <url>` on stderr.
- Waits for the process to exit (default 300 s), prints the last clean lines,
  exits with the command's exit code.

```bash
S=.claude/skills/npm-publish/scripts/npm-auth-run.sh
$S -- npm login --auth-type=web && npm whoami
$S -C packages/types -- bun publish --access public
```

## Flow for a release

1. `npm whoami`. If `ENEEDAUTH`, run the login line above. Tell the user the
   page is open; they finish with the passkey. `npm whoami` must print the
   account before continuing.
2. First publish: run it, tell the user the auth page is open, and ask them
   to tick **"don't prompt again for 5 minutes"** (trust this publisher) and
   say so in chat. Every publish inside that window completes without a URL.
3. Remaining packages, dependency order, one after another. Sixteen packages
   fit in a five-minute window with margin if nothing else runs between them.
   If a URL appears mid-chain the window lapsed: the helper opens it, ask the
   user to re-trust, carry on.
4. After each publish, confirm the registry has the version **and** resolved
   deps before publishing anything that depends on it:

   ```bash
   curl -s https://registry.npmjs.org/@1sat%2F<pkg>/<ver> | python3 -c \
     'import json,sys;d=json.load(sys.stdin);print(d["dependencies"])'
   ```

   Any `workspace:` string there means the publish was done with `npm
   publish`; bump and republish with `bun publish` (see sdk-publish).

## Things that bit

- **ANSI on the URL.** bun prints the URL inside a box with a colour reset
  right after it. Grepping the raw log opens `…f3[0m` in the browser. Strip
  escapes first. The helper does.
- **Hex false positives.** A "did it fail" regex like `E4[0-9]{2}` matches
  the tarball's shasum line and reports a healthy publish as failed. Match on
  `^error:`, `npm ERR`, word-bounded `E401|E403|E404|EOTP`, or just wait for
  the `+ @scope/pkg@ver` line / process exit.
- **Registry lag.** `npm view pkg@ver` 404s for up to a minute after a
  successful publish, and npm then caches that 404 so a following
  `npm install pkg@ver` says `ETARGET`. Query the registry with curl, or pass
  `--prefer-online`. The `+ pkg@ver` line and exit code 0 are the truth.
- **Rehearse the consumer.** A scratch `npm init -y && npm i @1sat/cli@<ver>`
  under Node, then `node node_modules/@1sat/cli/dist/cli.js --version`, is
  what the server deploy will do; run it before touching the box.

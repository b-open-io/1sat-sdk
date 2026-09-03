#!/usr/bin/env bash
# Run an npm/bun command that may stop for browser auth (npm login, bun publish,
# npm publish). Captures the auth URL it prints, opens it in the user's browser,
# and waits for the command to finish. Prints a clean transcript tail and exits
# with the command's exit code.
#
#   npm-auth-run.sh [-C dir] [-t seconds] -- <command...>
#
# Why `script`: npm/bun only print the auth URL when attached to a TTY, and they
# wait for ENTER/browser; `script -qfec` gives them a pty and streams the log.
set -u
dir=.; timeout=300
while [ $# -gt 0 ]; do case "$1" in -C) dir=$2; shift 2;; -t) timeout=$2; shift 2;; --) shift; break;; *) break;; esac; done
[ $# -gt 0 ] || { echo "usage: $0 [-C dir] [-t seconds] -- <command...>" >&2; exit 2; }
log=$(mktemp /tmp/npm-auth-run.XXXXXX.log)
cmd=$(printf '%q ' "$@")
( cd "$dir" && script -qfec "$cmd" "$log" >/dev/null 2>&1 ) &
runner=$!
clean() { sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$log" 2>/dev/null | tr -d '\r'; }
opened=""
for ((i=0; i<timeout; i++)); do
  sleep 1
  if [ -z "$opened" ]; then
    # Strip ANSI *before* matching: the reset code otherwise rides along on the URL.
    url=$(clean | grep -oE 'https://www\.npmjs\.com/(auth/cli|login)[^ ]*' | head -1)
    if [ -n "$url" ]; then
      echo "AUTH: $url" >&2
      (xdg-open "$url" >/dev/null 2>&1 || open "$url" >/dev/null 2>&1) &
      opened=1
    fi
  fi
  kill -0 "$runner" 2>/dev/null || break
done
kill -0 "$runner" 2>/dev/null && { echo "TIMEOUT after ${timeout}s" >&2; kill "$runner" 2>/dev/null; }
code=$(clean | grep -oE 'COMMAND_EXIT_CODE="[0-9]+"' | tail -1 | grep -oE '[0-9]+')
clean | grep -vE '^\s*$|Press ENTER|Script (started|done)' | tail -8
rm -f "$log"
exit "${code:-1}"

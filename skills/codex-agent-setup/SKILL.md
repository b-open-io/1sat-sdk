---
name: codex-agent-setup
description: >-
  Explicit-only installer for the 1Sat Uno Satoj Codex custom agent. Use ONLY
  when the user explicitly asks to install, update, check, uninstall, or set up
  the 1Sat or Uno Satoj Codex agent, including "install Uno in Codex", "update
  the 1Sat Codex agent", or "check onesat_ordinals". Never auto-invoke for
  ordinary BSV, ordinals, token, wallet, marketplace, or SDK requests.
disable-model-invocation: false
user-invocable: true
metadata:
  author: b-open-io
  version: "1.0.0"
  codex:
    disable-model-invocation: true
    explicit_invocation_only: true
    never_modify_global_config: true
---

# 1Sat Codex Agent Setup

Install Uno Satoj's generated Codex adapter as a regular file. Run this skill
only after an explicit request to install, update, check, or uninstall Uno.

## Safety contract

- Default to the current project's `.codex/agents/` directory.
- Use `--user` only when the user explicitly requests a user-wide install.
- Never edit `~/.codex/config.toml` or any global Codex configuration.
- Never create plugin-cache symlinks or delete unrelated custom agents.
- Run `--check` when the user asks what would change.

## Commands

```bash
bash "${SKILL_DIR}/scripts/setup.sh" [--check|--uninstall|--force]
bash "${SKILL_DIR}/scripts/setup.sh" --user [--check|--uninstall|--force]
bash "${SKILL_DIR}/scripts/setup.sh" --target /custom/agents/directory
```

The installer manages only `1sat-ordinals.toml` and records ownership in
`.1sat-agents.json`. An unmanaged collision is refused unless the user
explicitly authorizes `--force`.

After a successful install or update, tell the user to start a **new Codex
session**, then invoke Uno using the runtime name `onesat_ordinals`.

## Maintainer generation

This command first refreshes the public root skill copies from their canonical
package locations, then refreshes Uno's generated Codex adapter.

```bash
bash "${SKILL_DIR}/scripts/generate.sh"
bash "${SKILL_DIR}/scripts/generate.sh" --check
```

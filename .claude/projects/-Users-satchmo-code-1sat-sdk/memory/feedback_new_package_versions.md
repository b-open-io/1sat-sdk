---
name: feedback_new_package_versions
description: New packages must start at version 0.0.1, not 0.1.0 or 1.0.0
type: feedback
---

Start new packages at version 0.0.1.

**Why:** User convention — all @1sat/* packages follow 0.0.x semver during early development. Higher starting versions imply stability that doesn't exist yet.

**How to apply:** When scaffolding any new package.json in this monorepo, always set `"version": "0.0.1"`.

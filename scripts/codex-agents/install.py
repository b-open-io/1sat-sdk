#!/usr/bin/env python3
"""Install, check, update, or uninstall Uno Satoj's generated Codex adapter."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from lib import (
    AGENT_FILE,
    MANIFEST_FILE,
    OWNERSHIP_FILE,
    atomic_copy,
    atomic_write,
    json_text,
    load_json,
    plugin_root,
    quarantine,
    sha256_file,
    validate_adapter,
)


def target_for(args: argparse.Namespace) -> tuple[Path, str]:
    if args.target:
        return args.target.expanduser().resolve(), "custom"
    if args.user:
        home = Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser().resolve()
        return home / "agents", "user"
    return Path.cwd().resolve() / ".codex" / "agents", "project"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--user", action="store_true")
    scope.add_argument("--target", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--plugin-root", type=Path)
    args = parser.parse_args(argv)
    root = args.plugin_root.resolve() if args.plugin_root else plugin_root(Path(__file__))
    source_dir = root / "codex" / "agents"
    source = source_dir / AGENT_FILE
    manifest = load_json(source_dir / MANIFEST_FILE, {})
    if (
        manifest.get("manager") != "1sat"
        or [a.get("generated_file") for a in manifest.get("agents", [])]
        != [AGENT_FILE]
    ):
        print("error: invalid or missing 1Sat agent manifest")
        return 1
    validate_adapter(source)
    target, scope_name = target_for(args)
    destination = target / AGENT_FILE
    ownership_path = target / OWNERSHIP_FILE
    ownership = load_json(ownership_path, {"manager": "1sat", "agents": {}})
    if ownership.get("manager") != "1sat":
        print(f"error: invalid 1Sat ownership metadata: {ownership_path}")
        return 1
    record = ownership.get("agents", {}).get(AGENT_FILE)

    if args.uninstall:
        if not record:
            print(f"unchanged: {AGENT_FILE} is not managed by 1Sat")
            return 0
        if (
            destination.is_file()
            and sha256_file(destination) != record.get("hash")
            and not args.force
        ):
            print(f"refused: {AGENT_FILE} was modified; use --force to uninstall")
            return 1
        if args.check:
            print(f"would uninstall: {AGENT_FILE}")
            return 1
        if destination.exists():
            quarantine(destination, target)
        ownership["agents"].pop(AGENT_FILE, None)
        atomic_write(ownership_path, json_text(ownership))
        print(f"uninstalled: {AGENT_FILE}")
        print("Start a new Codex session to refresh custom agents.")
        return 0

    source_hash = sha256_file(source)
    if destination.exists() and destination.is_symlink():
        print(f"refused: {AGENT_FILE} is a symlink; use --force to replace it")
        if not args.force:
            return 1
    if destination.exists() and not record and not args.force:
        print(f"refused unmanaged collision: {AGENT_FILE} (use --force)")
        return 1
    if (
        destination.is_file()
        and record
        and sha256_file(destination) != record.get("hash")
        and not args.force
    ):
        print(f"refused modified managed file: {AGENT_FILE} (use --force)")
        return 1
    current = (
        destination.is_file()
        and not destination.is_symlink()
        and sha256_file(destination) == source_hash
    )
    if args.check:
        print(("current: " if current else "would install: ") + AGENT_FILE)
        return 0 if current else 1
    if current:
        action = "unchanged"
    else:
        if destination.exists():
            quarantine(destination, target)
        atomic_copy(source, destination)
        action = "updated" if record else "installed"
    ownership.setdefault("agents", {})[AGENT_FILE] = {
        "hash": source_hash,
        "source_hash": manifest["agents"][0]["source_hash"],
        "generated_hash": manifest["agents"][0]["generated_hash"],
        "agent_name": manifest["agents"][0]["agent_name"],
        "scope": scope_name,
    }
    atomic_write(ownership_path, json_text(ownership))
    if destination.is_symlink() or not destination.is_file():
        print(f"error: installer did not produce a regular file: {destination}")
        return 1
    print(f"{action}: {AGENT_FILE}")
    print(f"target: {target}")
    print("Start a new Codex session before invoking onesat_ordinals.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

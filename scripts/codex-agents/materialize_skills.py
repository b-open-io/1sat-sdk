#!/usr/bin/env python3
"""Materialize public package skills into the cross-platform plugin root."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

MANIFEST_FILE = ".1sat-package-skills.json"
AUTHORED_SKILLS = {"codex-agent-setup"}
TRUE_DISABLE = re.compile(r"(?m)^(disable[-_]model[-_]invocation):\s*true\s*$")


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent="\t", ensure_ascii=False) + "\n").encode()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        Path(temp_name).unlink(missing_ok=True)


def plugin_root(start: Path | None = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / ".claude-plugin" / "plugin.json").is_file() and (
            parent / "packages"
        ).is_dir():
            return parent
    raise SystemExit("Could not locate the 1Sat plugin root")


def discover(root: Path) -> dict[str, Path]:
    sources: dict[str, Path] = {}
    for skill_md in sorted(root.glob("packages/*/skills/*/SKILL.md")):
        source = skill_md.parent
        name = source.name
        if name in AUTHORED_SKILLS or name in sources:
            raise ValueError(f"duplicate public skill name: {name}")
        if source.is_symlink():
            raise ValueError(f"public skill source must not be a symlink: {source}")
        contents = skill_md.read_text(encoding="utf-8")
        match = re.search(r"(?m)^name:\s*[\"']?([^\"'\n]+)[\"']?\s*$", contents)
        if not match or match.group(1).strip() != name:
            raise ValueError(f"skill name must match its directory: {source}")
        sources[name] = source
    if not sources:
        raise ValueError("no public package skills found")
    return sources


def render_source(source: Path) -> dict[str, bytes]:
    rendered: dict[str, bytes] = {}
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"public skill contents must not use symlinks: {path}")
        if not path.is_file():
            continue
        relative = path.relative_to(source).as_posix()
        data = path.read_bytes()
        if relative == "SKILL.md":
            text = data.decode("utf-8")
            text = TRUE_DISABLE.sub(lambda match: f"{match.group(1)}: false", text)
            data = text.encode()
        rendered[relative] = data
    return rendered


def tree_hash(files: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for relative, data in sorted(files.items()):
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(data)
        digest.update(b"\0")
    return "sha256:" + digest.hexdigest()


def actual_tree(path: Path) -> dict[str, bytes] | None:
    if not path.is_dir() or path.is_symlink():
        return None
    files: dict[str, bytes] = {}
    for item in sorted(path.rglob("*")):
        if item.is_symlink():
            return None
        if item.is_file():
            files[item.relative_to(path).as_posix()] = item.read_bytes()
    return files


def build(root: Path) -> tuple[dict[str, dict[str, bytes]], dict[str, Any]]:
    rendered: dict[str, dict[str, bytes]] = {}
    entries = []
    for name, source in discover(root).items():
        files = render_source(source)
        rendered[name] = files
        source_files = {
            path.relative_to(source).as_posix(): path.read_bytes()
            for path in sorted(source.rglob("*"))
            if path.is_file() and not path.is_symlink()
        }
        entries.append(
            {
                "name": name,
                "source": source.relative_to(root).as_posix(),
                "destination": f"skills/{name}",
                "source_hash": tree_hash(source_files),
                "generated_hash": tree_hash(files),
            }
        )
    manifest = {
        "schema_version": "1",
        "manager": "1sat-package-skills",
        "transform": "codex-disable-model-invocation-v1",
        "skills": entries,
    }
    return rendered, manifest


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else {}


def check(root: Path, rendered: dict[str, dict[str, bytes]], manifest: dict[str, Any]) -> int:
    skills_root = root / "skills"
    problems: list[str] = []
    expected_names = set(rendered) | AUTHORED_SKILLS
    actual_names = {
        path.name
        for path in skills_root.iterdir()
        if path.is_dir() and not path.name.startswith(".")
    }
    for name in sorted(expected_names ^ actual_names):
        problems.append(f"unexpected root skill set member: {name}")
    for name, expected in rendered.items():
        actual = actual_tree(skills_root / name)
        if actual != expected:
            problems.append(f"stale materialized skill: {name}")
    manifest_path = skills_root / MANIFEST_FILE
    actual_manifest = manifest_path.read_bytes() if manifest_path.is_file() else b""
    if actual_manifest != json_bytes(manifest):
        problems.append(f"stale materialization manifest: skills/{MANIFEST_FILE}")
    if problems:
        print("Public skill materialization is stale:")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print(f"Public skill materialization is current: {len(rendered)} package skills")
    return 0


def materialize(root: Path, rendered: dict[str, dict[str, bytes]], manifest: dict[str, Any]) -> None:
    skills_root = root / "skills"
    skills_root.mkdir(parents=True, exist_ok=True)
    previous = load_manifest(skills_root / MANIFEST_FILE)
    managed = {
        entry.get("name")
        for entry in previous.get("skills", [])
        if isinstance(entry, dict) and isinstance(entry.get("name"), str)
    }
    for name in sorted(managed - set(rendered)):
        destination = skills_root / name
        if destination.exists():
            shutil.rmtree(destination)
    for name, files in rendered.items():
        destination = skills_root / name
        if destination.exists() and name not in managed:
            raise ValueError(f"refusing unmanaged root skill collision: {destination}")
        temp = Path(tempfile.mkdtemp(prefix=f".{name}.", dir=skills_root))
        try:
            for relative, data in files.items():
                atomic_write(temp / relative, data)
            if destination.exists():
                shutil.rmtree(destination)
            os.replace(temp, destination)
        finally:
            if temp.exists():
                shutil.rmtree(temp)
    atomic_write(skills_root / MANIFEST_FILE, json_bytes(manifest))
    print(f"Materialized {len(rendered)} public package skills into skills/")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--plugin-root", type=Path)
    args = parser.parse_args()
    root = args.plugin_root.resolve() if args.plugin_root else plugin_root(Path(__file__))
    rendered, manifest = build(root)
    if args.check:
        return check(root, rendered, manifest)
    materialize(root, rendered, manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

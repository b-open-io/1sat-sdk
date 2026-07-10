#!/usr/bin/env python3
"""Focused tests for 1Sat Codex agent generation and installation."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
INSTALLER = HERE / "install.py"
AGENT = "1sat-ordinals.toml"


class AdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_installer(
        self,
        *args: str,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        command = [sys.executable, str(INSTALLER), "--plugin-root", str(ROOT), *args]
        return subprocess.run(
            command,
            cwd=cwd or self.base,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_generated_toml_preserves_canonical_body(self) -> None:
        canonical = (ROOT / "agents" / "ordinals.md").read_text(encoding="utf-8")
        body = canonical.split("\n---\n", 1)[1]
        with (ROOT / "codex" / "agents" / AGENT).open("rb") as handle:
            adapter = tomllib.load(handle)
        self.assertEqual(adapter["name"], "onesat_ordinals")
        self.assertTrue(adapter["developer_instructions"].endswith("\n" + body))

    def test_default_project_install_and_check_is_regular_file(self) -> None:
        result = self.run_installer()
        target = self.base / ".codex" / "agents" / AGENT
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(target.is_file())
        self.assertFalse(target.is_symlink())
        ownership = json.loads((target.parent / ".1sat-agents.json").read_text())
        self.assertEqual(ownership["manager"], "1sat")
        check = self.run_installer("--check")
        self.assertEqual(check.returncode, 0, check.stdout)
        self.assertEqual(check.stdout.strip(), f"current: {AGENT}")

    def test_user_scope_uses_codex_home(self) -> None:
        env = os.environ.copy()
        env["CODEX_HOME"] = str(self.base / "codex-home")
        result = self.run_installer("--user", env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.base / "codex-home" / "agents" / AGENT).is_file())

    def test_custom_target_preserves_unrelated_file(self) -> None:
        target = self.base / "custom"
        target.mkdir()
        unrelated = target / "mine.toml"
        unrelated.write_text('name = "mine"\n')
        result = self.run_installer("--target", str(target))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(unrelated.read_text(), 'name = "mine"\n')

    def test_check_reports_pending_install(self) -> None:
        result = self.run_installer("--check")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.strip(), f"would install: {AGENT}")

    def test_update_replaces_unmodified_managed_file(self) -> None:
        self.assertEqual(self.run_installer().returncode, 0)
        target_dir = self.base / ".codex" / "agents"
        target = target_dir / AGENT
        ownership_path = target_dir / ".1sat-agents.json"
        ownership = json.loads(ownership_path.read_text())
        old = 'name = "onesat_ordinals"\n'
        target.write_text(old)
        ownership["agents"][AGENT]["hash"] = "sha256:" + hashlib.sha256(
            old.encode()
        ).hexdigest()
        ownership_path.write_text(json.dumps(ownership))
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("updated:", result.stdout)
        self.assertIn("developer_instructions", target.read_text())

    def test_unmanaged_collision_refused_and_force_quarantines(self) -> None:
        target_dir = self.base / ".codex" / "agents"
        target_dir.mkdir(parents=True)
        collision = target_dir / AGENT
        collision.write_text("user content\n")
        refused = self.run_installer()
        self.assertEqual(refused.returncode, 1)
        self.assertEqual(collision.read_text(), "user content\n")
        forced = self.run_installer("--force")
        self.assertEqual(forced.returncode, 0, forced.stdout + forced.stderr)
        self.assertFalse(collision.is_symlink())
        recovered = list((target_dir / ".1sat-agents-trash").glob(f"{AGENT}*"))
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0].read_text(), "user content\n")

    def test_symlink_refused_and_force_produces_regular_file(self) -> None:
        target_dir = self.base / ".codex" / "agents"
        target_dir.mkdir(parents=True)
        external = self.base / "external.toml"
        external.write_text("external\n")
        (target_dir / AGENT).symlink_to(external)
        self.assertEqual(self.run_installer().returncode, 1)
        forced = self.run_installer("--force")
        self.assertEqual(forced.returncode, 0, forced.stdout + forced.stderr)
        self.assertTrue((target_dir / AGENT).is_file())
        self.assertFalse((target_dir / AGENT).is_symlink())
        self.assertEqual(external.read_text(), "external\n")

    def test_uninstall_and_modified_force_uninstall(self) -> None:
        self.assertEqual(self.run_installer().returncode, 0)
        target_dir = self.base / ".codex" / "agents"
        target = target_dir / AGENT
        target.write_text("user-modified managed adapter\n")
        refused = self.run_installer("--uninstall")
        self.assertEqual(refused.returncode, 1)
        self.assertIn("use --force", refused.stdout)
        forced = self.run_installer("--uninstall", "--force")
        self.assertEqual(forced.returncode, 0, forced.stdout + forced.stderr)
        self.assertFalse(target.exists())
        recovered = list((target_dir / ".1sat-agents-trash").glob(f"{AGENT}*"))
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0].read_text(), "user-modified managed adapter\n")

    def test_uninstall_removes_only_managed_adapter(self) -> None:
        target_dir = self.base / ".codex" / "agents"
        target_dir.mkdir(parents=True)
        unrelated = target_dir / "mine.toml"
        unrelated.write_text('name = "mine"\n')
        self.assertEqual(self.run_installer().returncode, 0)
        result = self.run_installer("--uninstall")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((target_dir / AGENT).exists())
        self.assertEqual(unrelated.read_text(), 'name = "mine"\n')


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Tests for deterministic public skill materialization."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SCRIPT = HERE / "materialize_skills.py"


class MaterializeSkillsTests(unittest.TestCase):
    def run_script(self, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--plugin-root", str(root), *args],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_repository_materialization_is_complete_and_current(self) -> None:
        result = self.run_script(ROOT, "--check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        package_names = {
            path.parent.name for path in ROOT.glob("packages/*/skills/*/SKILL.md")
        }
        root_names = {
            path.name
            for path in (ROOT / "skills").iterdir()
            if path.is_dir() and not path.name.startswith(".")
        }
        self.assertEqual(
            root_names,
            package_names | {"codex-agent-setup", "mintflow", "test-app"},
        )
        self.assertNotIn("sdk-publish", root_names)
        for name in root_names:
            destination = ROOT / "skills" / name
            self.assertFalse(destination.is_symlink())
            self.assertTrue((destination / "SKILL.md").is_file())
            self.assertFalse((destination / "SKILL.md").is_symlink())

    def test_generation_is_deterministic_and_check_detects_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "packages" / "demo" / "skills" / "sample"
            source.mkdir(parents=True)
            source_text = (
                "---\nname: sample\ndescription: Sample skill\n"
                "disable-model-invocation: true\n---\n\n# Sample\n"
            )
            (source / "SKILL.md").write_text(source_text)
            setup = root / "skills" / "codex-agent-setup"
            setup.mkdir(parents=True)
            (setup / "SKILL.md").write_text(
                "---\nname: codex-agent-setup\ndescription: Setup\n"
                "disable-model-invocation: false\n---\n"
            )

            generated = self.run_script(root)
            self.assertEqual(generated.returncode, 0, generated.stdout + generated.stderr)
            copied = root / "skills" / "sample" / "SKILL.md"
            self.assertIn("disable-model-invocation: false", copied.read_text())
            self.assertEqual((source / "SKILL.md").read_text(), source_text)
            manifest = json.loads(
                (root / "skills" / ".1sat-package-skills.json").read_text()
            )
            self.assertEqual(manifest["manager"], "1sat-package-skills")
            self.assertEqual(self.run_script(root, "--check").returncode, 0)

            copied.write_text(copied.read_text() + "drift\n")
            stale = self.run_script(root, "--check")
            self.assertEqual(stale.returncode, 1)
            self.assertIn("stale materialized skill: sample", stale.stdout)

            regenerated = self.run_script(root)
            self.assertEqual(regenerated.returncode, 0, regenerated.stdout + regenerated.stderr)
            self.assertEqual(self.run_script(root, "--check").returncode, 0)

    def test_unmanaged_root_collision_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "packages" / "demo" / "skills" / "sample"
            source.mkdir(parents=True)
            (source / "SKILL.md").write_text(
                "---\nname: sample\ndescription: Sample skill\n---\n"
            )
            collision = root / "skills" / "sample"
            collision.mkdir(parents=True)
            (collision / "SKILL.md").write_text("unmanaged\n")
            result = self.run_script(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("refusing unmanaged root skill collision", result.stderr)
            self.assertEqual((collision / "SKILL.md").read_text(), "unmanaged\n")


if __name__ == "__main__":
    unittest.main()

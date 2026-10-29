import re
import subprocess
import tomllib
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
PINNED = re.compile(r"^[^@\s]+@[0-9a-f]{40} # v\d")
PLATFORMS = ("linux-x64", "linux-arm64")


def uses_lines(path):
    for line in path.read_text().splitlines():
        match = re.match(r"\s*(?:-\s+)?uses:\s*(\S.*)$", line)
        if match:
            yield match.group(1)


def workflow_files():
    return sorted([*(ROOT / ".github").rglob("*.yml"), *(ROOT / ".github").rglob("*.yaml")])


def ci_text():
    return (ROOT / ".github/workflows/ci.yml").read_text()


def test_every_action_is_pinned_to_a_commit_with_a_version_comment():
    for path in workflow_files():
        for ref in uses_lines(path):
            if ref.startswith("./") or ref.startswith("$/"):
                continue
            assert PINNED.match(ref), f"{path.relative_to(ROOT)}: {ref}"


def test_ci_pins_its_runner():
    assert re.search(r"runs-on: ubuntu-\d+\.\d+$", ci_text(), re.M)


def test_ci_runs_the_same_tasks_as_development_and_lets_mise_own_the_tools():
    text = ci_text()
    assert "mise run setup" in text
    assert "mise run check" in text
    for forbidden in ("setup-python", "setup-uv", "apt-get install", "pip install"):
        assert forbidden not in text


def test_ci_and_the_installer_use_the_same_mise_version():
    installer = (ROOT / "scripts/install-mise.sh").read_text()
    pinned = re.search(r"^MISE_VERSION=(\S+)$", installer, re.M).group(1)
    assert re.search(rf"version: {re.escape(pinned)}\b", ci_text())
    checksums = re.findall(r"\[(?:x64|arm64)\]=([0-9a-f]{64})$", installer, re.M)
    assert len(checksums) == 2


def test_mise_refuses_tools_missing_from_the_lock():
    config = tomllib.loads((ROOT / "mise.toml").read_text())
    assert config["settings"]["locked"] is True


def test_every_mise_tool_is_locked_with_a_checksum_on_every_platform():
    tools = tomllib.loads((ROOT / "mise.toml").read_text())["tools"]
    locked = tomllib.loads((ROOT / "mise.lock").read_text())["tools"]
    assert tools
    for name, version in tools.items():
        entries = [e for e in locked.get(name, []) if e["version"] == version]
        assert entries, f"{name}@{version} is not in mise.lock"
        for platform in PLATFORMS:
            checksum = entries[0].get(f"platforms.{platform}", {}).get("checksum", "")
            assert checksum.startswith("sha256:"), f"{name} has no checksum for {platform}"


def test_uv_holds_new_releases_for_three_days():
    uv = tomllib.loads((ROOT / "pyproject.toml").read_text())["tool"]["uv"]
    assert uv["exclude-newer"] == "72 hours"


def test_dependabot_covers_every_ecosystem_with_a_cooldown():
    config = yaml.safe_load((ROOT / ".github/dependabot.yml").read_text())
    covered = {u["package-ecosystem"]: u for u in config["updates"]}
    assert (ROOT / "uv.lock").exists()
    assert set(covered) >= {"uv", "github-actions"}
    for update in covered.values():
        assert update["cooldown"]["default-days"] >= 4


def test_no_bootstrap_placeholder_survives():
    tracked = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    if not tracked:
        pytest.skip("not a git work tree yet")
    for name in tracked:
        path = ROOT / name
        if path.is_file() and name != "tests/test_toolchain.py":
            assert "@@" not in path.read_text(errors="ignore"), name

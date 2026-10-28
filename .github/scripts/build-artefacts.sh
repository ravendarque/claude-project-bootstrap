#!/usr/bin/env bash
set -euo pipefail
mkdir -p artefacts
zip -qr artefacts/claude-project-bootstrap.zip .claude-plugin skills LICENSE.md LICENSE-SCHEDULE.md README.md

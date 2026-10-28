#!/usr/bin/env bash
set -euo pipefail
pnpm build
mkdir -p artefacts
(cd dist && zip -qr "../artefacts/{{slug}}-dist.zip" .)

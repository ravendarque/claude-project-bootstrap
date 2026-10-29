#!/usr/bin/env bash
set -euo pipefail

MISE_VERSION=@@MISE_VERSION@@
declare -A MISE_SHA256=(
  [x64]=@@MISE_SHA256_X64@@
  [arm64]=@@MISE_SHA256_ARM64@@
)

case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

dest="${MISE_INSTALL_DIR:-$HOME/.local/bin}"
if [ -x "$dest/mise" ] && [ "$("$dest/mise" --version | awk '{print $1}')" = "$MISE_VERSION" ]; then
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="mise-v$MISE_VERSION-linux-$arch.tar.gz"
curl -fsSL -o "$work/$archive" "https://github.com/jdx/mise/releases/download/v$MISE_VERSION/$archive"
(cd "$work" && echo "${MISE_SHA256[$arch]}  $archive" | sha256sum -c -)
tar -xzf "$work/$archive" -C "$work"
install -D -m 0755 "$work/mise/bin/mise" "$dest/mise"

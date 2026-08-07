#!/usr/bin/env bash
# Fetch the Tor Expert Bundle into ./bin (no root). Skipped if system tor exists.
set -euo pipefail
cd "$(dirname "$0")"

if command -v tor >/dev/null; then
  echo "system tor found: $(command -v tor) — nothing to fetch"
  exit 0
fi
if [[ -x bin/tor/tor ]]; then
  echo "bin/tor/tor already present"
  exit 0
fi

# Scrape the current expert-bundle URL from the download page.
URL=$(curl -fsSL https://www.torproject.org/download/tor/ |
  grep -oE 'href="[^"]*tor-expert-bundle-linux-x86_64-[0-9][^"]*\.tar\.gz"' |
  head -1 | cut -d'"' -f2)
[[ -n "$URL" ]] || { echo "could not find expert bundle URL" >&2; exit 1; }
[[ "$URL" == http* ]] || URL="https://www.torproject.org${URL}"

echo "fetching $URL"
mkdir -p bin
curl -fL "$URL" -o bin/tor-expert-bundle.tar.gz
tar -xzf bin/tor-expert-bundle.tar.gz -C bin
[[ -x bin/tor/tor ]] || { echo "unexpected bundle layout" >&2; exit 1; }
bin/tor/tor --version | head -1

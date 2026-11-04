#!/bin/sh
# These literal digests and this script require independent review in harness commit H.
set -eu
umask 022
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -ne 1 ] || [ -e "$1" ]; then
  echo 'usage: verify-and-extract.sh NEW_DESTINATION (must not exist)' >&2
  exit 1
fi
(
  cd "$root"
  printf '%s  %s\n' '2cf360792e94f46da9f535340d9d9f2aace5ecc76b7aaaefb9fd1d418f992853' 'payload.tar.xz' '3895a4c333a6b2bca1e5c3370c9af5b5ff17393e3e70d5f7bb022301358279c5' 'inventory.json' | sha256sum --check --strict >&2
)
mkdir -p -- "$1"
dest=$(CDPATH='' cd -- "$1" && pwd)
tar -xJf "$root/payload.tar.xz" --no-same-owner --no-same-permissions -C "$dest"
"$dest/bin/node" "$dest/wrappers/verify-inventory.mjs" "$dest" "$root/inventory.json" >&2
printf '%s\n' "$dest"

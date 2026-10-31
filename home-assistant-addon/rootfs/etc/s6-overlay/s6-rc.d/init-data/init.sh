#!/bin/sh
set -eu

echo "Preparing Ghostfolio persistent storage..."

mkdir -p /data/secrets /data/redis

chown node:node /data /data/secrets /data/redis

chmod 700 /data/secrets /data/redis

echo "Persistent storage initialized"

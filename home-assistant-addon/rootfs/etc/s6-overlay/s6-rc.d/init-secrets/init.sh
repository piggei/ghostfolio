#!/bin/sh
set -eu

umask 077

SECRETS_DIR="/data/secrets"
SECRETS_FILE="$SECRETS_DIR/ghostfolio.env"

mkdir -p "$SECRETS_DIR" /data/redis
chmod 700 "$SECRETS_DIR" /data/redis

validate_secrets() {
  file="$1"

  [ -f "$file" ] || return 1

  for name in REDIS_PASSWORD ACCESS_TOKEN_SALT JWT_SECRET_KEY; do
    value=$(sed -n "s/^${name}=//p" "$file")

    if ! printf '%s' "$value" | grep -Eq '^[0-9a-f]{64}$'; then
      return 1
    fi
  done
}

if [ -e "$SECRETS_FILE" ]; then
  if ! validate_secrets "$SECRETS_FILE"; then
    echo "ERROR: Existing secrets file is invalid"
    exit 1
  fi

  echo "Using existing persistent Ghostfolio secrets"
else
  echo "Initializing persistent Ghostfolio secrets"

  TEMP_FILE=$(mktemp "$SECRETS_DIR/.ghostfolio.XXXXXXXX")

  trap 'rm -f "$TEMP_FILE"' EXIT HUP INT TERM

  {
    printf 'REDIS_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'ACCESS_TOKEN_SALT=%s\n' "$(openssl rand -hex 32)"
    printf 'JWT_SECRET_KEY=%s\n' "$(openssl rand -hex 32)"
  } > "$TEMP_FILE"

  chmod 600 "$TEMP_FILE"

  if ! validate_secrets "$TEMP_FILE"; then
    echo "ERROR: Generated secrets failed validation"
    exit 1
  fi

  mv -n "$TEMP_FILE" "$SECRETS_FILE"
  trap - EXIT HUP INT TERM

  validate_secrets "$SECRETS_FILE"
fi

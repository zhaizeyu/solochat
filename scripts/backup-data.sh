#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
RETENTION_COUNT="${RETENTION_COUNT:-5}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/solochat-data-$STAMP.tar.gz"
TMP_DIR="$(mktemp -d)"
NODE_BIN="${NODE_BIN:-}"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"
mkdir -p "$TMP_DIR/data"

if ! [[ "$RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  printf 'RETENTION_COUNT must be a positive integer\n' >&2
  exit 2
fi

if [[ -z "$NODE_BIN" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  elif [[ -x /root/.nvm/versions/node/v24.16.0/bin/node ]]; then
    NODE_BIN="/root/.nvm/versions/node/v24.16.0/bin/node"
  else
    printf 'node executable not found; set NODE_BIN or update PATH\n' >&2
    exit 127
  fi
fi

"$NODE_BIN" - "$DATA_DIR/app.sqlite" "$TMP_DIR/data/app.sqlite" <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const [source, target] = process.argv.slice(2);
const db = new DatabaseSync(source);
db.exec('PRAGMA wal_checkpoint(FULL)');
db.prepare('VACUUM INTO ?').run(target);
db.close();
NODE

if [[ -d "$DATA_DIR/uploads" ]]; then
  cp -a "$DATA_DIR/uploads" "$TMP_DIR/data/uploads"
fi

tar -C "$TMP_DIR" -czf "$ARCHIVE" data
chmod 600 "$ARCHIVE"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'solochat-data-*.tar.gz' -printf '%T@ %p\0' \
  | sort -z -nr \
  | tail -z -n +"$((RETENTION_COUNT + 1))" \
  | cut -z -d ' ' -f 2- \
  | xargs -0r rm -f

printf '%s\n' "$ARCHIVE"

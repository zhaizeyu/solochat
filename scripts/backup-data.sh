#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/solochat-data-$STAMP.tar.gz"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"
mkdir -p "$TMP_DIR/data"

node - "$DATA_DIR/app.sqlite" "$TMP_DIR/data/app.sqlite" <<'NODE'
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

printf '%s\n' "$ARCHIVE"

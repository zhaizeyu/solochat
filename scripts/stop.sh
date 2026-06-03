#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.runtime/app.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "App is not running: PID file not found."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if [[ -z "$PID" ]] || ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "App is not running."
  exit 0
fi

echo "Stopping app. PID: $PID"
kill -TERM "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true

for _ in {1..20}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "App stopped."
    exit 0
  fi
  sleep 0.5
done

echo "App did not stop after 10 seconds, forcing stop."
kill -KILL "-$PID" 2>/dev/null || kill -KILL "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "App stopped."

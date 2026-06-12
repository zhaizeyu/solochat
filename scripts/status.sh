#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.runtime/app.pid"
LOG_FILE="$ROOT_DIR/logs/app.log"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "App is running. PID: $PID"
    echo "App: http://localhost:${PORT:-3101}"
    echo "Log: $LOG_FILE"
    exit 0
  fi
fi

echo "App is not running."
exit 1

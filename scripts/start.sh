#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$RUNTIME_DIR/app.pid"
LOG_FILE="$LOG_DIR/app.log"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "App is already running. PID: $PID"
    echo "Log: $LOG_FILE"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$ROOT_DIR"
if [[ ! -d node_modules ]]; then
  echo "node_modules not found. Run npm install first."
  exit 1
fi

nohup setsid npm run dev >>"$LOG_FILE" 2>&1 &
PID="$!"
echo "$PID" >"$PID_FILE"

sleep 1
if kill -0 "$PID" 2>/dev/null; then
  echo "App started. PID: $PID"
  echo "Frontend: http://localhost:5173"
  echo "API: http://localhost:3101"
  echo "Log: $LOG_FILE"
else
  rm -f "$PID_FILE"
  echo "App failed to start. Check log: $LOG_FILE"
  exit 1
fi

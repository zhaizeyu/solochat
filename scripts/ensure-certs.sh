#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/data/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"
HOST_IP="${TLS_HOST_IP:-167.86.104.36}"

mkdir -p "$CERT_DIR"

if [[ -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found; cannot create TLS certificates."
  exit 1
fi

openssl req -x509 -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -days 825 -nodes \
  -subj "/CN=${HOST_IP}" \
  -addext "subjectAltName=IP:${HOST_IP},DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1

chmod 600 "$KEY_FILE"
echo "Created TLS certificates in ${CERT_DIR}"

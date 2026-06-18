#!/usr/bin/env sh
set -eu

CERT_DIR="${CERT_DIR:-certs}"
CERT_PATH="${CERT_PATH:-${CERT_DIR}/localhost.crt}"
KEY_PATH="${KEY_PATH:-${CERT_DIR}/localhost.key}"

mkdir -p "${CERT_DIR}"

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -sha256 \
  -days 30 \
  -keyout "${KEY_PATH}" \
  -out "${CERT_PATH}" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

printf '%s\n' "Generated ${CERT_PATH} and ${KEY_PATH}"

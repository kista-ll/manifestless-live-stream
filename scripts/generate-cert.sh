#!/usr/bin/env sh
set -eu

PYTHON="${PYTHON:-python}"

exec "${PYTHON}" scripts/generate-cert.py

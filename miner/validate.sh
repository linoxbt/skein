#!/usr/bin/env bash
# Validates skein-miner.yaml against Telegraph's schema (free; no gas) and
# prints the YAML hash used by registerMiner (SHA-256 of the raw bytes, not keccak).
# The validator's request shape is unconfirmed; check it on Nov 1.
set -euo pipefail
cd "$(dirname "$0")"
FILE=${1:-skein-miner.yaml}
echo "YAML_HASH=0x$(sha256sum "$FILE" | awk '{print $1}')"
curl -sS -X POST "https://integrate.telegraphprotocol.com/api/validate" \
  -H "content-type: application/yaml" --data-binary @"$FILE"
echo

#!/usr/bin/env bash
# Validates skein-miner.yaml against Telegraph's schema (free; no gas) and
# prints the YAML hash registerMiner takes (SHA-256 of the raw bytes, not keccak).
# Fails loudly: a non-2xx from the validator, or a response that does not say
# valid, exits non-zero. The validator URL the spec names (the default) answered
# 404 on 2026-11-02; set VALIDATOR_URL to the current one, or validate in the
# integrate.telegraphprotocol.com web app before registering.
set -euo pipefail
cd "$(dirname "$0")"
FILE=${1:-skein-miner.yaml}
if grep -Eq '^id:[[:space:]]*0([[:space:]]|$)' "$FILE"; then
  echo "error: $FILE has id: 0; set the miner's numeric id before validating for registration" >&2
  [ "${ALLOW_DRAFT:-}" = "1" ] || exit 1
fi
echo "YAML_HASH=0x$(sha256sum "$FILE" | awk '{print $1}')"
VALIDATOR_URL=${VALIDATOR_URL:-https://integrate.telegraphprotocol.com/api/validate}
out=$(curl -fsS -X POST "$VALIDATOR_URL" -H "content-type: application/yaml" --data-binary @"$FILE")
echo "$out"
if ! printf '%s' "$out" | grep -Eqi '"valid"[[:space:]]*:[[:space:]]*true'; then
  echo "error: the validator did not report the YAML as valid" >&2
  exit 1
fi

#!/usr/bin/env bash
# Validates a miner YAML before registration (free; no gas) and prints the YAML
# hash registerMiner takes (SHA-256 of the raw bytes, not keccak).
#
# By default it runs check-yaml.ts: the schema's closed key sets, declared
# intents, canonical intents on-chain, and the id/slug free on the dev node.
# The remote validator the spec names has no API (404 on 2026-11-02; on
# 2026-11-12 it redirects to the anjoman.ai dashboard), so a remote validator is
# used only when VALIDATOR_URL is set; it then must answer 2xx with
# "valid": true. Exits non-zero on any problem.
#   miner/validate.sh [file]          default skein-miner.plan-b.yaml (the registered one)
#   ALLOW_DRAFT=1 miner/validate.sh skein-miner.yaml   the plan-A draft (id 0)
#   REGISTERED=1 miner/validate.sh    an update of a live registration: its own id and slug are in use
set -euo pipefail
cd "$(dirname "$0")"
FILE=${1:-skein-miner.plan-b.yaml}
if grep -Eq '^id:[[:space:]]*0([[:space:]]|$)' "$FILE"; then
  echo "error: $FILE has id: 0; set the miner's numeric id before validating for registration" >&2
  [ "${ALLOW_DRAFT:-}" = "1" ] || exit 1
fi
echo "YAML_HASH=0x$(sha256sum "$FILE" | awk '{print $1}')"
npx tsx check-yaml.ts "$FILE" ${REGISTERED:+--registered} ${ALLOW_DRAFT:+--draft}
if [ -n "${VALIDATOR_URL:-}" ]; then
  out=$(curl -fsS -X POST "$VALIDATOR_URL" -H "content-type: application/yaml" --data-binary @"$FILE")
  echo "$out"
  if ! printf '%s' "$out" | grep -Eqi '"valid"[[:space:]]*:[[:space:]]*true'; then
    echo "error: the validator did not report the YAML as valid" >&2
    exit 1
  fi
fi

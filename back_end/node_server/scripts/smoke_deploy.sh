#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <job_id>" >&2
  exit 2
fi

JOB_ID="$1"

echo "[1/3] POST /api/jobs/$JOB_ID/deploy"
DEPLOY_JSON=$(curl -sS -X POST "$API_BASE/api/jobs/$JOB_ID/deploy")
echo "$DEPLOY_JSON" | head -c 400; echo; echo

echo "[2/3] Poll /api/jobs/$JOB_ID for deploy.status (timeout 60s)"
START=$(date +%s)
while true; do
  J=$(curl -sS "$API_BASE/api/jobs/$JOB_ID" || true)
  ST=$(python3 - <<PY
import json
j=json.loads('''$J''') if '''$J'''.strip().startswith('{') else {}
d=j.get('deploy') or {}
print((d.get('status') or '').lower())
PY
)
  if [[ "$ST" == "completed" || "$ST" == "failed" ]]; then
    echo "status=$ST"
    echo "$J" | head -c 800; echo; echo
    break
  fi
  NOW=$(date +%s)
  if (( NOW - START > 60 )); then
    echo "timeout"; echo "$J" | head -c 800; echo
    exit 1
  fi
  sleep 1.5
done

echo "[3/3] If completed, try download URL in deploy.output_path"
URL=$(python3 - <<PY
import json
j=json.loads('''$J''')
d=j.get('deploy') or {}
print(d.get('output_path') or d.get('outputPath') or '')
PY
)

if [[ -n "$URL" ]]; then
  echo "output_url=$URL"
  curl -sS -I "$API_BASE$URL" | head -n 20 || true
fi

echo "OK"

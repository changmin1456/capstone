#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

MODEL_ID="smoke_model_$(date +%s)"
PY_FILE="$TMP_DIR/${MODEL_ID}.py"

cat > "$PY_FILE" <<'PY'
# minimal model placeholder for upload testing

def hello():
    return "ok"
PY

echo "[1/4] GET /api/models"
curl -sS "$API_BASE/api/models" | head -c 300; echo; echo

echo "[2/4] POST /api/models (multipart: id, name, model_file)"
CREATE_JSON=$(curl -sS -X POST "$API_BASE/api/models" \
  -F "id=$MODEL_ID" \
  -F "name=$MODEL_ID" \
  -F "model_file=@$PY_FILE;type=text/x-python")

echo "$CREATE_JSON" | head -c 300; echo; echo

CREATED_ID=$(python3 - <<PY
import json
import sys
j=json.loads('''$CREATE_JSON''')
print(j.get('id',''))
PY
)

if [[ -z "$CREATED_ID" ]]; then
  echo "Failed to parse created id" >&2
  exit 1
fi

echo "[3/4] GET /api/models (check presence)"
curl -sS "$API_BASE/api/models" | grep -q "$CREATED_ID" && echo "found: $CREATED_ID" || (echo "not found" && exit 1)

echo "[4/4] DELETE /api/models/$CREATED_ID"
curl -sS -X DELETE "$API_BASE/api/models/$CREATED_ID" | head -c 300; echo

echo "OK"

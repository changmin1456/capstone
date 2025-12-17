#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

ZIP="$TMP_DIR/dataset.zip"
# create a tiny zip with a minimal structure
mkdir -p "$TMP_DIR/data/images/train/class0" "$TMP_DIR/data/images/val/class0"
echo "x" > "$TMP_DIR/data/images/train/class0/1.jpg"
echo "x" > "$TMP_DIR/data/images/val/class0/1.jpg"
(cd "$TMP_DIR/data" && zip -qr "$ZIP" .)

echo "[1/2] POST /api/datasets/analyze"
ANALYZE_JSON=$(curl -sS -X POST "$API_BASE/api/datasets/analyze" \
  -F "dataset=@$ZIP;type=application/zip" \
  -F "project_id=smoke_project" \
  -F "title=smoke")

echo "$ANALYZE_JSON" | head -c 400; echo; echo

echo "[2/2] POST /api/datasets/upload"
UPLOAD_JSON=$(curl -sS -X POST "$API_BASE/api/datasets/upload" \
  -F "dataset=@$ZIP;type=application/zip" \
  -F "project_id=smoke_project" \
  -F "title=smoke")

echo "$UPLOAD_JSON" | head -c 400; echo

echo "OK"

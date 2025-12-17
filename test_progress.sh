#!/bin/bash

echo "=== 테스트 시작 ==="
echo ""

# 서버 상태 확인
echo "1. 서버 상태 확인..."
FASTAPI_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/ping 2>/dev/null || echo "000")
NODE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/ping 2>/dev/null || echo "000")

if [ "$FASTAPI_STATUS" != "200" ]; then
    echo "⚠️  FastAPI 서버가 실행되지 않았습니다 (포트 8000)"
    echo "   실행: cd back_end/fast_server && python3 -m uvicorn main:app --reload --port 8000"
else
    echo "✓ FastAPI 서버 실행 중 (포트 8000)"
fi

if [ "$NODE_STATUS" != "200" ]; then
    echo "⚠️  Node 서버가 실행되지 않았습니다 (포트 3000)"
    echo "   실행: cd back_end/node_server && npm run dev"
else
    echo "✓ Node 서버 실행 중 (포트 3000)"
fi

echo ""
echo "2. Train 요청 전송..."
RESPONSE=$(curl -s -X POST http://localhost:3000/api/train \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "test-project-001",
    "dataset_path": "/data/mnist",
    "lr": 0.001,
    "batch_size": 32,
    "epochs": 5,
    "optimizer": "adam",
    "seed": 42
  }')

echo "응답: $RESPONSE"
JOB_ID=$(echo $RESPONSE | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
    echo "❌ Job ID를 가져올 수 없습니다"
    exit 1
fi

echo "✓ Job 생성됨: $JOB_ID"
echo ""
echo "3. Progress 컬렉션 구조 확인 (3초 대기 후)..."
sleep 3

echo ""
echo "=== Progress 컬렉션 문서 구조 ==="
python3 << EOF
from pymongo import MongoClient
import json
from datetime import datetime

client = MongoClient("mongodb://localhost:27017/")
db = client["dlops"]
progress_col = db["progress"]

# job_id로 필터링
docs = list(progress_col.find({"job_id": "$JOB_ID"}).sort("updated_at", -1).limit(1))

if docs:
    doc = docs[0]
    # ObjectId를 문자열로 변환
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    # datetime을 문자열로 변환
    for key, value in doc.items():
        if isinstance(value, datetime):
            doc[key] = value.isoformat()
    print(json.dumps(doc, indent=2, ensure_ascii=False))
else:
    print("Progress 문서를 찾을 수 없습니다.")
    print("전체 progress 문서 수:", progress_col.count_documents({}))
EOF

echo ""
echo "4. SSE 스트림 테스트 (5초간 수신)..."
echo "   URL: http://localhost:3000/api/jobs/$JOB_ID/progress/stream"
echo ""
timeout 5 curl -N -s "http://localhost:3000/api/jobs/$JOB_ID/progress/stream" 2>&1 | head -20 || echo ""

echo ""
echo "=== 테스트 완료 ==="

if [ "${CHECK_MODELS:-0}" = "1" ]; then
    echo ""
    echo "=== Models 스모크 테스트 (CHECK_MODELS=1) ==="
    bash "$(cd "$(dirname "$0")" && pwd)/back_end/node_server/scripts/smoke_models.sh"
fi

if [ "${CHECK_DATASETS:-0}" = "1" ]; then
    echo ""
    echo "=== Datasets 스모크 테스트 (CHECK_DATASETS=1) ==="
    bash "$(cd "$(dirname "$0")" && pwd)/back_end/node_server/scripts/smoke_datasets.sh"
fi

if [ "${CHECK_DEPLOY_JOB_ID:-}" != "" ]; then
    echo ""
    echo "=== Deploy 스모크 테스트 (CHECK_DEPLOY_JOB_ID) ==="
    bash "$(cd "$(dirname "$0")" && pwd)/back_end/node_server/scripts/smoke_deploy.sh" "${CHECK_DEPLOY_JOB_ID}"
fi







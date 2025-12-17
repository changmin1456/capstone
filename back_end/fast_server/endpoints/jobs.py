from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, HTTPException

from db import jobs_col, progress_col
from job_helpers import (
    JOB_ACTIVE,
    convert_model,
    mark_job_running,
    run_training,
    signal_stop,
    update_job,
)

router = APIRouter(tags=["jobs"])


def _get_job_or_404(job_id: str) -> dict:
    try:
        oid = ObjectId(job_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job_id")

    doc = jobs_col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")
    return doc


@router.post("/jobs/{job_id}/start")
def start_job(job_id: str, background_tasks: BackgroundTasks, resume: Optional[bool] = None):
    job = _get_job_or_404(job_id)

    resume_mode = bool(resume) or (job.get("status") or "").lower() == "paused"
    startable_states = {"queued", "failed", "stopped", "paused"}
    if (job.get("status") or "").lower() not in startable_states:
        raise HTTPException(status_code=400, detail="Job is not startable")

    if resume_mode:
        update_job(job_id, status="running", error_message=None)
    else:
        mark_job_running(job_id)
    # 백그라운드에서 학습 실행 (thread 사용)
    background_tasks.add_task(run_training, job_id, resume_mode)

    return {"job_id": job_id, "status": "starting", "mode": "resume" if resume_mode else "start"}


@router.post("/jobs/{job_id}/stop")
def stop_job(job_id: str):
    _ = _get_job_or_404(job_id)

    signal_stop(job_id, "reset")

    update_job(job_id, status="stopped")
    progress_col.update_one(
        {"job_id": job_id},
        {"$set": {"status": "stopped"}},
        upsert=True,
    )
    return {"job_id": job_id, "status": "stopped"}


@router.post("/jobs/{job_id}/pause")
def pause_job(job_id: str):
    job = _get_job_or_404(job_id)
    if (job.get("status") or "").lower() != "running":
        raise HTTPException(status_code=400, detail="Job is not running")

    # FastAPI 재시작 등으로 인해, DB는 running인데 현재 프로세스에선 스레드가 없을 수 있음.
    # 이 경우 pause 신호를 보낼 대상이 없으므로 명확히 안내한다.
    if not JOB_ACTIVE.get(job_id):
        raise HTTPException(
            status_code=410,
            detail="Job is marked running but no active worker exists (server restarted). Please restart the job.",
        )

    # 상태는 pausing으로만 표시, 실제 paused 확정은 학습 스레드에서 처리
    update_job(job_id, status="pausing")
    progress_col.update_one(
        {"job_id": job_id},
        {"$set": {"status": "pausing", "updated_at": datetime.utcnow()}},
        upsert=True,
    )
    signal_stop(job_id, "pause")
    return {"job_id": job_id, "status": "pausing"}


@router.post("/jobs/{job_id}/resume")
def resume_job(job_id: str, background_tasks: BackgroundTasks):
    job = _get_job_or_404(job_id)
    if (job.get("status") or "").lower() != "paused":
        raise HTTPException(status_code=409, detail=f"Job is not paused yet (status={job.get('status')})")
    if JOB_ACTIVE.get(job_id):
        raise HTTPException(status_code=409, detail="Job is already running")

    # run_training 내부에서 락/상태 처리
    background_tasks.add_task(run_training, job_id, True)
    return {"job_id": job_id, "status": "resuming"}


@router.post("/jobs/{job_id}/reset")
def reset_job(job_id: str):
    job = _get_job_or_404(job_id)

    # 스레드가 살아있으면 reset 신호를 보내고, 아니면 DB/progress만 초기화한다.
    if JOB_ACTIVE.get(job_id):
        signal_stop(job_id, "reset")
    progress_col.delete_many({"job_id": job_id})
    total_epochs = (
        job.get("hyperparams", {}).get("epochs")
        or job.get("epochs")
        or 0
    )
    update_job(job_id, status="queued", progress=0.0, error_message=None)
    progress_col.update_one(
        {"job_id": job_id},
        {"$set": {
            "status": "queued",
            "progress": 0.0,
            "epoch": 0,
            "total_epochs": total_epochs,
            "updated_at": datetime.utcnow(),
        }},
        upsert=True,
    )
    return {"job_id": job_id, "status": "queued"}


@router.post("/jobs/{job_id}/restart")
def restart_job(job_id: str, background_tasks: BackgroundTasks):
    job = _get_job_or_404(job_id)

    # 초기화
    update_job(job_id, status="queued", progress=0.0, error_message=None)
    progress_col.update_one(
        {"job_id": job_id},
        {"$set": {"status": "queued", "progress": 0.0}},
        upsert=True,
    )

    # 재시작
    mark_job_running(job_id)
    background_tasks.add_task(run_training, job_id)

    return {"job_id": job_id, "status": "restarting"}


@router.get("/jobs/{job_id}/progress")
def get_job_progress(job_id: str):
    """
    최근 학습 진행 상황/로그를 반환.
    progress_col의 최신 문서를 우선 사용하고, 없으면 job 문서 정보로 대체.
    """
    _ = _get_job_or_404(job_id)
    doc = progress_col.find_one({"job_id": job_id}, sort=[("updated_at", -1)])

    if not doc:
        return {
            "job_id": job_id,
            "status": "queued",
            "progress": 0.0,
            "epoch": 0,
            "total_epochs": 0,
            "history": None,
            "logs": [],
        }

    def _get_hist(key: str):
        val = doc.get(key)
        return val if isinstance(val, list) else None

    return {
        "job_id": job_id,
        "status": doc.get("status"),
        "progress": doc.get("progress", 0.0),
        "epoch": doc.get("epoch", 0),
        "total_epochs": doc.get("total_epochs", 0),
        "loss": doc.get("loss"),
        "accuracy": doc.get("accuracy"),
        "history": {
            "train_loss": _get_hist("train_loss"),
            "val_loss": _get_hist("val_loss"),
            "train_accuracy": _get_hist("train_accuracy"),
            "val_accuracy": _get_hist("val_accuracy"),
        },
        "logs": doc.get("logs", []),
        "updated_at": doc.get("updated_at"),
    }


@router.post("/jobs/{job_id}/deploy")
def deploy_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    target: str = "onnx",
    output_name: Optional[str] = None,
):
    """
    모델 배포(변환) 요청을 등록한다.
    실제 변환 로직은 아직 구현되지 않았으며, 요청 정보를 job 문서에 기록만 한다.
    """
    job = _get_job_or_404(job_id)
    status = (job.get("status") or "").lower()
    if status not in {"completed", "done"}:
        raise HTTPException(status_code=409, detail="Job is not completed")

    model_path = job.get("model_path")
    if not model_path:
        raise HTTPException(status_code=400, detail="model_path missing")

    target_norm = (target or "").lower()
    if target_norm not in {"onnx", "tensorrt"}:
        raise HTTPException(status_code=400, detail="Unsupported target (use onnx or tensorrt)")

    # NOTE: We intentionally do not allow arbitrary output directories from the UI.
    # The output is always written under back_end/saved_models/deploy.
    # Users can only customize the base filename.
    raw_name = (output_name or "").strip()
    safe_stub = "".join(ch for ch in raw_name if ch.isalnum() or ch in ("-", "_"))[:64]
    output_stub = safe_stub or job_id

    record = {
        "target": target_norm,
        "status": "queued",
        "message": "변환/배포를 시작합니다.",
        "requested_at": datetime.utcnow(),
    # Folder path the UI can request to open (dev-only).
    "open_path": str(Path(__file__).resolve().parents[1] / "saved_models" / "deploy"),
    "output_stub": output_stub,
    }
    jobs_col.update_one({"_id": job["_id"]}, {"$set": {"deploy": record}})

    # 변환은 백그라운드에서 처리 (완료/실패 시 convert_model이 job.deploy를 갱신)
    background_tasks.add_task(convert_model, job_id, target_norm)
    return {
        "job_id": job_id,
        "deploy": {
            **record,
            "model_path": model_path,
            # Expected download URL once completed.
            "output_url": f"/files/deploy/{output_stub}{'.onnx' if target_norm == 'onnx' else '.engine'}",
        },
    }

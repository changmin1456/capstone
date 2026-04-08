from __future__ import annotations

from datetime import datetime
import os
from pathlib import Path
import shutil
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends

from db import jobs_col, progress_col
from endpoints.auth import get_current_user, is_admin
from job_helpers import (
    JOB_ACTIVE,
    mark_job_running,
    run_training,
    signal_stop,
    update_job,
    mark_failed,
)

router = APIRouter(tags=["jobs"])


def _fast_server_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def _runs_root() -> Path:
    root = os.getenv("RUNS_DIR") or (_fast_server_dir() / "runs")
    p = Path(root)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _resolve_model_path(job: dict, job_id: str) -> Optional[Path]:
    candidates: list[Path] = []

    weights_dir = _runs_root() / job_id / "weights"
    for name in ["best.pt", "last.pt", "pause.pt"]:
        candidates.append(weights_dir / name)

    raw_candidates = []
    for key in ["model_path", "model"]:
        raw = job.get(key)
        if isinstance(raw, str) and raw.strip():
            raw_candidates.append(raw.strip())

    hyper = job.get("hyperparams") or {}
    if isinstance(hyper, dict):
        raw = hyper.get("model_name") or hyper.get("model")
        if isinstance(raw, str) and raw.strip():
            raw_candidates.append(raw.strip())

    models_dir = _fast_server_dir() / "models"
    for raw in raw_candidates:
        p = Path(raw).expanduser()
        candidates.append(p)
        if not p.suffix:
            candidates.append(p.with_suffix(".pt"))
        candidates.append(models_dir / p.name)
        if not p.suffix:
            candidates.append(models_dir / f"{p.name}.pt")

    for cand in candidates:
        if cand.exists() and cand.is_file():
            return cand
    return None


def _set_deploy_fields(job_id: str, **fields: object) -> None:
    try:
        oid = ObjectId(job_id)
    except Exception:
        return
    set_fields = {f"deploy.{k}": v for k, v in fields.items()}
    jobs_col.update_one({"_id": oid}, {"$set": set_fields})


def _run_deploy_convert(job_id: str, target_norm: str, output_stub: str) -> None:
    job = None
    try:
        job = jobs_col.find_one({"_id": ObjectId(job_id)})
    except Exception:
        return
    if not job:
        return

    _set_deploy_fields(job_id, status="running", message="변환 중입니다.", started_at=datetime.utcnow())

    ext = ".onnx" if target_norm == "onnx" else ".engine"
    out_dir = Path(__file__).resolve().parents[1] / "saved_models" / "deploy"
    out_dir.mkdir(parents=True, exist_ok=True)
    output_path = out_dir / f"{output_stub}{ext}"

    try:
        model_path = _resolve_model_path(job, job_id)
        if not model_path:
            raise ValueError("model_path not found")

        shutil.copy2(model_path, output_path)
        output_url = f"/files/deploy/{output_stub}{ext}"
        _set_deploy_fields(
            job_id,
            status="completed",
            message="변환이 완료되었습니다.",
            output_path=str(output_path),
            output_url=output_url,
            completed_at=datetime.utcnow(),
        )
    except Exception as e:
        _set_deploy_fields(
            job_id,
            status="failed",
            message=f"변환 실패: {e}",
            failed_at=datetime.utcnow(),
        )


def _get_job_or_404(job_id: str, user=None) -> dict:
    try:
        oid = ObjectId(job_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid job_id")

    doc = jobs_col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")
    if user and not is_admin(user):
        owner = doc.get("ownerUserId") or doc.get("owner_id") or doc.get("ownerId")
        if not owner or str(owner) != str(user.get("id")):
            raise HTTPException(status_code=403, detail="Forbidden")
    return doc


def _can_resume(job_id: str, job: dict) -> bool:
    doc = progress_col.find_one({"job_id": job_id}, {"last_epoch": 1, "epoch": 1, "total_epochs": 1})
    if not doc:
        doc = progress_col.find_one({"_id": ObjectId(job_id)}, {"last_epoch": 1, "epoch": 1, "total_epochs": 1})
    last_epoch = int((doc or {}).get("last_epoch") or (doc or {}).get("epoch") or 0)
    total_epochs = int(
        (doc or {}).get("total_epochs")
        or job.get("hyperparams", {}).get("epochs")
        or job.get("epochs")
        or 0
    )
    if total_epochs and last_epoch >= total_epochs:
        return False
    return True


@router.post("/jobs/{job_id}/start")
def start_job(job_id: str, background_tasks: BackgroundTasks, resume: Optional[bool] = None, user=Depends(get_current_user)):
    job = _get_job_or_404(job_id, user)

    # 이미 동작 중인 워커가 있으면 시작 거부
    if JOB_ACTIVE.get(job_id):
        raise HTTPException(status_code=409, detail="Job is already running")

    status_norm = (job.get("status") or "").lower()
    resume_mode = bool(resume) or status_norm == "paused"
    startable_states = {
        "queued",
        "failed",
        "stopped",
        "paused",
        "completed",
        "done",
        "",
    }
    if status_norm not in startable_states:
        raise HTTPException(status_code=400, detail=f"Job is not startable (status={status_norm or 'none'})")

    if resume_mode:
        if not _can_resume(job_id, job):
            raise HTTPException(status_code=409, detail="Training already completed; nothing to resume")
        update_job(job_id, status="resuming", error_message=None)
    else:
        update_job(job_id, status="starting", error_message=None)
    progress_col.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {"status": "starting", "updated_at": datetime.utcnow(), "job_id": job_id}},
        upsert=True,
    )
    try:
        background_tasks.add_task(run_training, job_id, resume_mode)
    except Exception as e:
        mark_failed(job_id, f"failed to start training: {e}")
        raise HTTPException(status_code=500, detail="failed to start training")

    return {"job_id": job_id, "status": "starting", "mode": "resume" if resume_mode else "start"}


@router.post("/jobs/{job_id}/stop")
def stop_job(job_id: str, user=Depends(get_current_user)):
    _ = _get_job_or_404(job_id, user)

    signal_stop(job_id, "stop")

    update_job(job_id, status="stopped")
    progress_col.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {"status": "stopped", "updated_at": datetime.utcnow(), "job_id": job_id}},
        upsert=True,
    )
    return {"job_id": job_id, "status": "stopped"}


@router.post("/jobs/{job_id}/pause")
def pause_job(job_id: str, user=Depends(get_current_user)):
    job = _get_job_or_404(job_id, user)
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
        {"_id": ObjectId(job_id)},
        {"$set": {"status": "pausing", "updated_at": datetime.utcnow(), "job_id": job_id}},
        upsert=True,
    )
    signal_stop(job_id, "pause")
    return {"job_id": job_id, "status": "pausing"}


@router.post("/jobs/{job_id}/resume")
def resume_job(job_id: str, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    job = _get_job_or_404(job_id, user)
    if (job.get("status") or "").lower() != "paused":
        raise HTTPException(status_code=409, detail=f"Job is not paused yet (status={job.get('status')})")
    if JOB_ACTIVE.get(job_id):
        raise HTTPException(status_code=409, detail="Job is already running")
    if not _can_resume(job_id, job):
        raise HTTPException(status_code=409, detail="Training already completed; nothing to resume")

    update_job(job_id, status="resuming", error_message=None)
    progress_col.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {"status": "resuming", "updated_at": datetime.utcnow(), "job_id": job_id}},
        upsert=True,
    )
    # run_training 내부에서 락/상태 처리
    background_tasks.add_task(run_training, job_id, True)
    return {"job_id": job_id, "status": "resuming"}


@router.post("/jobs/{job_id}/reset")
def reset_job(job_id: str, user=Depends(get_current_user)):
    job = _get_job_or_404(job_id, user)

    # 스레드가 살아있으면 reset 신호를 보내고, 아니면 DB/progress만 초기화한다.
    if JOB_ACTIVE.get(job_id):
        signal_stop(job_id, "reset")
    progress_col.delete_many({"job_id": job_id})
    progress_col.delete_one({"_id": ObjectId(job_id)})
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
def restart_job(job_id: str, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    job = _get_job_or_404(job_id, user)

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
def get_job_progress(job_id: str, user=Depends(get_current_user)):
    """
    최근 학습 진행 상황/로그를 반환.
    progress_col의 최신 문서를 우선 사용하고, 없으면 job 문서 정보로 대체.
    """
    try:
        _ = _get_job_or_404(job_id, user)
    except HTTPException as e:
        # 존재하지 않는 job_id라도 프론트에서 에러창 대신 "비어있는 상태"를 볼 수 있도록 기본 응답 반환
        if e.status_code in (400, 404):
            return {
                "job_id": job_id,
                "status": "queued",
                "progress": 0.0,
                "epoch": 0,
                "total_epochs": 0,
                "loss": None,
                "accuracy": None,
                "history": {
                    "train_loss": [],
                    "val_loss": [],
                    "train_accuracy": [],
                    "val_accuracy": [],
                },
                "logs": [],
                "updated_at": datetime.utcnow(),
                "error_message": f"job {job_id} not found",
            }
        raise
    doc = progress_col.find_one({"_id": ObjectId(job_id)})
    if not doc:
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
    user=Depends(get_current_user),
):
    """
    모델 배포(변환) 요청을 등록한다.
    실제 변환 로직은 아직 구현되지 않았으며, 요청 정보를 job 문서에 기록만 한다.
    """
    job = _get_job_or_404(job_id, user)
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

    # 변환은 백그라운드에서 처리 (완료/실패 시 job.deploy를 갱신)
    background_tasks.add_task(_run_deploy_convert, job_id, target_norm, output_stub)
    return {
        "job_id": job_id,
        "deploy": {
            **record,
            "model_path": model_path,
            # Expected download URL once completed.
            "output_url": f"/files/deploy/{output_stub}{'.onnx' if target_norm == 'onnx' else '.engine'}",
        },
    }

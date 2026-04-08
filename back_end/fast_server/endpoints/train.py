from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from db import jobs_col, progress_col, to_object_id
from endpoints.auth import get_current_user

router = APIRouter(tags=["train"])


class TrainRequest(BaseModel):
    project_id: str = Field(..., description="Mongo ObjectId string")
    dataset_path: str
    dataset_name: Optional[str] = None

    title: Optional[str] = None
    description: Optional[str] = None
    task: Optional[str] = None

    # Common hyperparams (optional)
    lr: Optional[float] = None
    batch_size: Optional[int] = None
    epochs: Optional[int] = None
    optimizer: Optional[str] = None
    seed: Optional[int] = None
    model_name: Optional[str] = None
    image_size: Optional[int] = None

    # HPO
    search_space: Optional[dict[str, Any]] = None


@router.post("/train")
def create_training_job(req: TrainRequest, user=Depends(get_current_user)) -> dict[str, Any]:
    """Create a training job (queued).

    Called by Node public API (`POST /api/jobs`) as an internal contract.
    This endpoint only creates DB records. Training starts via `/jobs/{job_id}/start`.
    """

    try:
        project_oid = ObjectId(req.project_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid project_id")

    if not req.dataset_path or not str(req.dataset_path).strip():
        raise HTTPException(status_code=400, detail="dataset_path is required")

    now = datetime.utcnow()

    hyperparams: dict[str, Any] = {}
    for k in [
        "lr",
        "batch_size",
        "epochs",
        "optimizer",
        "seed",
        "model_name",
        "image_size",
        "search_space",
    ]:
        v = getattr(req, k)
        if v is not None:
            hyperparams[k] = v

    owner_id = user.get("id") if isinstance(user, dict) else None

    task = (req.task or "").strip().lower() or "detect"
    if task not in {"detect", "classify"}:
        task = "detect"

    doc: dict[str, Any] = {
        "project_id": project_oid,
        "dataset_path": req.dataset_path,
        "dataset_name": req.dataset_name,
        "title": req.title or "",
        "description": req.description or "",
        "task": task,
        "hyperparams": hyperparams,
        "status": "queued",
        "progress": 0.0,
        "error_message": None,
        "ownerUserId": owner_id,
        "owner_id": owner_id,
        "created_at": now,
        "updated_at": now,
    }

    result = jobs_col.insert_one(doc)
    job_id = str(result.inserted_id)

    progress_col.update_one(
        {"_id": to_object_id(job_id)},
        {
            "$set": {
                "job_id": job_id,
                "status": "queued",
                "progress": 0.0,
                "epoch": 0,
                "total_epochs": hyperparams.get("epochs", 0) or 0,
                "updated_at": now,
            }
        },
        upsert=True,
    )

    return {
        "job_id": job_id,
        "status": "queued",
        "project_id": req.project_id,
        "dataset_path": req.dataset_path,
    }

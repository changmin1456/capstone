from fastapi import APIRouter, Depends, HTTPException

from bson import ObjectId

from db import jobs_col, progress_col
from endpoints.auth import get_current_user, is_admin

router = APIRouter(tags=["job_detail"])


def _oid(job_id: str) -> ObjectId:
    try:
        return ObjectId(job_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid job id")


@router.get("/jobs/{job_id}")
def get_job(job_id: str, user=Depends(get_current_user)):
    doc = jobs_col.find_one({"_id": _oid(job_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="not found")
    if not is_admin(user):
        owner = doc.get("ownerUserId") or doc.get("owner_id") or doc.get("ownerId")
        if not owner or str(owner) != str(user["id"]):
            raise HTTPException(status_code=403, detail="forbidden")
    doc["id"] = str(doc.pop("_id"))
    return doc


@router.get("/jobs/{job_id}/progress")
def get_job_progress(job_id: str, user=Depends(get_current_user)):
    # Prefer the canonical progress doc (_id == job_id) to avoid mixed-type sorting issues.
    progress = progress_col.find_one({"_id": _oid(job_id)})
    if not progress:
        progress = progress_col.find_one({"job_id": job_id}, sort=[("updated_at", -1)])
    if not progress:
        return {
            "job_id": job_id,
            "status": "queued",
            "progress": 0.0,
            "epoch": 0,
            "total_epochs": 0,
            "logs": [],
        }
    if not is_admin(user):
        owner = progress.get("ownerUserId") or progress.get("owner_id") or progress.get("ownerId")
        if owner and str(owner) != str(user["id"]):
            raise HTTPException(status_code=403, detail="forbidden")
        if not owner:
            job = jobs_col.find_one({"_id": _oid(job_id)})
            if job:
                job_owner = job.get("ownerUserId") or job.get("owner_id") or job.get("ownerId")
                if job_owner and str(job_owner) != str(user["id"]):
                    raise HTTPException(status_code=403, detail="forbidden")
            else:
                # job이 없어도 최소한의 진행 정보는 빈 값으로 내려보낸다
                return {
                    "job_id": job_id,
                    "status": "queued",
                    "progress": 0.0,
                    "epoch": 0,
                    "total_epochs": 0,
                    "logs": [],
                }
    return progress

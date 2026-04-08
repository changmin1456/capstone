from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from bson import ObjectId

from db import experiments_col, to_object_id
from endpoints.auth import get_current_user, is_admin

router = APIRouter(tags=["experiments"])


class ExperimentCreate(BaseModel):
    name: str | None = None
    description: str | None = None
    project_id: str | None = None
    job_id: str | None = None

    class Config:
        extra = "allow"


def _serialize(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialize(v) for v in value]
    return value


@router.get("/experiments")
def list_experiments(job_id: str | None = None, project_id: str | None = None, user=Depends(get_current_user)):
    query = {} if is_admin(user) else {"ownerUserId": user["id"]}
    if job_id:
        query["$or"] = [{"job_id": job_id}, {"jobId": job_id}]
    if project_id:
        query["project_id"] = project_id
    docs = experiments_col.find(query).sort("created_at", -1)
    results = []
    for d in docs:
        base = {k: v for k, v in d.items() if k != "_id"}
        results.append({"id": str(d["_id"]), **_serialize(base)})
    return results


@router.post("/experiments")
def create_experiment(payload: ExperimentCreate, user=Depends(get_current_user)):
    now = datetime.utcnow()
    doc = payload.dict(exclude_unset=True)
    if "jobId" in doc and "job_id" not in doc:
        doc["job_id"] = doc.get("jobId")
    if not doc.get("name"):
        doc["name"] = doc.get("job_id") or doc.get("jobId") or "experiment"
    doc["ownerUserId"] = user["id"]
    doc["created_at"] = now
    doc["updated_at"] = now
    result = experiments_col.insert_one(doc)
    return {"id": str(result.inserted_id), **_serialize(doc)}


@router.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str, user=Depends(get_current_user)):
    try:
        oid = to_object_id(experiment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid id")

    doc = experiments_col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="not found")
    if not is_admin(user) and doc.get("ownerUserId") != user["id"]:
        raise HTTPException(status_code=403, detail="forbidden")
    base = {k: v for k, v in doc.items() if k != "_id"}
    return {"id": str(doc["_id"]), **_serialize(base)}


@router.delete("/experiments/{experiment_id}")
def delete_experiment(experiment_id: str, user=Depends(get_current_user)):
    try:
        oid = to_object_id(experiment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid id")
    if not is_admin(user):
        doc = experiments_col.find_one({"_id": oid})
        if doc and doc.get("ownerUserId") != user["id"]:
            raise HTTPException(status_code=403, detail="forbidden")
    experiments_col.delete_one({"_id": oid})
    return {"deleted": True}

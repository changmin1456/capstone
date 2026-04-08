from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import jobs_col
from endpoints.auth import get_current_user, is_admin

router = APIRouter(tags=["xai"])


@dataclass
class _FileItem:
    id: str
    label: str
    url: str


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


def _fast_server_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def _project_root() -> Path:
    return _fast_server_dir().parent


def _runs_root() -> Path:
    root = os.getenv("RUNS_DIR") or (_fast_server_dir() / "runs")
    return Path(root)


def _list_images(dir_path: Path, *, kind: str, rel_prefix: str, limit: int = 200) -> list[_FileItem]:
    exts = {".jpg", ".jpeg", ".png"}
    items: list[_FileItem] = []

    if not dir_path.exists() or not dir_path.is_dir():
        return items

    for p in sorted(dir_path.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in exts:
            continue

        try:
            rel = p.relative_to(rel_prefix)
        except Exception:
            # rel_prefix may be str path, fall back to computing relative to dir_path
            rel = p.relative_to(dir_path)

        rel_posix = rel.as_posix()
        items.append(
            _FileItem(
                id=rel_posix,
                label=p.name,
                url=f"/files/{kind}/{rel_posix}",
            )
        )
        if len(items) >= limit:
            break

    return items


@router.get("/jobs/{job_id}/xai/sources")
def list_xai_sources(job_id: str, user=Depends(get_current_user)):
    """Return available image sources for a job.

    Contract:
      - No absolute paths in responses.
      - URLs are served via FastAPI `/files/...`.

    Sources:
      - training_results: workdir/runs/job_{id}/**/*.jpg|png
      - dataset_train: dataset images/train
      - dataset_val: dataset images/val
    """
    job = _get_job_or_404(job_id, user)

    dataset_path = (job.get("dataset_path") or "").strip()
    has_dataset = bool(dataset_path)

    return {
        "job_id": job_id,
        "sources": [
            {
                "key": "training_results",
                "label": "Training Results",
                "available": True,
            },
            {
                "key": "dataset_train",
                "label": "Dataset (train)",
                "available": has_dataset,
            },
            {
                "key": "dataset_val",
                "label": "Dataset (val)",
                "available": has_dataset,
            },
        ],
    }


SourceKey = Literal["training_results", "dataset_train", "dataset_val"]


class XaiGenerateRequest(BaseModel):
    source: SourceKey
    image_id: str


@router.get("/jobs/{job_id}/xai/images")
def list_xai_images(job_id: str, source: SourceKey, limit: int = 60, user=Depends(get_current_user)):
    job = _get_job_or_404(job_id, user)

    limit_norm = max(1, min(300, int(limit)))

    if source == "training_results":
        # run_training creates runs/<job_id>
        run_dir = _runs_root() / job_id

        # Serve under kind=runs; make it relative to fast_server root
        return {
            "job_id": job_id,
            "source": source,
            "items": [i.__dict__ for i in _list_images(run_dir, kind="runs", rel_prefix=_fast_server_dir(), limit=limit_norm)],
        }

    # dataset_* needs dataset_path
    dataset_path = (job.get("dataset_path") or "").strip()
    if not dataset_path:
        raise HTTPException(status_code=409, detail="dataset is not configured")

    root = _fast_server_dir() / "datasets" / dataset_path
    sub = "train" if source == "dataset_train" else "val"
    img_dir = root / "images" / sub

    # Serve under kind=dataset; make it relative to datasets root
    datasets_root = (_fast_server_dir() / "datasets").resolve()
    return {
        "job_id": job_id,
        "source": source,
        "items": [
            i.__dict__ for i in _list_images(img_dir, kind="dataset", rel_prefix=datasets_root, limit=limit_norm)
        ],
    }


@router.post("/jobs/{job_id}/xai/generate")
def generate_xai(job_id: str, req: XaiGenerateRequest, user=Depends(get_current_user)):
    """Generate a simple 4-panel output for the selected image.

    v1 implementation goal:
      - Return URLs for original + 3 placeholders (heatmap/boxes/overlay)
      - Persist under back_end/saved_models/exports/xai/{job_id}/...

    Notes:
      - This is intentionally a lightweight placeholder so UI can be wired end-to-end.
      - Can be upgraded later to real Grad-CAM.
    """
    _ = _get_job_or_404(job_id, user)

    # Resolve selected source image into a `/files/...` URL and a filesystem path we can copy.
    # We don't return any local/absolute paths.

    source = req.source
    image_id = req.image_id

    if source == "training_results":
        # image_id is relative to fast_server root (see list_xai_images)
        src_fs = (_fast_server_dir() / image_id.lstrip("/")).resolve()
        src_url = f"/files/runs/{image_id.lstrip('/')}"
    else:
        # image_id is relative to datasets root
        src_fs = (_fast_server_dir() / "datasets" / image_id.lstrip("/")).resolve()
        src_url = f"/files/dataset/{image_id.lstrip('/')}"

    if not src_fs.exists() or not src_fs.is_file():
        raise HTTPException(status_code=404, detail="image not found")

    out_dir = _project_root() / "saved_models" / "xai" / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    # Placeholder strategy: copy original into 4 predictable names.
    # UI can render these as 4 panels. Later we can generate actual heatmaps.
    original_name = "original" + src_fs.suffix.lower()
    heatmap_name = "heatmap" + src_fs.suffix.lower()
    boxes_name = "boxes" + src_fs.suffix.lower()
    overlay_name = "overlay" + src_fs.suffix.lower()

    for name in [original_name, heatmap_name, boxes_name, overlay_name]:
        (out_dir / name).write_bytes(src_fs.read_bytes())

    # XAI outputs are served under kind=xai; path is relative to the xai root.
    rel = Path(job_id)
    return {
        "job_id": job_id,
        "source": source,
        "image_id": image_id,
        "panels": {
            "original": {
                "label": "Original",
                "url": f"/files/xai/{(rel / original_name).as_posix()}",
                "fallback": src_url,
            },
            "heatmap": {
                "label": "Heatmap",
                "url": f"/files/xai/{(rel / heatmap_name).as_posix()}",
            },
            "boxes": {
                "label": "Bounding Boxes",
                "url": f"/files/xai/{(rel / boxes_name).as_posix()}",
            },
            "overlay": {
                "label": "Overlay",
                "url": f"/files/xai/{(rel / overlay_name).as_posix()}",
            },
        },
    }

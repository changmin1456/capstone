from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Form

from db import models_meta_col
from endpoints.auth import get_current_user, is_admin

router = APIRouter(tags=["models"])

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
UPLOADS_DIR = MODELS_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _sync_disk_models_to_meta() -> None:
    """
    스크립트로 직접 넣은 모델 파일(.py/.pth 등)을 메타에 등록해
    목록에 나타나도록 만든다. 관리자 소유 + public 으로 표시한다.
    """
    if not MODELS_DIR.exists():
        return

    for path in MODELS_DIR.iterdir():
        if path.is_dir():
            # uploads 폴더는 업로드 라우트가 관리하므로 패스
            continue
        if path.name.startswith(".") or path.name.lower() in {"readme.md"}:
            continue
        model_id = path.stem
        try:
            meta = models_meta_col.find_one({"modelId": model_id})
        except Exception:
            # DB 문제가 있으면 조용히 패스 (후속 fallback에서 파일을 직접 반환)
            return
        if meta:
            continue
        doc = {
            "modelId": model_id,
            "id": model_id,
            "name": model_id,
            "description": f"Disk model {path.name}",
            "category": "custom",
            "file_path": str(path.resolve()),
            "visibility": "public",
            "ownerUserId": "admin",
        }
        try:
            models_meta_col.update_one({"modelId": model_id}, {"$set": doc}, upsert=True)
        except Exception:
            # Ignore DB errors; we'll still serve from disk.
            pass


def _disk_models() -> List[dict]:
    """
    DB 없이도 models/ 및 models/uploads/ 의 파일을 바로 노출.
    """
    items: List[dict] = []
    for base in [MODELS_DIR, UPLOADS_DIR]:
        if not base.exists():
            continue
        for path in base.iterdir():
            if path.is_dir():
                continue
            if path.name.startswith(".") or path.name.lower() in {"readme.md"}:
                continue
            model_id = path.stem
            items.append(
                {
                    "id": model_id,
                    "name": model_id,
                    "description": f"Disk model {path.name}",
                    "category": "custom",
                    "file_path": str(path.resolve()),
                    "visibility": "public",
                    "ownerUserId": "admin",
                }
            )
    return items


@router.get("/models")
def list_models(user=Depends(get_current_user)) -> List[dict]:
    """
    Admin: sees everything.
    Users: see public models + their own uploads.

    Built-in placeholder 모델은 더 이상 포함하지 않고, 업로드된 메타만 반환합니다.
    """
    admin = is_admin(user)

    # Register any raw files under models/ as public admin-owned entries.
    # Try to sync disk files into meta, but don't fail if DB is down.
    try:
        _sync_disk_models_to_meta()
    except Exception:
        pass

    results: List[dict] = []
    try:
        q = {} if admin else {"$or": [{"visibility": "public"}, {"ownerUserId": user["id"]}]}
        for doc in models_meta_col.find(q):
            mid = doc.get("modelId") or doc.get("id")
            if not mid:
                continue
            if not admin and doc.get("visibility") == "private" and doc.get("ownerUserId") != user["id"]:
                continue
            results.append(
                {
                    "id": mid,
                    "name": doc.get("name") or mid,
                    "description": doc.get("description"),
                    "category": doc.get("category", "custom"),
                    "file_path": doc.get("file_path"),
                    "visibility": doc.get("visibility", "public"),
                    "ownerUserId": doc.get("ownerUserId"),
                }
            )
    except Exception:
        # If Mongo is unavailable, fall back to disk scan.
        pass

    if results:
        return results

    # Pure disk fallback when DB is empty or unreachable.
    return _disk_models()


@router.get("/models/{model_id}")
def get_model(model_id: str, user=Depends(get_current_user)):
    admin = is_admin(user)

    doc = None
    try:
        doc = models_meta_col.find_one({"modelId": model_id})
    except Exception:
        doc = None

    if not doc:
        # If a file exists on disk, register it as public/admin-owned.
        candidate = None
        for path in MODELS_DIR.iterdir():
            if path.is_dir() or path.name.startswith("."):
                continue
            if path.stem == model_id:
                candidate = path
                break
        if not candidate:
            for path in UPLOADS_DIR.iterdir():
                if path.is_dir() or path.name.startswith("."):
                    continue
                if path.stem == model_id:
                    candidate = path
                    break
        if candidate:
            doc = {
                "modelId": model_id,
                "id": model_id,
                "name": model_id,
                "description": f"Disk model {candidate.name}",
                "category": "custom",
                "file_path": str(candidate.resolve()),
                "visibility": "public",
                "ownerUserId": "admin",
            }
            try:
                models_meta_col.update_one({"modelId": model_id}, {"$set": doc}, upsert=True)
            except Exception:
                pass
        else:
            raise HTTPException(status_code=404, detail="model not found")
    if not admin and doc.get("ownerUserId") != user["id"] and doc.get("visibility") == "private":
        raise HTTPException(status_code=403, detail="forbidden")
    return {
        "id": model_id,
        "name": doc.get("name") or model_id,
        "description": doc.get("description"),
        "category": doc.get("category", "custom"),
        "file_path": doc.get("file_path"),
        "visibility": doc.get("visibility", "public"),
        "ownerUserId": doc.get("ownerUserId"),
    }


@router.post("/models")
async def upload_model(
    model_file: UploadFile = File(...),
    id: str | None = Form(None),
    name: str | None = Form(None),
    description: str | None = Form(None),
    category: str | None = Form(None),
    user=Depends(get_current_user),
):
    """
    Accepts a single uploaded model file and stores it under models/uploads.
    The file is saved for traceability; metadata is returned for UI display.
    """
    model_id = (id or name or model_file.filename or "model").strip().replace(" ", "_")
    safe_name = model_id[:64] or "model"
    target_path = UPLOADS_DIR / safe_name

    contents = await model_file.read()
    target_path.write_bytes(contents)

    visibility = "public" if is_admin(user) else "private"
    doc = {
        "modelId": safe_name,
        "id": safe_name,
        "name": name or safe_name,
        "description": description,
        "category": category or "custom",
        "file_path": str(target_path),
        "visibility": visibility,
        "ownerUserId": user["id"],
    }
    models_meta_col.update_one({"modelId": safe_name}, {"$set": doc}, upsert=True)
    return doc


@router.delete("/models/{model_id}")
def delete_model(model_id: str, user=Depends(get_current_user)):
    doc = models_meta_col.find_one({"modelId": model_id})
    if doc and not is_admin(user) and doc.get("ownerUserId") != user["id"]:
        raise HTTPException(status_code=403, detail="forbidden")
    models_meta_col.delete_one({"modelId": model_id})
    # Best-effort filesystem cleanup
    uploads_dir = Path(__file__).resolve().parents[1] / "models" / "uploads"
    target = uploads_dir / model_id
    if target.exists():
        try:
            target.unlink()
        except OSError:
            pass
    return {"deleted": True}

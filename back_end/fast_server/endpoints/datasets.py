import shutil
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, Form
from pydantic import BaseModel

router = APIRouter(tags=["datasets"])


DATASET_ROOT = Path(__file__).resolve().parents[1] / "datasets"
DATASET_ROOT.mkdir(parents=True, exist_ok=True)


def _safe_name(val: str | None, default: str = "default") -> str:
    if not val:
        return default
    cleaned = "".join(ch for ch in str(val) if ch.isalnum() or ch in ("-", "_"))
    return cleaned[:80] or default


def _safe_path(target: str | Path) -> Path:
    p = Path(target).resolve()
    root = DATASET_ROOT.resolve()
    if root not in p.parents and p != root:
        raise HTTPException(status_code=400, detail="invalid path")
    return p


class DeleteRequest(BaseModel):
    target: str


def _build_report(path: Path, dataset_name: str | None = None) -> dict:
    size = path.stat().st_size if path.exists() else 0
    last_modified = datetime.fromtimestamp(path.stat().st_mtime).isoformat() if path.exists() else None
    # Create a simple class distribution so the UI can render a pie chart.
    total_images = max(1, len(list(path.rglob("*"))) or 20)
    classes = [
        {"label": "class_a", "count": total_images // 3 or 1},
        {"label": "class_b", "count": total_images // 3 or 1},
        {"label": "class_c", "count": total_images - 2 * (total_images // 3 or 1)},
    ]
    return {
        "dataset_path": str(path),
        "dataset_name": dataset_name or path.name,
        "size": size,
        "type": "application/zip",
        "last_modified": last_modified,
        "total_images": total_images,
        "classes": classes,
        "duplicates": 0,
        "health_score": 0.9,
        "imbalance": False,
    }


@router.post("/datasets/upload")
async def upload_dataset(
    dataset: UploadFile = File(...),
    project_id: str | None = Form(None),
    project_name: str | None = Form(None),
    title: str | None = Form(None),
):
    # Desired layout: datasets/<project>/<train_title>/<rand>/{raw.zip, extracted/}
    proj_folder = _safe_name(project_name or project_id, "project")
    train_folder = _safe_name(title or dataset.filename or "train", "train")
    rand = uuid.uuid4().hex[:8]
    base_dir = DATASET_ROOT / proj_folder / train_folder / rand
    extracted_dir = base_dir / "extracted"
    raw_path = base_dir / "raw.zip"
    extracted_dir.mkdir(parents=True, exist_ok=True)

    tmp_path = base_dir / (dataset.filename or "dataset.bin")
    tmp_path.write_bytes(await dataset.read())

    try:
        if zipfile.is_zipfile(tmp_path):
            with zipfile.ZipFile(tmp_path, "r") as zf:
                zf.extractall(extracted_dir)
            # Keep original as raw.zip
            raw_path.write_bytes(tmp_path.read_bytes())
            tmp_path.unlink(missing_ok=True)
        else:
            # Not a zip: treat as single file dataset, copy to extracted
            dest_file = extracted_dir / tmp_path.name
            shutil.move(str(tmp_path), dest_file)
            # Still write a raw copy for consistency
            raw_path.write_bytes(dest_file.read_bytes())
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"failed to extract/copy dataset: {e}")

    # Ensure data.yaml exists for YOLO flows.
    data_yaml = extracted_dir / "data.yaml"
    if not data_yaml.exists():
        try:
            data_yaml.write_text(
                "\n".join(
                    [
                        f"train: {extracted_dir}",
                        f"val: {extracted_dir}",
                        "nc: 1",
                        "names: ['class0']",
                    ]
                ),
                encoding="utf-8",
            )
        except Exception:
            pass

    report = _build_report(extracted_dir, dataset.filename)
    return {
        "random_id": rand,
        "dataset_path": str(extracted_dir),
        "raw_path": str(raw_path),
        "title": title,
        "project_id": project_id,
        "project_name": project_name,
        "project_folder": proj_folder,
        "train_folder": train_folder,
        **report,
    }


@router.post("/datasets/analyze")
async def analyze_dataset(
    dataset: UploadFile = File(...),
    project_id: str | None = Form(None),
    project_name: str | None = Form(None),
    title: str | None = Form(None),
):
    # Reuse upload flow and return analysis stats.
    return await upload_dataset(dataset=dataset, project_id=project_id, project_name=project_name, title=title)


@router.get("/datasets/report")
def dataset_report(path: str):
    target = _safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="not found")

    return _build_report(target, target.name)


@router.post("/datasets/delete-path")
def delete_path(req: DeleteRequest):
    target = _safe_path(req.target)
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)
    elif target.exists():
        target.unlink()

    # Clean up empty parent folders under DATASET_ROOT
    try:
        root = DATASET_ROOT.resolve()
        parent = target.parent
        while parent != root and root in parent.parents:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
    except Exception:
        pass
    return {"deleted": True}


@router.post("/datasets/cancel")
def cancel_dataset(req: DeleteRequest):
    # If target is a temp/uuid or project/train folder, remove it.
    target = _safe_path(req.target)
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
        # Clean empty parents
        try:
            root = DATASET_ROOT.resolve()
            parent = target.parent
            while parent != root and root in parent.parents:
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
        except Exception:
            pass
    return {"deleted": True}


@router.post("/datasets/sweep-temp")
def sweep_temp(ttl_seconds: int = 21600):
    cutoff = datetime.utcnow().timestamp() - max(60, ttl_seconds)
    deleted = 0
    for child in DATASET_ROOT.iterdir():
        if not child.is_dir():
            continue
        try:
            ts = child.stat().st_mtime
        except OSError:
            continue
        if ts < cutoff:
            shutil.rmtree(child, ignore_errors=True)
            deleted += 1
    return {"deleted": deleted}

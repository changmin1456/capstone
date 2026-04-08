from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

from db import jobs_col, projects_col

router = APIRouter(tags=["verify"])


_FAST_SERVER_DIR = Path(__file__).resolve().parents[1]  # back_end/fast_server
_DATASET_ROOT = _FAST_SERVER_DIR / "datasets"


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return None


def _is_job_dir(p: Path) -> bool:
    if not p.is_dir():
        return False
    if (p / "job.meta.json").is_file():
        return True
    if list(p.glob("*.zip")):
        return True
    if (p / "runs").exists():
        return True
    return False


@router.get("/verify/scan")
def verify_scan() -> Dict[str, Any]:
    """Scan datasets folder and compare with Mongo projects/jobs."""

    now = datetime.utcnow().isoformat() + "Z"

    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []

    projects_db = list(projects_col.find({}))
    jobs_db = list(jobs_col.find({}))

    proj_by_id: Dict[str, Dict[str, Any]] = {}
    proj_folder_by_id: Dict[str, str] = {}
    for p in projects_db:
        pid = str(p.get("_id"))
        proj_by_id[pid] = p
        dataset_root = p.get("dataset_root") or p.get("datasetPath") or None
        if isinstance(dataset_root, str) and dataset_root.strip():
            proj_folder_by_id[pid] = Path(dataset_root).name
        else:
            name = p.get("name")
            proj_folder_by_id[pid] = str(name) if isinstance(name, str) and name else pid

    jobs_by_id: Dict[str, Dict[str, Any]] = {str(j.get("_id")): j for j in jobs_db if j.get("_id")}

    dataset_root_exists = _DATASET_ROOT.exists() and _DATASET_ROOT.is_dir()
    if not dataset_root_exists:
        warnings.append(
            {
                "code": "DATASET_ROOT_MISSING",
                "message": "datasets/ 폴더가 없습니다.",
                "path": str(_DATASET_ROOT),
            }
        )

    fs_projects: List[Path] = []
    if dataset_root_exists:
        fs_projects = [p for p in _DATASET_ROOT.iterdir() if p.is_dir()]

    fs_project_names = {p.name for p in fs_projects}

    for pid, proj in proj_by_id.items():
        expected_folder = proj_folder_by_id.get(pid)
        if expected_folder and expected_folder not in fs_project_names:
            errors.append(
                {
                    "code": "PROJECT_FOLDER_MISSING",
                    "project_id": pid,
                    "project_name": proj.get("name"),
                    "expected_folder": expected_folder,
                    "message": "프로젝트 datasets 폴더가 없습니다.",
                }
            )

    db_expected_folders = set(proj_folder_by_id.values())
    for folder in sorted(fs_project_names - db_expected_folders):
        warnings.append(
            {
                "code": "ORPHAN_PROJECT_FOLDER",
                "project_folder": folder,
                "message": "DB에 없는 datasets 프로젝트 폴더가 존재합니다.",
            }
        )

    fs_job_count = 0
    db_job_count = len(jobs_by_id)

    for proj_dir in fs_projects:
        for child in proj_dir.iterdir():
            if not _is_job_dir(child):
                continue
            fs_job_count += 1

            meta = _read_json(child / "job.meta.json")
            if not meta:
                warnings.append(
                    {
                        "code": "JOB_META_MISSING",
                        "project_folder": proj_dir.name,
                        "job_folder": child.name,
                        "message": "job.meta.json 파일이 없거나 읽을 수 없습니다.",
                    }
                )
                continue

            job_id = meta.get("job_id")
            project_id = meta.get("project_id")
            if not isinstance(job_id, str) or not job_id:
                errors.append(
                    {
                        "code": "JOB_META_INVALID",
                        "project_folder": proj_dir.name,
                        "job_folder": child.name,
                        "message": "job.meta.json에 job_id가 없습니다.",
                    }
                )
                continue

            if job_id not in jobs_by_id:
                errors.append(
                    {
                        "code": "JOB_IN_FS_NOT_IN_DB",
                        "job_id": job_id,
                        "project_folder": proj_dir.name,
                        "job_folder": child.name,
                        "message": "datasets에는 있는데 DB jobs에는 없는 job입니다.",
                    }
                )
                continue

            if isinstance(project_id, str) and project_id:
                db_proj_id = (
                    str(jobs_by_id[job_id].get("project_id")) if jobs_by_id[job_id].get("project_id") else None
                )
                if db_proj_id and db_proj_id != project_id:
                    errors.append(
                        {
                            "code": "JOB_PROJECT_MISMATCH",
                            "job_id": job_id,
                            "meta_project_id": project_id,
                            "db_project_id": db_proj_id,
                            "message": "job.meta.json의 project_id와 DB job.project_id가 다릅니다.",
                        }
                    )

    for job_id, job in jobs_by_id.items():
        ds_path = job.get("dataset_path") or (job.get("hyperparams") or {}).get("dataset_path")
        if not isinstance(ds_path, str) or not ds_path:
            warnings.append(
                {
                    "code": "JOB_DATASET_PATH_MISSING",
                    "job_id": job_id,
                    "message": "DB job에 dataset_path가 없습니다.",
                }
            )

    summary = {
        "at": now,
        "dataset_root": str(_DATASET_ROOT),
        "db": {"projects": len(proj_by_id), "jobs": db_job_count},
        "fs": {"projects": len(fs_projects), "jobs": fs_job_count},
        "errors": len(errors),
        "warnings": len(warnings),
    }

    return {"summary": summary, "errors": errors, "warnings": warnings}

    return {"summary": summary, "errors": errors, "warnings": warnings}

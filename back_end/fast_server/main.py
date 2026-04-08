from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from endpoints.datasets import router as datasets_router
from endpoints.experiments import router as experiments_router
from endpoints.auth import router as auth_router
from endpoints.health import router as health_router
from endpoints.job_detail import router as job_detail_router
from endpoints.models import router as models_router
from endpoints.jobs import router as jobs_router
from endpoints.train import router as train_router
from endpoints.verify import router as verify_router
from endpoints.xai import router as xai_router

from db import jobs_col

app = FastAPI(title="FastAPI Internal Server")


def _fast_server_dir() -> Path:
    return Path(__file__).resolve().parent


def _project_root() -> Path:
    return _fast_server_dir().parent


@app.get("/files/{kind}/{file_path:path}", tags=["files"])
def serve_files(kind: str, file_path: str):
    """Serve local files for the UI.

    Contract:
      - Only serves from whitelisted roots (no absolute paths).
      - Blocks path traversal.
      - Returns proper Content-Type via FileResponse.

        Kinds:
            - runs: relative to fast_server dir (matches XAI training_results ids)
            - dataset: relative to fast_server/datasets (matches XAI dataset ids)
            - deploy: relative to back_end/saved_models/deploy (model conversion outputs)
            - xai: relative to back_end/saved_models/xai (generated XAI panels)
            - exports: legacy; relative to back_end/saved_models/exports (backward compatibility)
    """

    kind_norm = (kind or "").strip().lower()
    if kind_norm not in {"runs", "dataset", "deploy", "xai", "exports"}:
        raise HTTPException(status_code=400, detail="invalid kind")

    # Basic traversal protection
    if ".." in file_path or file_path.startswith("/"):
        raise HTTPException(status_code=400, detail="invalid path")

    if kind_norm == "runs":
        root = _fast_server_dir()
    elif kind_norm == "dataset":
        root = _fast_server_dir() / "datasets"
    elif kind_norm == "deploy":
        root = _project_root() / "saved_models" / "deploy"
    elif kind_norm == "xai":
        root = _project_root() / "saved_models" / "xai"
    else:  # exports (legacy)
        root = _project_root() / "saved_models" / "exports"

    target = (root / file_path).resolve()
    root_resolved = root.resolve()
    if root_resolved not in target.parents and target != root_resolved:
        raise HTTPException(status_code=400, detail="invalid path")

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="not found")

    return FileResponse(path=str(target))


@app.get("/health", tags=["health"])
def health():
    # Compatibility endpoint used by some clients.
    return {"message": "fast-api pong"}


@app.on_event("startup")
def _cleanup_orphan_running_jobs() -> None:
    """Handle orphaned jobs after server restart.

    Training control (pause/reset signals) is in-memory. If the server restarts,
    any DB job left as running/pausing no longer has an active worker.
    We mark them as stopped with an explanatory error_message.
    """
    now = datetime.utcnow()
    jobs_col.update_many(
        {"status": {"$in": ["running", "pausing"]}},
        {
            "$set": {
                "status": "stopped",
                "error_message": "orphaned after server restart",
                "updated_at": now,
            }
        },
    )


@app.get("/")
def root():
    return {
        "message": "FastAPI Server (Internal API)",
        "status": "running",
        "note": "Use Node.js server at http://localhost:3000/api-docs for public Swagger documentation.",
    }


# Routers (Swagger groups by each router.tags)
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(train_router)
app.include_router(jobs_router)
app.include_router(job_detail_router)
app.include_router(verify_router)
app.include_router(datasets_router)
app.include_router(experiments_router)
app.include_router(models_router)
app.include_router(xai_router)
